"""Agents, delivery executives and customers — scoped by role."""
from datetime import date

from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.access import Allows, can, customers_for
from core.billing import outstanding
from distribution.models import RouteStop
from engagement.services import log, notify

from .models import AgentProfile, CustomerProfile, ExecutiveProfile, Role, User, mobile_validator


def _save_user(role, data, instance=None):
    u = instance or User(role=role)
    for k, v in data.items():
        setattr(u, k, v)
    if User.objects.filter(role=role, mobile=u.mobile).exclude(pk=u.pk).exists():
        raise ValidationError({'mobile': 'This mobile number is already registered for another account of this type.'})
    u.username = f'{role}:{u.mobile}'
    u.save()
    return u


class AgentSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='user.name')
    mobile = serializers.CharField(source='user.mobile', validators=[mobile_validator])
    status = serializers.CharField(source='user.status', required=False)

    class Meta:
        model = AgentProfile
        fields = ['id', 'code', 'name', 'mobile', 'status', 'agency_name', 'email', 'areas', 'max_discount_pct', 'can_manage_routes', 'joining_date']
        read_only_fields = ['code']

    @transaction.atomic
    def create(self, v):
        u = _save_user(Role.AGENT, v.pop('user'))
        areas = v.pop('areas', [])
        a = AgentProfile.objects.create(user=u, code=f'AG-{AgentProfile.objects.count() + 1:02d}', **v)
        a.areas.set(areas)
        return a

    @transaction.atomic
    def update(self, inst, v):
        if 'user' in v:
            _save_user(Role.AGENT, v.pop('user'), inst.user)
        return super().update(inst, v)


class AgentViewSet(viewsets.ModelViewSet):
    serializer_class = AgentSerializer
    permission_classes = [Allows('agent.write')]
    search_fields = ['user__name', 'agency_name', 'user__mobile', 'code']

    def get_queryset(self):
        u = self.request.user
        qs = AgentProfile.objects.select_related('user').prefetch_related('areas')
        return qs if u.role == Role.ADMIN else qs.filter(user=u)

    def perform_destroy(self, instance):
        raise ValidationError({'detail': 'Agents with history cannot be deleted — deactivate the account instead.'})


class ExecutiveSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='user.name')
    mobile = serializers.CharField(source='user.mobile', validators=[mobile_validator])
    status = serializers.CharField(source='user.status', required=False)
    routes = serializers.SerializerMethodField()

    class Meta:
        model = ExecutiveProfile
        fields = ['id', 'code', 'name', 'mobile', 'alt_mobile', 'alt_mobile_relation', 'status', 'agent', 'areas', 'joining_date', 'can_collect_cash', 'routes']
        read_only_fields = ['code']

    def validate(self, attrs):
        inst = self.instance
        alt = attrs.get('alt_mobile', inst.alt_mobile if inst else '')
        rel = attrs.get('alt_mobile_relation', inst.alt_mobile_relation if inst else '')
        own = attrs.get('user', {}).get('mobile', inst.user.mobile if inst else '')
        if not alt or not rel:
            raise ValidationError({'alt_mobile': 'Add an alternate mobile number and its relation to the executive.'})
        if alt == own:
            raise ValidationError({'alt_mobile': "The alternate number must differ from the executive's own mobile."})
        return attrs

    def get_routes(self, obj):
        return list(obj.routes.values('id', 'code', 'name'))

    @transaction.atomic
    def create(self, v):
        u = _save_user(Role.EXECUTIVE, v.pop('user'))
        areas = v.pop('areas', [])
        e = ExecutiveProfile.objects.create(user=u, code=f'DE-{ExecutiveProfile.objects.count() + 1:02d}', **v)
        e.areas.set(areas)
        return e

    @transaction.atomic
    def update(self, inst, v):
        if v.get('user', {}).get('status') == 'inactive' and inst.routes.exists():
            raise ValidationError({'detail': "Hand over this executive's routes before deactivating the account."})
        if 'user' in v:
            _save_user(Role.EXECUTIVE, v.pop('user'), inst.user)
        return super().update(inst, v)


