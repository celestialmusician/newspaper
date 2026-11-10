"""End-to-end API tests against the Kerala demo dataset."""
from datetime import date, timedelta
from decimal import Decimal

from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomerProfile, User
from billing.models import Invoice, Payment
from core.billing import draft_invoice, outstanding
from crm.models import Subscription
from distribution.models import DeliveryRecord


class ApiFlowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('seed_demo', verbosity=0)

    def login(self, role, mobile):
        c = APIClient()
        r = c.post('/api/auth/otp/request/', {'role': role, 'mobile': mobile}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = c.post('/api/auth/otp/verify/', {'role': role, 'mobile': mobile, 'otp': r.json()['demo_otp']}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        r = c.post('/api/auth/mpin/set/', {'role': role, 'mobile': mobile, 'mpin': '2580', 'otp_token': r.json()['otp_token']}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        c.credentials(HTTP_AUTHORIZATION=f'Bearer {r.json()["access"]}')
        # Subsequent login uses MPIN only
        r2 = APIClient().post('/api/auth/mpin/login/', {'role': role, 'mobile': mobile, 'mpin': '2580'}, format='json')
        self.assertEqual(r2.status_code, 200)
        return c

    def user(self, ext):
        return User.objects.get(ext_id=ext)

    def test_auth_rejects_wrong_role_and_weak_mpin(self):
        admin = self.user('adm_1')
        r = APIClient().post('/api/auth/lookup/', {'role': 'agent', 'mobile': admin.mobile}, format='json')
        self.assertEqual(r.status_code, 400)
        c = APIClient()
        otp = c.post('/api/auth/otp/request/', {'role': 'admin', 'mobile': admin.mobile}, format='json').json()['demo_otp']
        tok = c.post('/api/auth/otp/verify/', {'role': 'admin', 'mobile': admin.mobile, 'otp': otp}, format='json').json()['otp_token']
        r = c.post('/api/auth/mpin/set/', {'role': 'admin', 'mobile': admin.mobile, 'mpin': '1111', 'otp_token': tok}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_invoice_history_keeps_old_price_and_ignores_holidays(self):
        arun = CustomerProfile.objects.get(user__ext_id='cus_1')
        sep, octo = Invoice.objects.filter(customer=arun).order_by('period_start')
        mm_sep = sep.lines.get(product__code='MM')
        mm_oct = octo.lines.get(product__code='MM')
        self.assertEqual(mm_sep.unit_price, Decimal('9.00'))  # before the price revision
        self.assertEqual(mm_oct.unit_price, Decimal('10.00'))
        self.assertEqual(mm_oct.deliveries, 31)  # hartal + newspaper holiday do not reduce the bill
        # Python engine reproduces the frontend-generated invoice exactly
        d = draft_invoice(arun, octo.period_start, octo.period_end)
        self.assertEqual(d['current_bill'], octo.current_bill)

    def test_agent_scoping(self):
        c = self.login('agent', self.user('agt_1').mobile)
        ids = {x['id'] for x in c.get('/api/customers/?page_size=100').json()['results']}
        self.assertEqual(len(ids), CustomerProfile.objects.filter(agent__user__ext_id='agt_1').count())
        other = CustomerProfile.objects.get(user__ext_id='cus_20')
        self.assertEqual(c.get(f'/api/customers/{other.id}/').status_code, 404)
        self.assertEqual(c.post('/api/products/', {'name': 'X'}, format='json').status_code, 403)
        self.assertEqual(c.get('/api/activity/').status_code, 403)

    def test_executive_mark_delivery_is_idempotent(self):
        c = self.login('executive', self.user('exe_1').mobile)
        sub = Subscription.objects.filter(customer__route__executive__user__ext_id='exe_1', frequency='daily', cancelled_on__isnull=True).first()
        today = date.today().isoformat()
        for _ in range(3):  # double taps / offline replay
            r = c.post('/api/deliveries/mark/', {'subscription': sub.id, 'date': today, 'status': 'delivered', 'from_offline': True}, format='json')
            self.assertIn(r.status_code, (200, 201), r.content)
        self.assertEqual(DeliveryRecord.objects.filter(subscription=sub, date=today).count(), 1)
        r = c.post('/api/deliveries/mark/', {'subscription': sub.id, 'date': (date.today() - timedelta(days=10)).isoformat(), 'status': 'delivered'}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_cash_collection_idempotent_and_fifo(self):
        c = self.login('executive', self.user('exe_1').mobile)
        arun = CustomerProfile.objects.get(user__ext_id='cus_1')
        before = outstanding(arun)
        body = {'customer': arun.id, 'amount': '100', 'method': 'Delivery Executive Collection', 'idempotency_key': 'k-123'}
        r1 = c.post('/api/payments/collect/', body, format='json')
        r2 = c.post('/api/payments/collect/', body, format='json')
        self.assertEqual(r1.status_code, 201, r1.content)
        self.assertTrue(r2.json()['duplicate'])
        self.assertEqual(Payment.objects.filter(idempotency_key='k-123').count(), 1)
        self.assertEqual(outstanding(arun), before - 100)
        self.assertFalse(r1.json()['verified'])  # executive cash awaits agent verification
        over = c.post('/api/payments/collect/', {**body, 'idempotency_key': 'k-124', 'amount': '99999'}, format='json')
        self.assertEqual(over.status_code, 400)

    def test_customer_simulated_payment_and_subscription_lifecycle(self):
        c = self.login('customer', self.user('cus_1').mobile)
        arun = CustomerProfile.objects.get(user__ext_id='cus_1')
        fail = c.post('/api/payments/pay_online/', {'customer': arun.id, 'amount': '50', 'method': 'UPI', 'idempotency_key': 'o1', 'simulate': 'failure'}, format='json')
        self.assertEqual(fail.status_code, 400)
        ok = c.post('/api/payments/pay_online/', {'customer': arun.id, 'amount': '50', 'method': 'UPI', 'idempotency_key': 'o2'}, format='json').json()
        self.assertTrue(ok['simulated'])
        self.assertTrue(ok['gateway_ref'].startswith('SIM-'))
        sub = Subscription.objects.filter(customer=arun, product__code='MM').first()
        start = (date.today() + timedelta(days=2)).isoformat()
        self.assertEqual(c.post(f'/api/subscriptions/{sub.id}/pause/', {'from': start, 'reason': 'Trip'}, format='json').status_code, 200)
        cal = c.get(f'/api/calendar/?from={start}&to={start}&customer={arun.id}').json()
        self.assertTrue(any(o['status'] == 'paused' for o in cal if o['subscription'] == sub.id))
        self.assertEqual(c.post(f'/api/subscriptions/{sub.id}/resume/', {'on': start}, format='json').status_code, 200)
        other = Subscription.objects.exclude(customer=arun).first()
        self.assertEqual(c.post(f'/api/subscriptions/{other.id}/pause/', {'from': start}, format='json').status_code, 404)

    def test_generate_invoices_never_duplicates(self):
        c = self.login('admin', self.user('adm_1').mobile)
        period = date.today().replace(day=1).isoformat()
        first = c.post('/api/invoices/generate/', {'period_start': period}, format='json').json()
        second = c.post('/api/invoices/generate/', {'period_start': period}, format='json').json()
        self.assertGreater(first['created'], 0)
        self.assertEqual(second['created'], 0)
        self.assertEqual(second['skipped'], first['created'])

    def test_executive_alternate_contact_is_required_and_staff_only(self):
        admin = self.login('admin', self.user('adm_1').mobile)
        ex = User.objects.get(ext_id='exe_1').executive
        r = admin.patch(f'/api/executives/{ex.id}/', {'alt_mobile': ''}, format='json')
        self.assertEqual(r.status_code, 400)
        r = admin.patch(f'/api/executives/{ex.id}/', {'alt_mobile': ex.user.mobile}, format='json')
        self.assertEqual(r.status_code, 400)
        r = admin.patch(f'/api/executives/{ex.id}/', {'alt_mobile': '9447100001', 'alt_mobile_relation': 'Spouse'}, format='json')
        self.assertEqual(r.status_code, 200, r.content)
        snap = admin.get('/api/sync/snapshot/?only=executives').json()['executives']
        mine = next(e for e in snap if e['id'] == f'exe_{ex.id}')
        self.assertEqual((mine['altMobile'], mine['altMobileRelation']), ('9447100001', 'Spouse'))
        # A subscriber sees their executive's name and number, never the family contact.
        cust = self.login('customer', self.user('cus_1').mobile)
        for e in cust.get('/api/sync/snapshot/?only=executives').json()['executives']:
            self.assertNotIn('altMobile', e)
