"""Role-scoped dataset in the exact shape of the frontend `DB` (frontend/src/domain/db.ts).

The frontend keeps one local copy of the records a user may see, so every screen,
the delivery calendar and the offline checklist work from the same data. This module
builds that copy from PostgreSQL. Ids are opaque strings `<prefix>_<pk>`; people are
addressed by their profile (`agt_`, `exe_`, `cus_`) or `adm_<user pk>` for admins.

Privacy rules applied here (never trust the client to hide fields):
  * customers see only themselves, their agent and their delivery executive;
  * purchase prices are admin-only; agent prices are hidden from customers and executives;
  * admin mobile numbers are hidden from everyone except admins.
"""
import re
from datetime import date, datetime

from django.db.models import Q

from accounts.models import AgentProfile, CustomerProfile, ExecutiveProfile, Role, User
from billing.models import Invoice, InvoiceAdjustment, InvoiceLine, Payment, PaymentAllocation, Remittance
from catalog.models import PriceVersion, Product
from crm.models import Discount, Subscription, SubscriptionEvent, SubscriptionPause
from distribution.models import DeliveryRecord, Handover, Holiday, Route, RouteStop, StockEntry
from engagement.models import ActivityLog, Complaint, ComplaintUpdate, Notification, SystemSettings
from geo.models import Location

from .access import customers_for

DB_VERSION = 3

COLLECTIONS = [
    'settings', 'admins', 'agents', 'executives', 'customers', 'locations', 'products', 'prices', 'subscriptions',
    'subscriptionEvents', 'holidays', 'routes', 'handovers', 'deliveries', 'stock', 'discounts', 'invoices', 'payments',
    'remittances', 'complaints', 'notifications', 'logs',
]


def rid(prefix: str, pk):
    return f'{prefix}_{pk}' if pk is not None else None


class People:
    """User pk → frontend id, built once per snapshot."""

    def __init__(self):
        self.by_user = {}
        for uid, role in User.objects.filter(role=Role.ADMIN).values_list('id', 'role'):
            self.by_user[uid] = rid('adm', uid)
        for model, prefix in ((AgentProfile, 'agt'), (ExecutiveProfile, 'exe'), (CustomerProfile, 'cus')):
            for pk, uid in model.objects.values_list('id', 'user_id'):
                self.by_user[uid] = rid(prefix, pk)

    def __call__(self, user_id):
        return self.by_user.get(user_id, '') if user_id else ''


def user_ref(user: User) -> str:
    if user.role == Role.ADMIN:
        return rid('adm', user.pk)
    profile = {Role.AGENT: 'agent', Role.EXECUTIVE: 'executive', Role.CUSTOMER: 'customer'}[user.role]
    prefix = {Role.AGENT: 'agt', Role.EXECUTIVE: 'exe', Role.CUSTOMER: 'cus'}[user.role]
    return rid(prefix, getattr(user, profile).pk)


def iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat().replace('+00:00', 'Z')
    if isinstance(v, date):
        return v.isoformat()
    return v


def num(v):
    return float(v) if v is not None else 0.0


LINK_RE = re.compile(r'^/(customers|agents|executives|routes|invoices)/(\d+)$')
LINK_PREFIX = {'customers': 'cus', 'agents': 'agt', 'executives': 'exe', 'routes': 'rte', 'invoices': 'inv'}


def fix_link(link: str) -> str:
    m = LINK_RE.match(link or '')
    return f'/{m.group(1)}/{LINK_PREFIX[m.group(1)]}_{m.group(2)}' if m else (link or '')


def settings_dict():
    s = SystemSettings.load()
    return {
        'agencyName': s.agency_name, 'agencyAddress': s.agency_address, 'gstin': s.gstin, 'supportPhone': s.support_phone,
        'invoicePrefix': s.invoice_prefix, 'receiptPrefix': s.receipt_prefix, 'billingDueDays': s.billing_due_days,
        'adminMaxDiscountPct': num(s.admin_max_discount_pct), 'defaultAgentMaxDiscountPct': num(s.default_agent_max_discount_pct),
        'agentPriceMaxMarkupPct': num(s.agent_price_max_markup_pct), 'lowStockDefault': s.low_stock_default, 'overdueAfterDays': s.overdue_after_days,
    }


