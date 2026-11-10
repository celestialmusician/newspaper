from datetime import date, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.models import CustomerProfile, ExecutiveProfile, Role
from core.access import Allows, can, customers_for
from core.schedule import matches_frequency, occurrences
from crm.models import Subscription
from engagement.services import log, notify

from .models import DeliveryRecord, Handover, Holiday, Route, RouteStop, StockEntry


class HolidaySerializer(serializers.ModelSerializer):
    class Meta:
        model = Holiday
        fields = '__all__'


class HolidayViewSet(viewsets.ModelViewSet):
    """Holiday / strike rules. They suspend derived deliveries but never reduce bills."""

    queryset = Holiday.objects.all().order_by('-date')
    serializer_class = HolidaySerializer
    permission_classes = [Allows('holiday.write')]
    filterset_fields = ['type', 'date']

    def perform_create(self, serializer):
        h = serializer.save()
        log(self.request.user, 'holiday.create', h.name, f'{h.date} · {h.type}', h.id)
        if not h.delivery_applicable and h.date >= date.today():
            notify(['role:agent', 'role:executive'], 'delivery', f'{h.type}: {h.name}', f'No delivery on {h.date} in affected areas.', '/calendar')


class StopSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source='customer.user.name', read_only=True)
    lat = serializers.FloatField(source='customer.lat', read_only=True)
    lng = serializers.FloatField(source='customer.lng', read_only=True)

    class Meta:
        model = RouteStop
        fields = ['customer', 'customer_name', 'sequence', 'instructions', 'lat', 'lng']


class RouteSerializer(serializers.ModelSerializer):
    stops = StopSerializer(many=True, read_only=True)

    class Meta:
        model = Route
        fields = '__all__'
        read_only_fields = ['code', 'created_on']


