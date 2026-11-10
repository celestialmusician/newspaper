"""Load the Kerala demo dataset exported from the frontend (fixtures/demo_seed.json).

    python manage.py seed_demo            # load (refuses if data exists)
    python manage.py seed_demo --reset    # wipe NewsRound data and reload

Regenerate the fixture with: cd frontend && node scripts/export-seed.mjs ../backend/fixtures/demo_seed.json
"""
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import AgentProfile, CustomerProfile, ExecutiveProfile, Role, User
from billing.models import Invoice, InvoiceAdjustment, InvoiceLine, Payment, PaymentAllocation, Remittance
from catalog.models import PriceVersion, Product
from crm.models import Discount, Subscription, SubscriptionEvent, SubscriptionPause
from distribution.models import DeliveryRecord, Handover, Holiday, Route, RouteStop, StockEntry
from engagement.models import ActivityLog, Complaint, ComplaintUpdate, Notification, SystemSettings
from geo.models import Location

D = lambda s: date.fromisoformat(s) if s else None  # noqa: E731
DT = lambda s: datetime.fromisoformat(s.replace('Z', '+00:00')) if s else None  # noqa: E731
M = lambda v: Decimal(str(v))  # noqa: E731


class Command(BaseCommand):
    help = 'Load the interconnected Kerala demo dataset.'

    def add_arguments(self, parser):
        parser.add_argument('--reset', action='store_true')
        parser.add_argument('--file', default=str(Path(settings.BASE_DIR) / 'fixtures' / 'demo_seed.json'))

    @transaction.atomic
    def handle(self, *args, **opts):
        if User.objects.exists():
            if not opts['reset']:
                raise CommandError('Data already exists. Use --reset to wipe and reload.')
            for m in [Notification, ActivityLog, ComplaintUpdate, Complaint, PaymentAllocation, Payment, Remittance, InvoiceAdjustment, InvoiceLine, Invoice, DeliveryRecord, StockEntry, Handover, RouteStop, Discount, SubscriptionEvent, SubscriptionPause, Subscription, Holiday, PriceVersion, CustomerProfile, Route, ExecutiveProfile, AgentProfile, Product, User, Location]:
                m.objects.all().delete()
        db = json.loads(Path(opts['file']).read_text(encoding='utf-8'))

        s = db['settings']
        SystemSettings.objects.update_or_create(pk=1, defaults=dict(
            agency_name=s['agencyName'], agency_address=s['agencyAddress'], gstin=s['gstin'], support_phone=s['supportPhone'], invoice_prefix=s['invoicePrefix'], receipt_prefix=s['receiptPrefix'],
            billing_due_days=s['billingDueDays'], admin_max_discount_pct=s['adminMaxDiscountPct'], default_agent_max_discount_pct=s['defaultAgentMaxDiscountPct'],
            agent_price_max_markup_pct=s['agentPriceMaxMarkupPct'], low_stock_default=s['lowStockDefault'], overdue_after_days=s['overdueAfterDays'],
        ))

        loc = {}
        pending = list(db['locations'])
        while pending:
            rest = []
            for l in pending:
                if l['parentId'] and l['parentId'] not in loc:
                    rest.append(l)
                    continue
                loc[l['id']] = Location.objects.create(ext_id=l['id'], level=l['level'], name=l['name'], parent=loc.get(l['parentId']), pincode=l.get('pincode', ''), lat=l.get('lat'), lng=l.get('lng'))
            pending = rest

        users = {}
        for a in db['admins']:
            u = User.objects.create(role=Role.ADMIN, mobile=a['mobile'], name=a['name'], email=a['email'], ext_id=a['id'], is_staff=True)
            users[a['id']] = u
        agents = {}
        for a in db['agents']:
            u = User.objects.create(role=Role.AGENT, mobile=a['mobile'], name=a['name'], ext_id=a['id'], status=a['status'])
            users[a['id']] = u
            ag = AgentProfile.objects.create(user=u, code=a['code'], agency_name=a['agencyName'], email=a['email'], max_discount_pct=a['maxDiscountPct'], can_manage_routes=a['canManageRoutes'], joining_date=D(a['joiningDate']))
            ag.areas.set([loc[x] for x in a['areaIds']])
            agents[a['id']] = ag
        execs = {}
        for e in db['executives']:
            u = User.objects.create(role=Role.EXECUTIVE, mobile=e['mobile'], name=e['name'], ext_id=e['id'], status=e['status'])
            users[e['id']] = u
            ex = ExecutiveProfile.objects.create(user=u, code=e['code'], agent=agents[e['agentId']], joining_date=D(e['joiningDate']), can_collect_cash=e['canCollectCash'], alt_mobile=e.get('altMobile') or '', alt_mobile_relation=e.get('altMobileRelation') or '')
            ex.areas.set([loc[x] for x in e['areaIds']])
            execs[e['id']] = ex
        routes = {}
        for r in db['routes']:
            rt = Route.objects.create(ext_id=r['id'], code=r['code'], name=r['name'], agent=agents[r['agentId']], executive=execs.get(r['executiveId']), instructions=r['instructions'], status=r['status'])
            rt.areas.set([loc[x] for x in r['areaIds']])
            routes[r['id']] = rt
        custs = {}
        for c in db['customers']:
            u = User.objects.create(role=Role.CUSTOMER, mobile=c['mobile'], name=c['name'], ext_id=c['id'], status=c['status'])
            users[c['id']] = u
            custs[c['id']] = CustomerProfile.objects.create(
                user=u, code=c['code'], alt_mobile=c.get('altMobile') or '', whatsapp=c.get('whatsapp') or '', email=c.get('email') or '', gender=c.get('gender') or '', dob=D(c.get('dob')),
                area=loc[c['areaId']], house_name=c['houseName'], landmark=c.get('landmark') or '', address=c['address'], lat=c['lat'], lng=c['lng'], agent=agents[c['agentId']],
                route=routes.get(c['routeId']), id_proof=c['idProof'], id_number=c.get('idNumber') or '', security_deposit=c['securityDeposit'], handling_charge=c['handlingCharge'], registered_on=D(c['registeredOn']),
            )
        for r in db['routes']:
            for i, st in enumerate(r['stops'], start=1):
                RouteStop.objects.create(route=routes[r['id']], customer=custs[st['customerId']], sequence=i, instructions=st.get('instructions') or '')

        prods = {}
        for p in db['products']:
            prods[p['id']] = Product.objects.create(ext_id=p['id'], code=p['code'], name=p['name'], category=p['category'], publisher=p['publisher'], language=p['language'], product_type=p['type'], description=p['description'], availability=p['availability'], default_frequency=p['defaultFrequency'], status=p['status'], color=p['color'], low_stock_threshold=p['lowStockThreshold'])
        for v in db['prices']:
            PriceVersion.objects.create(product=prods[v['productId']], agent=agents.get(v['agentId']), purchase_price=M(v['purchasePrice']), agent_price=M(v['agentPrice']), customer_price=M(v['customerPrice']), effective_from=D(v['effectiveFrom']), note=v.get('note') or '', created_by=users.get(v['createdBy']))

        subs = {}
        for s_ in db['subscriptions']:
            sub = Subscription.objects.create(ext_id=s_['id'], customer=custs[s_['customerId']], product=prods[s_['productId']], start_date=D(s_['startDate']), end_date=D(s_['endDate']), frequency=s_['frequency'], weekdays=s_['weekdays'], month_days=s_['monthDays'], custom_dates=s_['customDates'], quantity=s_['quantity'], status=s_['status'], cancelled_on=D(s_.get('cancelledOn')))
            for p in s_['pauses']:
                SubscriptionPause.objects.create(subscription=sub, date_from=D(p['from']), date_to=D(p['to']), reason=p.get('reason') or '')
            subs[s_['id']] = sub
        for ev in db['subscriptionEvents']:
            SubscriptionEvent.objects.create(subscription=subs[ev['subscriptionId']], by=users.get(ev['by']), action=ev['action'], detail=ev['detail'])

        for h in db['holidays']:
            hol = Holiday.objects.create(name=h['name'], date=D(h['date']), type=h['type'], delivery_applicable=h['deliveryApplicable'], description=h['description'])
            hol.locations.set([loc[x] for x in h['locationIds']])
            hol.products.set([prods[x] for x in h['productIds']])
        for h in db['handovers']:
            Handover.objects.create(route=routes[h['routeId']], from_executive=execs.get(h['fromExecutiveId']), to_executive=execs[h['toExecutiveId']], by=users.get(h['by']), note=h.get('note') or '')

        DeliveryRecord.objects.bulk_create([
            DeliveryRecord(subscription=subs[r['subscriptionId']], customer=custs[r['customerId']], product=prods[r['productId']], date=D(r['date']), status=r['status'], quantity=r['quantity'], executive=execs.get(r['executiveId']), actual_at=DT(r['actualAt']), updated_by=users.get(r['updatedBy']), reason=r.get('reason') or '', remarks=r.get('remarks') or '')
            for r in db['deliveries'].values()
        ], batch_size=500)
        StockEntry.objects.bulk_create([
            StockEntry(date=D(e['date']), product=prods[e['productId']], agent=agents[e['agentId']], opening=e['opening'], received=e['received'], distributed=e['distributed'], returned=e['returned'], damaged=e['damaged'], reconciled=e['reconciled'], updated_by=users.get(e['updatedBy']))
            for e in db['stock'].values()
        ], batch_size=500)
        for d in db['discounts']:
            Discount.objects.create(customer=custs[d['customerId']], subscription=subs.get(d['subscriptionId']), kind=d['kind'], category=d['category'], value=M(d['value']), start_date=D(d['startDate']), expiry_date=D(d['expiryDate']), reason=d['reason'], approved_by=users.get(d['approvedBy']), revoked=bool(d.get('revoked')))

        invs = {}
        for i in db['invoices']:
            inv = Invoice.objects.create(number=i['number'], customer=custs[i['customerId']], agent=agents[i['agentId']], period_start=D(i['periodStart']), period_end=D(i['periodEnd']), issued_on=D(i['issuedOn']), due_date=D(i['dueDate']), subtotal=M(i['subtotal']), discount=M(i['discount']), handling_charge=M(i['handlingCharge']), current_bill=M(i['currentBill']), previous_balance=M(i['previousBalance']), paid=M(i['paid']), status=i['status'])
            InvoiceLine.objects.bulk_create([InvoiceLine(invoice=inv, subscription=subs[l['subscriptionId']], product=prods[l['productId']], product_name=l['productName'], deliveries=l['deliveries'], quantity=l['quantity'], unit_price=M(l['unitPrice']), agent_price=M(l['agentPrice']), purchase_price=M(l['purchasePrice']), amount=M(l['amount'])) for l in i['lines']])
            for a in i['adjustments']:
                InvoiceAdjustment.objects.create(invoice=inv, label=a['label'], amount=M(a['amount']), approved_by=users.get(a['approvedBy']))
            invs[i['id']] = inv
        for p in db['payments']:
            pay = Payment.objects.create(receipt_no=p['receiptNo'], customer=custs[p['customerId']], agent=agents[p['agentId']], amount=M(p['amount']), method=p['method'], date=D(p['date']), collected_by=users.get(p['collectedBy']), gateway_ref=p.get('gatewayRef') or '', simulated=p['simulated'], verified=p['verified'], idempotency_key=p['idempotencyKey'], note=p.get('note') or '')
            for a in p['allocations']:
                PaymentAllocation.objects.create(payment=pay, invoice=invs[a['invoiceId']], amount=M(a['amount']))
        for r in db['remittances']:
            Remittance.objects.create(agent=agents[r['agentId']], amount=M(r['amount']), date=D(r['date']), reference=r['reference'], recorded_by=users.get(r['recordedBy']))

        for c in db['complaints']:
            cm = Complaint.objects.create(number=c['number'], customer=custs[c['customerId']], category=c['category'], message=c['message'], status=c['status'])
            for u in c['updates']:
                ComplaintUpdate.objects.create(complaint=cm, by=users.get(u['by']), note=u['note'], status=u['status'])
        for n in db['notifications']:
            role = n['to'][5:] if n['to'].startswith('role:') else ''
            Notification.objects.create(user=None if role else users.get(n['to']), role=role, kind=n['kind'], title=n['title'], body=n['body'], link=n.get('link') or '', read=n['read'])
        for l in db['logs']:
            ActivityLog.objects.create(actor=users.get(l['actorId']), action=l['action'], entity=l['entity'], detail=l.get('detail') or '')

        self.stdout.write(self.style.SUCCESS(
            f"Seeded {Location.objects.count()} locations, {AgentProfile.objects.count()} agents, {ExecutiveProfile.objects.count()} executives, {CustomerProfile.objects.count()} customers, "
            f"{Product.objects.count()} products, {Subscription.objects.count()} subscriptions, {DeliveryRecord.objects.count()} deliveries, {Invoice.objects.count()} invoices, {Payment.objects.count()} payments."
        ))