def locations_list():
    return [
        {'id': rid('loc', l['id']), 'level': l['level'], 'name': l['name'], 'parentId': rid('loc', l['parent_id']), 'pincode': l['pincode'] or None, 'lat': l['lat'], 'lng': l['lng'], 'createdBy': None}
        for l in Location.objects.values('id', 'level', 'name', 'parent_id', 'pincode', 'lat', 'lng')
    ]


def product_dict(p: Product):
    return {
        'id': rid('prd', p.id), 'code': p.code, 'name': p.name, 'category': p.category, 'publisher': p.publisher, 'language': p.language,
        'type': p.product_type, 'description': p.description, 'image': p.image.url if p.image else None, 'availability': p.availability,
        'defaultFrequency': p.default_frequency, 'status': p.status, 'color': p.color, 'lowStockThreshold': p.low_stock_threshold, 'createdOn': iso(p.created_on),
    }


def build(user: User, only: set[str] | None = None) -> dict:
    want = lambda k: only is None or k in only  # noqa: E731
    role = user.role
    admin = role == Role.ADMIN
    ref = People()
    customers = customers_for(user)
    cust_ids = list(customers.values_list('id', flat=True))

    if role == Role.ADMIN:
        agents_qs = AgentProfile.objects.all()
        execs_qs = ExecutiveProfile.objects.all()
        routes_qs = Route.objects.all()
    elif role == Role.AGENT:
        agents_qs = AgentProfile.objects.filter(pk=user.agent.pk)
        execs_qs = ExecutiveProfile.objects.filter(agent=user.agent)
        routes_qs = Route.objects.filter(agent=user.agent)
    elif role == Role.EXECUTIVE:
        agents_qs = AgentProfile.objects.filter(pk=user.executive.agent_id)
        execs_qs = ExecutiveProfile.objects.filter(pk=user.executive.pk)
        routes_qs = Route.objects.filter(executive=user.executive)
    else:
        c = user.customer
        agents_qs = AgentProfile.objects.filter(pk=c.agent_id)
        execs_qs = ExecutiveProfile.objects.filter(pk=c.route.executive_id) if c.route_id and c.route.executive_id else ExecutiveProfile.objects.none()
        routes_qs = Route.objects.filter(pk=c.route_id) if c.route_id else Route.objects.none()
    scope_agent_ids = list(agents_qs.values_list('id', flat=True))

    out: dict = {'version': DB_VERSION, 'seededOn': date.today().isoformat(), 'credentials': {}, 'processedKeys': {}, 'counters': {}}

    if want('settings'):
        out['settings'] = settings_dict()

    if want('admins'):
        out['admins'] = [
            {'id': rid('adm', u.id), 'name': u.name, 'mobile': u.mobile if admin else '', 'email': u.email if admin else '', 'status': u.status}
            for u in User.objects.filter(role=Role.ADMIN)
        ]

    if want('agents'):
        out['agents'] = [
            {
                'id': rid('agt', a.id), 'code': a.code, 'name': a.user.name, 'mobile': a.user.mobile, 'email': a.email, 'agencyName': a.agency_name,
                'areaIds': [rid('loc', x.id) for x in a.areas.all()], 'maxDiscountPct': num(a.max_discount_pct), 'canManageRoutes': a.can_manage_routes,
                'joiningDate': iso(a.joining_date), 'status': a.user.status,
            }
            for a in agents_qs.select_related('user').prefetch_related('areas')
        ]

    if want('executives'):
        out['executives'] = [
            {
                'id': rid('exe', e.id), 'code': e.code, 'name': e.user.name, 'mobile': e.user.mobile, 'agentId': rid('agt', e.agent_id),
                'areaIds': [rid('loc', x.id) for x in e.areas.all()], 'joiningDate': iso(e.joining_date), 'status': e.user.status, 'canCollectCash': e.can_collect_cash,
                # Family / emergency contact: staff only, never sent to subscribers.
                **({'altMobile': e.alt_mobile or None, 'altMobileRelation': e.alt_mobile_relation or None} if role != Role.CUSTOMER else {}),
            }
            for e in execs_qs.select_related('user').prefetch_related('areas')
        ]

    if want('customers'):
        out['customers'] = [
            {
                'id': rid('cus', c.id), 'code': c.code, 'name': c.user.name, 'mobile': c.user.mobile, 'altMobile': c.alt_mobile or None, 'whatsapp': c.whatsapp or None,
                'email': c.email or None, 'gender': c.gender or None, 'dob': iso(c.dob), 'areaId': rid('loc', c.area_id), 'houseName': c.house_name,
                'landmark': c.landmark or None, 'address': c.address, 'lat': c.lat, 'lng': c.lng, 'agentId': rid('agt', c.agent_id), 'routeId': rid('rte', c.route_id),
                'idProof': c.id_proof, 'idNumber': c.id_number or None, 'securityDeposit': num(c.security_deposit), 'handlingCharge': num(c.handling_charge),
                'status': c.user.status, 'registeredOn': iso(c.registered_on), 'selfRegistered': c.self_registered,
            }
            for c in customers
        ]

    if want('locations'):
        out['locations'] = locations_list()

    if want('products'):
        out['products'] = [product_dict(p) for p in Product.objects.order_by('name')]

    if want('prices'):
        qs = PriceVersion.objects.all()
        if not admin:
            qs = qs.filter(Q(agent__isnull=True) | Q(agent_id__in=scope_agent_ids))
        show_agent_price = role in (Role.ADMIN, Role.AGENT)
        out['prices'] = [
            {
                'id': rid('prc', v.id), 'productId': rid('prd', v.product_id), 'agentId': rid('agt', v.agent_id), 'purchasePrice': num(v.purchase_price) if admin else 0,
                'agentPrice': num(v.agent_price) if show_agent_price else 0, 'customerPrice': num(v.customer_price), 'effectiveFrom': iso(v.effective_from),
                'createdBy': ref(v.created_by_id), 'createdAt': iso(v.created_at), 'note': v.note or None,
            }
            for v in qs
        ]

    subs_qs = Subscription.objects.filter(customer_id__in=cust_ids)
    if want('subscriptions'):
        pauses: dict[int, list] = {}
        for p in SubscriptionPause.objects.filter(subscription__in=subs_qs).order_by('date_from'):
            pauses.setdefault(p.subscription_id, []).append({'from': iso(p.date_from), 'to': iso(p.date_to), 'reason': p.reason or None})
        out['subscriptions'] = [
            {
                'id': rid('sub', s.id), 'customerId': rid('cus', s.customer_id), 'productId': rid('prd', s.product_id), 'startDate': iso(s.start_date), 'endDate': iso(s.end_date),
                'frequency': s.frequency, 'weekdays': s.weekdays, 'monthDays': s.month_days, 'customDates': s.custom_dates, 'quantity': s.quantity, 'status': s.status,
                'pauses': pauses.get(s.id, []), 'cancelledOn': iso(s.cancelled_on), 'createdOn': iso(s.created_on), 'notes': s.notes or None,
            }
            for s in subs_qs
        ]

    if want('subscriptionEvents'):
        out['subscriptionEvents'] = [
            {'id': rid('sev', e.id), 'subscriptionId': rid('sub', e.subscription_id), 'at': iso(e.at), 'by': ref(e.by_id), 'action': e.action, 'detail': e.detail}
            for e in SubscriptionEvent.objects.filter(subscription__in=subs_qs)
        ]

    if want('holidays'):
        out['holidays'] = [
            {
                'id': rid('hol', h.id), 'name': h.name, 'date': iso(h.date), 'type': h.type, 'locationIds': [rid('loc', x.id) for x in h.locations.all()],
                'productIds': [rid('prd', x.id) for x in h.products.all()], 'deliveryApplicable': h.delivery_applicable, 'description': h.description,
            }
            for h in Holiday.objects.prefetch_related('locations', 'products').order_by('-date')
        ]

    if want('routes'):
        stops: dict[int, list] = {}
        stop_qs = RouteStop.objects.filter(route__in=routes_qs).order_by('sequence')
        if role == Role.CUSTOMER:
            stop_qs = stop_qs.filter(customer_id__in=cust_ids)
        for st in stop_qs:
            stops.setdefault(st.route_id, []).append({'customerId': rid('cus', st.customer_id), 'instructions': st.instructions or None})
        out['routes'] = [
            {
                'id': rid('rte', r.id), 'code': r.code, 'name': r.name, 'areaIds': [rid('loc', x.id) for x in r.areas.all()], 'agentId': rid('agt', r.agent_id),
                'executiveId': rid('exe', r.executive_id), 'stops': stops.get(r.id, []), 'instructions': r.instructions if role != Role.CUSTOMER else '',
                'status': r.status, 'createdOn': iso(r.created_on),
            }
            for r in routes_qs.prefetch_related('areas')
        ]

    if want('handovers'):
        qs = Handover.objects.filter(route__in=routes_qs) if role != Role.CUSTOMER else Handover.objects.none()
        out['handovers'] = [
            {'id': rid('hnd', h.id), 'routeId': rid('rte', h.route_id), 'fromExecutiveId': rid('exe', h.from_executive_id), 'toExecutiveId': rid('exe', h.to_executive_id), 'at': iso(h.at), 'by': ref(h.by_id), 'note': h.note or None}
            for h in qs
        ]

    if want('deliveries'):
        rows = DeliveryRecord.objects.filter(customer_id__in=cust_ids).values_list(
            'subscription_id', 'customer_id', 'product_id', 'date', 'status', 'quantity', 'executive_id', 'actual_at', 'updated_by_id', 'updated_at', 'reason', 'remarks', 'synced_from_offline'
        )
        deliveries = {}
        for sub, cus, prd, d, st, qty, exe, actual, by, upd, reason, remarks, offline in rows:
            key = f'{rid("sub", sub)}|{d.isoformat()}'
            deliveries[key] = {
                'key': key, 'subscriptionId': rid('sub', sub), 'customerId': rid('cus', cus), 'productId': rid('prd', prd), 'date': d.isoformat(), 'status': st,
                'quantity': qty, 'executiveId': rid('exe', exe), 'actualAt': iso(actual), 'updatedBy': ref(by), 'updatedAt': iso(upd), 'reason': reason or None,
                'remarks': remarks or None, 'syncedFromOffline': offline,
            }
        out['deliveries'] = deliveries

    if want('stock'):
        qs = StockEntry.objects.all() if admin else StockEntry.objects.filter(agent_id__in=scope_agent_ids) if role in (Role.AGENT, Role.EXECUTIVE) else StockEntry.objects.none()
        stock = {}
        for e in qs:
            key = f'{e.date.isoformat()}|{rid("prd", e.product_id)}|{rid("agt", e.agent_id)}'
            stock[key] = {
                'key': key, 'serverId': e.id, 'date': e.date.isoformat(), 'productId': rid('prd', e.product_id), 'agentId': rid('agt', e.agent_id), 'opening': e.opening,
                'received': e.received, 'distributed': e.distributed, 'returned': e.returned, 'damaged': e.damaged, 'reconciled': e.reconciled,
                'updatedBy': ref(e.updated_by_id), 'updatedAt': iso(e.updated_at),
            }
        out['stock'] = stock

    if want('discounts'):
        out['discounts'] = [
            {
                'id': rid('dsc', d.id), 'customerId': rid('cus', d.customer_id), 'subscriptionId': rid('sub', d.subscription_id), 'kind': d.kind, 'category': d.category,
                'value': num(d.value), 'startDate': iso(d.start_date), 'expiryDate': iso(d.expiry_date), 'reason': d.reason, 'approvedBy': ref(d.approved_by_id),
                'createdAt': iso(d.created_at), 'revoked': d.revoked,
            }
            for d in Discount.objects.filter(customer_id__in=cust_ids)
        ]

    if want('invoices'):
        inv_qs = Invoice.objects.filter(customer_id__in=cust_ids)
        lines: dict[int, list] = {}
        show_agent_price = role in (Role.ADMIN, Role.AGENT)
        for l in InvoiceLine.objects.filter(invoice__in=inv_qs).order_by('id'):
            lines.setdefault(l.invoice_id, []).append({
                'subscriptionId': rid('sub', l.subscription_id), 'productId': rid('prd', l.product_id), 'productName': l.product_name, 'quantity': l.quantity,
                'deliveries': l.deliveries, 'unitPrice': num(l.unit_price), 'agentPrice': num(l.agent_price) if show_agent_price else 0,
                'purchasePrice': num(l.purchase_price) if admin else 0, 'amount': num(l.amount),
            })
        adjs: dict[int, list] = {}
        for a in InvoiceAdjustment.objects.filter(invoice__in=inv_qs).order_by('at'):
            adjs.setdefault(a.invoice_id, []).append({'id': rid('adj', a.id), 'label': a.label, 'amount': num(a.amount), 'approvedBy': ref(a.approved_by_id), 'at': iso(a.at)})
        out['invoices'] = [
            {
                'id': rid('inv', i.id), 'number': i.number, 'customerId': rid('cus', i.customer_id), 'agentId': rid('agt', i.agent_id), 'periodStart': iso(i.period_start),
                'periodEnd': iso(i.period_end), 'issuedOn': iso(i.issued_on), 'dueDate': iso(i.due_date), 'lines': lines.get(i.id, []), 'subtotal': num(i.subtotal),
                'discount': num(i.discount), 'handlingCharge': num(i.handling_charge), 'adjustments': adjs.get(i.id, []), 'currentBill': num(i.current_bill),
                'previousBalance': num(i.previous_balance), 'paid': num(i.paid), 'status': i.status,
            }
            for i in inv_qs.order_by('period_start', 'id')
        ]

    if want('payments'):
        pay_qs = Payment.objects.filter(customer_id__in=cust_ids)
        allocs: dict[int, list] = {}
        for a in PaymentAllocation.objects.filter(payment__in=pay_qs):
            allocs.setdefault(a.payment_id, []).append({'invoiceId': rid('inv', a.invoice_id), 'amount': num(a.amount)})
        out['payments'] = [
            {
                'id': rid('pay', p.id), 'receiptNo': p.receipt_no, 'customerId': rid('cus', p.customer_id), 'agentId': rid('agt', p.agent_id), 'amount': num(p.amount),
                'method': p.method, 'date': iso(p.date), 'at': iso(p.at), 'collectedBy': ref(p.collected_by_id), 'allocations': allocs.get(p.id, []),
                'gatewayRef': p.gateway_ref or None, 'simulated': p.simulated, 'verified': p.verified, 'idempotencyKey': p.idempotency_key, 'note': p.note or None,
            }
            for p in pay_qs.order_by('at')
        ]

    if want('remittances'):
        qs = Remittance.objects.all() if admin else Remittance.objects.filter(agent_id__in=scope_agent_ids) if role == Role.AGENT else Remittance.objects.none()
        out['remittances'] = [
            {'id': rid('rem', r.id), 'agentId': rid('agt', r.agent_id), 'amount': num(r.amount), 'date': iso(r.date), 'reference': r.reference, 'recordedBy': ref(r.recorded_by_id)}
            for r in qs.order_by('date')
        ]

    if want('complaints'):
        cqs = Complaint.objects.filter(customer_id__in=cust_ids)
        ups: dict[int, list] = {}
        for u in ComplaintUpdate.objects.filter(complaint__in=cqs).order_by('at'):
            ups.setdefault(u.complaint_id, []).append({'at': iso(u.at), 'by': ref(u.by_id), 'note': u.note, 'status': u.status})
        out['complaints'] = [
            {'id': rid('cmp', c.id), 'number': c.number, 'customerId': rid('cus', c.customer_id), 'category': c.category, 'message': c.message, 'status': c.status, 'createdAt': iso(c.created_at), 'updates': ups.get(c.id, [])}
            for c in cqs.order_by('-created_at')
        ]

    if want('notifications'):
        me = user_ref(user)
        out['notifications'] = [
            {'id': rid('ntf', n.id), 'to': f'role:{n.role}' if n.role and not n.user_id else me, 'kind': n.kind, 'title': n.title, 'body': n.body, 'at': iso(n.at), 'read': n.read, 'link': fix_link(n.link) or None}
            for n in Notification.objects.filter(Q(user=user) | Q(role=role, user__isnull=True))[:200]
        ]

    if want('logs'):
        qs = ActivityLog.objects.select_related('actor')
        qs = qs[:500] if admin else qs.filter(actor=user)[:100]
        out['logs'] = [
            {'id': rid('log', l.id), 'at': iso(l.at), 'actorId': ref(l.actor_id), 'actorRole': l.actor.role if l.actor_id else 'admin', 'action': l.action, 'entity': l.entity, 'entityId': l.entity_id or None, 'detail': l.detail or None}
            for l in qs
        ]

    return out


def public_bootstrap(demo: bool) -> dict:
    """Pre-login data: agency details, locations (for self-registration), counts and — in demo mode — sample accounts."""
    data = {
        'settings': settings_dict(),
        'locations': locations_list(),
        'counts': {'subscribers': CustomerProfile.objects.count(), 'routes': Route.objects.count(), 'publications': Product.objects.filter(status='active').count()},
        'samples': [],
    }
    if demo:
        for role, model in ((Role.ADMIN, None), (Role.AGENT, AgentProfile), (Role.EXECUTIVE, ExecutiveProfile), (Role.CUSTOMER, CustomerProfile)):
            u = User.objects.filter(role=role, status='active').order_by('id').first()
            if u:
                data['samples'].append({'role': role, 'name': u.name, 'mobile': u.mobile, 'id': user_ref(u)})
    return data
