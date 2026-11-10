from datetime import date, timedelta

from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from core.access import Allows, can, customers_for
from core.billing import draft_invoice
from core.schedule import derive_status
from engagement.models import SystemSettings
from engagement.services import log, notify

from .models import Discount, Subscription, SubscriptionEvent, SubscriptionPause

RULES = {'weekly': ('weekdays', 1), 'twice_weekly': ('weekdays', 2), 'monthly': ('month_days', 1), 'twice_monthly': ('month_days', 2)}


class PauseSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPause
        fields = ['id', 'date_from', 'date_to', 'reason']


class SubscriptionSerializer(serializers.ModelSerializer):
    pauses = PauseSerializer(many=True, read_only=True)
    derived_status = serializers.SerializerMethodField()

    class Meta:
        model = Subscription
        fields = '__all__'
        read_only_fields = ['status', 'cancelled_on', 'created_on']

    def get_derived_status(self, obj):
        return derive_status(obj)

    def validate(self, a):
        f = a.get('frequency', getattr(self.instance, 'frequency', None))
        if f in RULES:
            field, n = RULES[f]
            if len(a.get(field, getattr(self.instance, field, []) or [])) != n:
                raise ValidationError({field: f'{f.replace("_", " ").title()}: choose exactly {n}.'})
        if f == 'custom' and not a.get('custom_dates', getattr(self.instance, 'custom_dates', [])):
            raise ValidationError({'custom_dates': 'Pick at least one delivery date.'})
        end, start = a.get('end_date'), a.get('start_date', getattr(self.instance, 'start_date', None))
        if end and start and end < start:
            raise ValidationError({'end_date': 'End date must be after the start date.'})
        product = a.get('product')
        if product and product.status != 'active':
            raise ValidationError({'product': 'Select an active product.'})
        return a


