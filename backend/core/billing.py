"""Invoice generation & payment allocation — mirrors frontend/src/domain/billing.ts."""
from collections import OrderedDict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.db.models import F, Sum

from accounts.models import CustomerProfile
from billing.models import Invoice, InvoiceLine, Payment, PaymentAllocation
from crm.models import Discount
from engagement.models import SystemSettings

from .pricing import resolve_price
from .schedule import billable_deliveries

TWO = Decimal('0.01')


def q(v) -> Decimal:
    return Decimal(v).quantize(TWO, rounding=ROUND_HALF_UP)


def outstanding(customer: CustomerProfile) -> Decimal:
    agg = customer.invoices.aggregate(b=Sum('current_bill'), p=Sum('paid'))
    return q((agg['b'] or 0) - (agg['p'] or 0))


def discount_amount(d: Discount, base: Decimal) -> Decimal:
    raw = base * d.value / 100 if d.kind == Discount.Kind.PERCENTAGE else d.value
    return q(min(raw, base))


def draft_invoice(customer: CustomerProfile, start: date, end: date) -> dict:
    lines, line_discount, notes = [], Decimal(0), []
    discounts = list(customer.discounts.filter(revoked=False, start_date__lte=end).exclude(expiry_date__lt=start))
    for sub in customer.subscriptions.select_related('product').prefetch_related('pauses'):
        segments: OrderedDict[tuple, dict] = OrderedDict()
        for d in billable_deliveries(sub, start, end):
            p = resolve_price(sub.product_id, d, customer.agent_id)
            if not p:
                continue
            key = (p.customer_price, p.agent_price, p.purchase_price)
            seg = segments.setdefault(key, {'deliveries': 0})
            seg['deliveries'] += 1
        sub_total = Decimal(0)
        for (unit, agent_price, purchase), seg in segments.items():
            qty = seg['deliveries'] * sub.quantity
            amount = q(qty * unit)
            sub_total += amount
            lines.append(dict(subscription=sub, product=sub.product, product_name=sub.product.name, deliveries=seg['deliveries'], quantity=qty, unit_price=unit, agent_price=agent_price, purchase_price=purchase, amount=amount))
        for disc in [x for x in discounts if x.subscription_id == sub.id]:
            amt = discount_amount(disc, sub_total)
            line_discount += amt
            notes.append(f'{sub.product.name}: {disc.category}')
    subtotal = q(sum((l['amount'] for l in lines), Decimal(0)))
    discount = line_discount
    for disc in [x for x in discounts if x.subscription_id is None]:
        discount += discount_amount(disc, subtotal - discount)
    handling = customer.handling_charge if lines else Decimal(0)
    return dict(lines=lines, subtotal=subtotal, discount=q(discount), handling_charge=q(handling), current_bill=q(subtotal - discount + handling), previous_balance=outstanding(customer), notes=notes)


@transaction.atomic
def generate_invoices(period_start: date, customers) -> dict:
    """One invoice per customer per month; re-running skips already-billed customers."""
    s = SystemSettings.load()
    next_month = (period_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    period_end = next_month - timedelta(days=1)
    created, skipped = [], 0
    for c in customers:
        if Invoice.objects.filter(customer=c, period_start=period_start).exists():
            skipped += 1
            continue
        d = draft_invoice(c, period_start, period_end)
        if not d['lines']:
            continue
        seq = Invoice.objects.count() + 1
        inv = Invoice.objects.create(
            number=f"{s.invoice_prefix}-{period_start:%Y%m}-{seq:04d}",
            customer=c,
            agent=c.agent,
            period_start=period_start,
            period_end=period_end,
            issued_on=date.today(),
            due_date=date.today() + timedelta(days=s.billing_due_days),
            subtotal=d['subtotal'],
            discount=d['discount'],
            handling_charge=d['handling_charge'],
            current_bill=d['current_bill'],
            previous_balance=d['previous_balance'],
        )
        InvoiceLine.objects.bulk_create([InvoiceLine(invoice=inv, **l) for l in d['lines']])
        inv.refresh_status()
        inv.save(update_fields=['status'])
        created.append(inv)
    return {'created': len(created), 'skipped': skipped, 'invoices': created}


@transaction.atomic
def record_payment(customer: CustomerProfile, amount: Decimal, method: str, idempotency_key: str, collected_by, *, gateway_ref='', simulated=False, verified=True, note='') -> tuple[Payment, bool]:
    """FIFO allocation to oldest open invoices. Idempotent on `idempotency_key`."""
    existing = Payment.objects.filter(idempotency_key=idempotency_key).first()
    if existing:
        return existing, True
    amount = q(amount)
    if amount <= 0:
        raise ValueError('Enter an amount greater than zero.')
    open_invoices = list(customer.invoices.select_for_update().filter(paid__lt=F('current_bill')).order_by('issued_on', 'id'))
    total_due = q(sum((i.remaining for i in open_invoices), Decimal(0)))
    if amount > total_due:
        raise ValueError(f'Amount exceeds outstanding balance ({total_due}).')
    s = SystemSettings.load()
    pay = Payment.objects.create(
        receipt_no=f'{s.receipt_prefix}-{Payment.objects.count() + 1:05d}',
        customer=customer,
        agent=customer.agent,
        amount=amount,
        method=method,
        date=date.today(),
        collected_by=collected_by,
        gateway_ref=gateway_ref,
        simulated=simulated,
        verified=verified,
        idempotency_key=idempotency_key,
        note=note,
    )
    left = amount
    for inv in open_invoices:
        if left <= 0:
            break
        take = min(left, inv.remaining)
        PaymentAllocation.objects.create(payment=pay, invoice=inv, amount=take)
        inv.paid = q(inv.paid + take)
        inv.refresh_status()
        inv.save(update_fields=['paid', 'status'])
        left -= take
    return pay, False