class ExecutiveViewSet(viewsets.ModelViewSet):
    serializer_class = ExecutiveSerializer
    permission_classes = [Allows('executive.write')]
    filterset_fields = ['agent']
    search_fields = ['user__name', 'user__mobile', 'code']

    def get_queryset(self):
        u = self.request.user
        qs = ExecutiveProfile.objects.select_related('user', 'agent').prefetch_related('areas', 'routes')
        if u.role == Role.ADMIN:
            return qs
        if u.role == Role.AGENT:
            return qs.filter(agent=u.agent)
        return qs.filter(user=u)

    def perform_create(self, serializer):
        if self.request.user.role == Role.AGENT and serializer.validated_data['agent'] != self.request.user.agent:
            raise PermissionDenied('Agents can only add executives to their own agency.')
        e = serializer.save()
        log(self.request.user, 'executive.create', e.user.name, e.code, e.id)


class CustomerSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source='user.name')
    mobile = serializers.CharField(source='user.mobile', validators=[mobile_validator])
    status = serializers.CharField(source='user.status', required=False)
    outstanding = serializers.SerializerMethodField()
    executive = serializers.SerializerMethodField()

    class Meta:
        model = CustomerProfile
        exclude = ['user']
        read_only_fields = ['code', 'registered_on', 'self_registered']

    def get_outstanding(self, obj):
        return outstanding(obj)

    def get_executive(self, obj):
        ex = obj.route.executive if obj.route_id and obj.route.executive_id else None
        return ex and {'id': ex.id, 'name': ex.user.name, 'mobile': ex.user.mobile}

    @transaction.atomic
    def create(self, v):
        u = _save_user(Role.CUSTOMER, v.pop('user'))
        c = CustomerProfile.objects.create(user=u, code=f'MT-C-{1001 + CustomerProfile.objects.count()}', registered_on=date.today(), **v)
        if c.route_id:
            RouteStop.objects.create(route=c.route, customer=c, sequence=c.route.stops.count() + 1)
        return c

    @transaction.atomic
    def update(self, inst, v):
        if 'user' in v:
            _save_user(Role.CUSTOMER, v.pop('user'), inst.user)
        new_route = v.get('route', inst.route)
        if 'route' in v and new_route != inst.route:
            RouteStop.objects.filter(customer=inst).delete()
            if new_route:
                RouteStop.objects.create(route=new_route, customer=inst, sequence=new_route.stops.count() + 1)
        return super().update(inst, v)


class CustomerViewSet(viewsets.ModelViewSet):
    serializer_class = CustomerSerializer
    filterset_fields = ['agent', 'route', 'area']
    search_fields = ['user__name', 'user__mobile', 'code', 'house_name']

    def get_queryset(self):
        return customers_for(self.request.user)

    def _check_write(self, customer=None):
        u = self.request.user
        if customer and u.role == Role.CUSTOMER and customer.user_id == u.id:
            if any(k in self.request.data for k in ('agent', 'route', 'status')):
                raise PermissionDenied('Only the agency can change assignment or status.')
            return
        if not can(u, 'customer.write'):
            raise PermissionDenied()

    def perform_create(self, serializer):
        self._check_write()
        u = self.request.user
        agent = u.agent if u.role == Role.AGENT else serializer.validated_data.get('agent')
        if not agent:
            raise ValidationError({'agent': 'Select the assigned agent.'})
        c = serializer.save(agent=agent)
        notify(['role:admin', agent.user], 'registration', 'New customer registration', f'{c.user.name} ({c.code}) registered.', f'/customers/{c.id}')
        log(u, 'customer.create', c.user.name, c.code, c.id)

    def perform_update(self, serializer):
        self._check_write(serializer.instance)
        c = serializer.save()
        log(self.request.user, 'customer.update', c.user.name, '', c.id)

    def perform_destroy(self, instance):
        raise ValidationError({'detail': 'Customers are never deleted (billing history). Deactivate instead.'})