class RouteViewSet(viewsets.ModelViewSet):
    serializer_class = RouteSerializer
    permission_classes = [Allows('route.write')]
    filterset_fields = ['agent', 'executive', 'status']

    def get_queryset(self):
        u = self.request.user
        qs = Route.objects.prefetch_related('stops__customer__user', 'areas')
        if u.role == Role.ADMIN:
            return qs
        if u.role == Role.AGENT:
            return qs.filter(agent=u.agent)
        if u.role == Role.EXECUTIVE:
            return qs.filter(executive=u.executive)
        return qs.none()

    def perform_create(self, serializer):
        u = self.request.user
        if u.role == Role.AGENT and serializer.validated_data['agent'] != u.agent:
            raise PermissionDenied('You can only manage your own routes.')
        r = serializer.save(code=f'RT-{Route.objects.count() + 1:02d}')
        if r.executive:
            Handover.objects.create(route=r, to_executive=r.executive, by=u, note='Initial assignment')
        log(u, 'route.create', r.name, '', r.id)

    def perform_destroy(self, instance):
        if instance.stops.exists() or DeliveryRecord.objects.filter(customer__route=instance).exists():
            raise ValidationError({'detail': 'Only unused routes can be deleted. Deactivate instead.'})
        instance.delete()

    @action(detail=True, methods=['put'])
    @transaction.atomic
    def stops(self, request, pk=None):
        """Replace the ordered stop list: [{customer, instructions}, …]."""
        r = self.get_object()
        items = request.data.get('stops', [])
        ids = [int(i['customer']) for i in items]
        allowed = set(customers_for(request.user).values_list('id', flat=True))
        if not set(ids) <= allowed:
            raise PermissionDenied('Some customers are not assigned to you.')
        r.customers.exclude(id__in=ids).update(route=None)
        RouteStop.objects.filter(route=r).exclude(customer_id__in=ids).delete()
        RouteStop.objects.filter(customer_id__in=ids).exclude(route=r).delete()
        for seq, item in enumerate(items, start=1):
            RouteStop.objects.update_or_create(customer_id=item['customer'], defaults={'route': r, 'sequence': seq, 'instructions': item.get('instructions', '')})
        CustomerProfile.objects.filter(id__in=ids).update(route=r)
        if r.executive:
            notify(r.executive.user, 'route', 'Route changes', f'{r.name}: delivery sequence updated.', '/routes')
        log(request.user, 'route.sequence', r.name, f'{len(ids)} stops', r.id)
        return Response(RouteSerializer(r).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def handover(self, request, pk=None):
        """Every stop, pin, subscription, schedule and instruction moves with the route; history stays put."""
        if not can(request.user, 'route.handover'):
            raise PermissionDenied()
        r = self.get_object()
        to = ExecutiveProfile.objects.filter(pk=request.data.get('to_executive'), user__status='active').first()
        if not to or (request.user.role == Role.AGENT and to.agent != request.user.agent):
            raise ValidationError({'to_executive': 'Select an active delivery executive from your agency.'})
        prev = r.executive
        r.executive = to
        r.save(update_fields=['executive'])
        to.areas.add(*r.areas.all())
        Handover.objects.create(route=r, from_executive=prev, to_executive=to, by=request.user, note=request.data.get('note', ''))
        notify(to.user, 'route', 'New route assignment', f'{r.name}: {r.stops.count()} customers with addresses, pins and instructions are now on your app.', '/routes')
        if prev:
            notify(prev.user, 'route', 'Route handed over', f'{r.name} is now handled by {to.user.name}.', '/routes')
        log(request.user, 'route.handover', r.name, f'{prev.user.name if prev else "Unassigned"} → {to.user.name}', r.id)
        return Response(RouteSerializer(r).data)


class DeliverySerializer(serializers.ModelSerializer):
    class Meta:
        model = DeliveryRecord
        fields = '__all__'


class DeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = DeliverySerializer
    filterset_fields = {'date': ['exact', 'gte', 'lte'], 'status': ['exact'], 'customer': ['exact'], 'executive': ['exact']}

    def get_queryset(self):
        return DeliveryRecord.objects.filter(customer__in=customers_for(self.request.user)).order_by('-date')

    @action(detail=False, methods=['post'])
    def mark(self, request):
        """Idempotent upsert. Body: {subscription, date, status: delivered|missed|clear, reason?, remarks?, from_offline?}."""
        u = request.user
        if not can(u, 'delivery.mark'):
            raise PermissionDenied()
        sub = Subscription.objects.filter(pk=request.data.get('subscription'), customer__in=customers_for(u)).select_related('customer__route__executive').first()
        if not sub:
            raise PermissionDenied('This customer is not assigned to you.')
        d = date.fromisoformat(request.data['date'])
        st = request.data.get('status')
        if not matches_frequency(sub, d):
            raise ValidationError({'detail': 'No delivery is scheduled for this date.'})
        if d > date.today():
            raise ValidationError({'detail': 'Future deliveries cannot be marked yet.'})
        if u.role == Role.EXECUTIVE and d < date.today() - timedelta(days=2):
            raise PermissionDenied('Executives can update the last 2 days only.')
        if st == 'clear':
            DeliveryRecord.objects.filter(subscription=sub, date=d).delete()
            return Response({'result': 'cleared'})
        if st == 'missed' and not request.data.get('reason'):
            raise ValidationError({'reason': 'Choose a reason for the missed delivery.'})
        ex = u.executive if u.role == Role.EXECUTIVE else (sub.customer.route.executive if sub.customer.route_id else None)
        try:
            rec, created = DeliveryRecord.objects.update_or_create(
                subscription=sub, date=d,
                defaults=dict(customer=sub.customer, product=sub.product, status=st, quantity=sub.quantity, executive=ex, actual_at=timezone.now() if st == 'delivered' else None, updated_by=u, reason=request.data.get('reason', ''), remarks=request.data.get('remarks', ''), synced_from_offline=bool(request.data.get('from_offline'))),
            )
        except IntegrityError:  # concurrent replay — the unique constraint already holds the record
            rec, created = DeliveryRecord.objects.get(subscription=sub, date=d), False
        _sync_distributed(sub.customer.agent_id, sub.product_id, d)
        if st == 'missed':
            notify([sub.customer.agent.user, sub.customer.user], 'delivery', 'Delivery missed', f'{sub.product.name} on {d}: {rec.reason}.', '/deliveries')
        return Response(DeliverySerializer(rec).data, status=201 if created else 200)


def _sync_distributed(agent_id, product_id, d):
    total = DeliveryRecord.objects.filter(customer__agent_id=agent_id, product_id=product_id, date=d, status='delivered').aggregate(s=Sum('quantity'))['s'] or 0
    StockEntry.objects.filter(agent_id=agent_id, product_id=product_id, date=d).update(distributed=total)


@api_view(['GET'])
def calendar(request):
    """GET /api/calendar/?from=YYYY-MM-DD&to=YYYY-MM-DD[&customer=&route=&product=] — derived occurrences."""
    start = date.fromisoformat(request.query_params.get('from', date.today().isoformat()))
    end = date.fromisoformat(request.query_params.get('to', (start + timedelta(days=30)).isoformat()))
    if (end - start).days > 62:
        raise ValidationError({'detail': 'Range limited to 62 days.'})
    subs = Subscription.objects.filter(customer__in=customers_for(request.user))
    for f in ('customer', 'product'):
        if request.query_params.get(f):
            subs = subs.filter(**{f: request.query_params[f]})
    if request.query_params.get('route'):
        subs = subs.filter(customer__route=request.query_params['route'])
    data = [
        {'subscription': o.subscription.id, 'customer': o.subscription.customer_id, 'product': o.subscription.product_id, 'product_name': o.subscription.product.name, 'date': o.date, 'status': o.status, 'quantity': o.quantity, 'holiday': o.holiday and o.holiday.name}
        for o in occurrences(subs, start, end)
    ]
    return Response(data)


class StockSerializer(serializers.ModelSerializer):
    remaining = serializers.IntegerField(read_only=True)

    class Meta:
        model = StockEntry
        fields = '__all__'
        read_only_fields = ['distributed', 'updated_by', 'updated_at', 'reconciled']


class StockViewSet(viewsets.ModelViewSet):
    serializer_class = StockSerializer
    permission_classes = [Allows('stock.write')]
    filterset_fields = {'date': ['exact', 'gte', 'lte'], 'product': ['exact'], 'agent': ['exact']}
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        u = self.request.user
        qs = StockEntry.objects.select_related('product')
        if u.role == Role.ADMIN:
            return qs
        if u.role == Role.AGENT:
            return qs.filter(agent=u.agent)
        return qs.none()

    def create(self, request, *args, **kwargs):
        """Upsert on (date, product, agent) — a day's ledger row is never duplicated."""
        s = StockSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        v = s.validated_data
        if request.user.role == Role.AGENT and v['agent'] != request.user.agent:
            raise PermissionDenied('You can only update your own agency stock.')
        e, _ = StockEntry.objects.update_or_create(date=v['date'], product=v['product'], agent=v['agent'], defaults={**{k: v.get(k, 0) for k in ('opening', 'received', 'returned', 'damaged')}, 'updated_by': request.user, 'reconciled': False})
        _sync_distributed(e.agent_id, e.product_id, e.date)
        e.refresh_from_db()
        if e.remaining < e.product.low_stock_threshold:
            notify(['role:admin', e.agent.user], 'stock', f'Low stock: {e.product.name}', f'Only {e.remaining} copies left on {e.date}.', '/stock')
        return Response(StockSerializer(e).data)

    @action(detail=True, methods=['post'])
    def reconcile(self, request, pk=None):
        e = self.get_object()
        e.reconciled = True
        e.updated_by = request.user
        e.save(update_fields=['reconciled', 'updated_by', 'updated_at'])
        return Response(StockSerializer(e).data)
