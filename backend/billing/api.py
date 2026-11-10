import secrets
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import Role
from core.access import Allows, can, customers_for
from core.billing import draft_invoice, generate_invoices, outstanding, q, record_payment
from engagement.services import log, notify

from .models import Invoice, InvoiceAdjustment, InvoiceLine, Payment, Remittance


class LineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        exclude = ['invoice']


class AdjustmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceAdjustment
        exclude = ['invoice']


class InvoiceSerializer(serializers.ModelSerializer):
    lines = LineSerializer(many=True, read_only=True)
    adjustments = AdjustmentSerializer(many=True, read_only=True)
    remaining = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    customer_name = serializers.CharField(source='customer.user.name', read_only=True)

    class Meta:
        model = Invoice
        fields = '__all__'


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    """Invoices are immutable once issued; only approved adjustments and payments change balances."""

    serializer_class = InvoiceSerializer
    filterset_fields = ['customer', 'agent', 'status', 'period_start']
    search_fields = ['number', 'customer__user__name']

    def get_queryset(self):
        return Invoice.objects.filter(customer__in=customers_for(self.request.user)).prefetch_related('lines', 'adjustments').select_related('customer__user')

    @action(detail=False, methods=['post'])
    def generate(self, request):
        """POST {period_start: 'YYYY-MM-01', customers?: [ids]} — one invoice per customer per month, never duplicated."""
        if not can(request.user, 'invoice.generate'):
            raise PermissionDenied()
        period = date.fromisoformat(request.data['period_start']).replace(day=1)
        if period > date.today():
            raise ValidationError({'detail': 'You cannot bill a month that has not started.'})
        customers = customers_for(request.user)
        if request.data.get('customers'):
            customers = customers.filter(id__in=request.data['customers'])
        r = generate_invoices(period, customers)
        for inv in r['invoices']:
            notify(inv.customer.user, 'invoice', 'New invoice', f'{inv.number}: ₹{inv.current_bill}. Total payable ₹{inv.current_bill + inv.previous_balance}.', '/invoices')
        log(request.user, 'invoice.generate', f'{period:%Y-%m}', f'{r["created"]} created, {r["skipped"]} already billed')
        return Response({'created': r['created'], 'skipped': r['skipped']})

    @action(detail=False)
    def preview(self, request):
        c = customers_for(request.user).get(pk=request.query_params['customer'])
        d = draft_invoice(c, date.fromisoformat(request.query_params['from']), date.fromisoformat(request.query_params['to']))
        d['lines'] = [{**l, 'subscription': l['subscription'].id, 'product': l['product'].id} for l in d['lines']]
        return Response(d)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def adjust(self, request, pk=None):
        if not can(request.user, 'invoice.adjust'):
            raise PermissionDenied()
        inv = self.get_object()
        amount = q(Decimal(str(request.data.get('amount', 0))))
        if not amount or not request.data.get('label'):
            raise ValidationError({'detail': 'Describe the adjustment and enter a non-zero amount.'})
        if inv.current_bill + amount < inv.paid:
            raise ValidationError({'detail': 'Adjustment would make the bill lower than the amount already paid.'})
        InvoiceAdjustment.objects.create(invoice=inv, label=request.data['label'], amount=amount, approved_by=request.user)
        inv.current_bill = q(inv.current_bill + amount)
        inv.refresh_status()
        inv.save(update_fields=['current_bill', 'status'])
        notify(inv.customer.user, 'invoice', 'Bill adjusted', f'{inv.number}: {request.data["label"]} (₹{amount}).', '/invoices')
        log(request.user, 'invoice.adjust', inv.number, f'{request.data["label"]}: {amount}')
        return Response(InvoiceSerializer(inv).data)


class PaymentSerializer(serializers.ModelSerializer):
    allocations = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = '__all__'

    def get_allocations(self, obj):
        return list(obj.allocations.values('invoice', 'invoice__number', 'amount'))


class CollectSerializer(serializers.Serializer):
    customer = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2)
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    idempotency_key = serializers.CharField(max_length=64)
    note = serializers.CharField(required=False, allow_blank=True)
    from_offline = serializers.BooleanField(required=False)


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PaymentSerializer
    filterset_fields = {'customer': ['exact'], 'method': ['exact'], 'date': ['exact', 'gte', 'lte'], 'verified': ['exact']}

    def get_queryset(self):
        return Payment.objects.filter(customer__in=customers_for(self.request.user)).order_by('-at')

    def _record(self, request, *, online: bool):
        s = CollectSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        if (v['method'] in Payment.ONLINE) != online:
            raise ValidationError({'method': 'Online payments go through the gateway; cash is recorded by staff.'})
        customer = customers_for(request.user).filter(pk=v['customer']).first()
        if not customer:
            raise PermissionDenied('This customer is not assigned to you.')
        gateway_ref = ''
        if online:
            if settings.PAYMENT_GATEWAY != 'simulated':
                raise ValidationError({'detail': 'Real gateway integration: create an order and confirm via webhook.'})
            if request.data.get('simulate') == 'failure':
                raise ValidationError({'detail': 'The demo gateway declined this payment. No amount was debited.'})
            gateway_ref = f'SIM-{"UPI" if v["method"] == "UPI" else "CARD"}-{secrets.randbelow(9 * 10**7) + 10**7}'
        pay, dup = record_payment(customer, v['amount'], v['method'], v['idempotency_key'], request.user, gateway_ref=gateway_ref, simulated=online, verified=online or request.user.role != Role.EXECUTIVE, note=v.get('note', ''))
        if not dup:
            notify(customer.user, 'payment_success', 'Payment received', f'₹{pay.amount} via {pay.method}. Receipt {pay.receipt_no}. Balance ₹{outstanding(customer)}.', '/payments')
            log(request.user, 'payment.record', customer.user.name, f'₹{pay.amount} · {pay.method}{" · simulated gateway" if online else ""}{" · offline sync" if v.get("from_offline") else ""}', pay.id)
        return Response({**PaymentSerializer(pay).data, 'duplicate': dup}, status=200 if dup else 201)

    @action(detail=False, methods=['post'])
    def collect(self, request):
        """Cash / agent / executive collection. Idempotent on idempotency_key (offline replays are safe)."""
        if not can(request.user, 'payment.collect'):
            raise PermissionDenied()
        return self._record(request, online=False)

    @action(detail=False, methods=['post'])
    def pay_online(self, request):
        """DEMO GATEWAY: no money moves, result flagged `simulated=true`, reference prefixed SIM-."""
        if not can(request.user, 'payment.online'):
            raise PermissionDenied()
        return self._record(request, online=True)

    @action(detail=True, methods=['post'])
    def verify(self, request, pk=None):
        if request.user.role not in (Role.ADMIN, Role.AGENT):
            raise PermissionDenied()
        p = self.get_object()
        p.verified = True
        p.save(update_fields=['verified'])
        return Response(PaymentSerializer(p).data)


class RemittanceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Remittance
        fields = '__all__'
        read_only_fields = ['recorded_by']


class RemittanceViewSet(viewsets.ModelViewSet):
    serializer_class = RemittanceSerializer
    permission_classes = [Allows('remittance.write')]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        u = self.request.user
        qs = Remittance.objects.all().order_by('-date')
        return qs if u.role == Role.ADMIN else qs.filter(agent=u.agent) if u.role == Role.AGENT else qs.none()

    def perform_create(self, serializer):
        r = serializer.save(recorded_by=self.request.user)
        notify(r.agent.user, 'payment_success', 'Remittance recorded', f'₹{r.amount} received by agency ({r.reference}).', '/settlements')