class SubscriptionViewSet(viewsets.ModelViewSet):
    """Subscriptions + lifecycle actions. Calendar and billing derive from these rows automatically."""

    serializer_class = SubscriptionSerializer
    filterset_fields = ['customer', 'product', 'frequency', 'status']
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        return Subscription.objects.filter(customer__in=customers_for(self.request.user)).select_related('product', 'customer__user').prefetch_related('pauses')

    def _guard(self, customer):
        if not can(self.request.user, 'subscription.write') or not customers_for(self.request.user).filter(pk=customer.pk).exists():
            raise PermissionDenied('This customer is not assigned to you.')

    def _event(self, sub, action_, detail):
        SubscriptionEvent.objects.create(subscription=sub, by=self.request.user, action=action_, detail=detail)
        sub.status = derive_status(sub)
        sub.save(update_fields=['status'])
        c = sub.customer
        to = [x for x in [c.user, c.agent.user, c.route.executive.user if c.route_id and c.route.executive_id else None] if x and x != self.request.user]
        notify(to, 'subscription', f'Subscription {action_}', f'{c.user.name}: {sub.product.name} — {detail}', '/subscriptions')

    @transaction.atomic
    def perform_create(self, serializer):
        c = serializer.validated_data['customer']
        self._guard(c)
        dup = Subscription.objects.filter(customer=c, product=serializer.validated_data['product'], cancelled_on__isnull=True).exclude(end_date__lt=date.today())
        if dup.exists():
            raise ValidationError({'detail': 'Already subscribed — edit the existing subscription instead.'})
        sub = serializer.save()
        self._event(sub, 'created', f'{sub.frequency} · qty {sub.quantity}')
        log(self.request.user, 'subscription.create', sub.product.name, c.user.name, sub.id)

    def perform_update(self, serializer):
        self._guard(serializer.instance.customer)
        sub = serializer.save()
        self._event(sub, 'edited', ', '.join(serializer.validated_data))

    @action(detail=True, methods=['post'])
    def pause(self, request, pk=None):
        sub = self.get_object()
        self._guard(sub.customer)
        start = date.fromisoformat(request.data['from'])
        end = date.fromisoformat(request.data['to']) if request.data.get('to') else None
        if start < date.today():
            raise ValidationError({'detail': 'Pause cannot start in the past.'})
        if sub.pauses.filter(date_to__isnull=True).exists() or sub.pauses.filter(date_to__gte=start, date_from__lte=end or date.max).exists():
            raise ValidationError({'detail': 'This period overlaps an existing pause.'})
        SubscriptionPause.objects.create(subscription=sub, date_from=start, date_to=end, reason=request.data.get('reason', ''))
        self._event(sub, 'paused', f'{start} → {end or "until resumed"}')
        return Response(SubscriptionSerializer(sub).data)

    @action(detail=True, methods=['post'])
    def resume(self, request, pk=None):
        sub = self.get_object()
        self._guard(sub.customer)
        on = date.fromisoformat(request.data.get('on', date.today().isoformat()))
        open_ = sub.pauses.filter(date_to__isnull=True) | sub.pauses.filter(date_to__gte=on)
        if not open_.exists():
            raise ValidationError({'detail': 'No active or upcoming pause.'})
        for p in open_:
            if p.date_from >= on:
                p.delete()
            else:
                p.date_to = on - timedelta(days=1)
                p.save()
        self._event(sub, 'resumed', f'from {on}')
        return Response(SubscriptionSerializer(sub).data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        sub = self.get_object()
        self._guard(sub.customer)
        sub.cancelled_on = date.fromisoformat(request.data.get('effective', (date.today() + timedelta(days=1)).isoformat()))
        sub.save(update_fields=['cancelled_on'])
        self._event(sub, 'cancelled', f'effective {sub.cancelled_on}')
        return Response(SubscriptionSerializer(sub).data)

    @action(detail=True, methods=['post'])
    def renew(self, request, pk=None):
        sub = self.get_object()
        self._guard(sub.customer)
        sub.end_date = date.fromisoformat(request.data['end_date']) if request.data.get('end_date') else None
        sub.cancelled_on = None
        sub.save(update_fields=['end_date', 'cancelled_on'])
        self._event(sub, 'renewed', f'till {sub.end_date or "no end date"}')
        return Response(SubscriptionSerializer(sub).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def change(self, request, pk=None):
        """Switch product: old subscription ends the day before the new one starts; both keep history."""
        old = self.get_object()
        self._guard(old.customer)
        s = SubscriptionSerializer(data={**request.data, 'customer': old.customer_id})
        s.is_valid(raise_exception=True)
        new = s.save()
        old.cancelled_on = new.start_date
        old.save(update_fields=['cancelled_on'])
        self._event(old, 'changed', f'replaced by {new.product.name}')
        self._event(new, 'changed', f'switched from {old.product.name}')
        return Response(SubscriptionSerializer(new).data, status=201)

    @action(detail=True)
    def history(self, request, pk=None):
        sub = self.get_object()
        return Response(list(sub.events.values('at', 'action', 'detail', 'by__name')))


class DiscountSerializer(serializers.ModelSerializer):
    class Meta:
        model = Discount
        fields = '__all__'
        read_only_fields = ['approved_by', 'created_at', 'revoked']


class DiscountViewSet(viewsets.ModelViewSet):
    serializer_class = DiscountSerializer
    permission_classes = [Allows('discount.write')]
    filterset_fields = ['customer', 'kind', 'category']
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return Discount.objects.filter(customer__in=customers_for(self.request.user))

    def perform_create(self, serializer):
        v, u = serializer.validated_data, self.request.user
        if not customers_for(u).filter(pk=v['customer'].pk).exists():
            raise PermissionDenied('This customer is not assigned to you.')
        today = date.today().replace(day=1)
        nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
        d = draft_invoice(v['customer'], today, nxt - timedelta(days=1))
        base = sum((l['amount'] for l in d['lines'] if not v.get('subscription') or l['subscription'].id == v['subscription'].id), 0)
        pct = v['value'] if v['kind'] == 'percentage' else (v['value'] / base * 100 if base else 0)
        s = SystemSettings.load()
        limit = s.admin_max_discount_pct if u.role == 'admin' else u.agent.max_discount_pct
        if pct > limit:
            raise ValidationError({'value': f'This discount is {pct:.1f}% of the bill — above your authorised limit of {limit}%.'})
        disc = serializer.save(approved_by=u)
        log(u, 'discount.create', v['customer'].user.name, f'{v["value"]} {v["kind"]} · {v["reason"]}', disc.id)

    @action(detail=True, methods=['post'])
    def revoke(self, request, pk=None):
        d = self.get_object()
        d.revoked = True
        d.expiry_date = min(d.expiry_date or date.max, date.today() - timedelta(days=1))
        d.save(update_fields=['revoked', 'expiry_date'])
        log(request.user, 'discount.revoke', d.customer.user.name)
        return Response(DiscountSerializer(d).data)
