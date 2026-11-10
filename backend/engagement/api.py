from datetime import date

from django.db.models import Q, Sum
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from accounts.models import AgentProfile, CustomerProfile, ExecutiveProfile, Role
from billing.models import Invoice, Payment
from catalog.models import Product
from core.access import Allows, can, customers_for
from core.schedule import occurrences
from crm.models import Subscription

from .models import ActivityLog, Complaint, ComplaintUpdate, Notification, PushSubscription, SystemSettings
from .services import log, notify


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'kind', 'title', 'body', 'link', 'at', 'read']


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer

    def get_queryset(self):
        u = self.request.user
        return Notification.objects.filter(Q(user=u) | Q(role=u.role, user__isnull=True))

    @action(detail=False, methods=['post'])
    def mark_read(self, request):
        self.get_queryset().filter(id__in=request.data.get('ids', [])).update(read=True)
        return Response({'ok': True})

    @action(detail=False, methods=['post'])
    def push_subscribe(self, request):
        """Store a browser PushSubscription (endpoint + keys) for Web Push delivery."""
        sub = request.data
        PushSubscription.objects.update_or_create(endpoint=sub['endpoint'], defaults={'user': request.user, 'p256dh': sub['keys']['p256dh'], 'auth': sub['keys']['auth']})
        return Response({'ok': True}, status=201)


class ComplaintSerializer(serializers.ModelSerializer):
    updates = serializers.SerializerMethodField()

    class Meta:
        model = Complaint
        fields = '__all__'
        read_only_fields = ['number', 'status', 'created_at', 'customer']

    def get_updates(self, obj):
        return list(obj.updates.values('at', 'note', 'status', 'by__name'))


class ComplaintViewSet(viewsets.ModelViewSet):
    serializer_class = ComplaintSerializer
    http_method_names = ['get', 'post', 'head', 'options']
    filterset_fields = ['status', 'category', 'customer']

    def get_queryset(self):
        return Complaint.objects.filter(customer__in=customers_for(self.request.user)).order_by('-created_at')

    def perform_create(self, serializer):
        if not can(self.request.user, 'complaint.create'):
            raise PermissionDenied()
        c = serializer.save(customer=self.request.user.customer, number=f'CMP-{Complaint.objects.count() + 1:04d}')
        notify(['role:admin', c.customer.agent.user], 'complaint', f'New complaint {c.number}', f'{c.customer.user.name}: {c.category}.', '/complaints')

    @action(detail=True, methods=['post'])
    def respond(self, request, pk=None):
        if not can(request.user, 'complaint.respond'):
            raise PermissionDenied()
        c = self.get_object()
        c.status = request.data.get('status', 'in_progress')
        c.save(update_fields=['status'])
        ComplaintUpdate.objects.create(complaint=c, by=request.user, note=request.data.get('note', ''), status=c.status)
        notify(c.customer.user, 'complaint', f'Complaint {c.number} {c.status.replace("_", " ")}', request.data.get('note', ''), '/complaints')
        return Response(ComplaintSerializer(c).data)


class ActivitySerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source='actor.name', default='System')
    actor_role = serializers.CharField(source='actor.role', default='')

    class Meta:
        model = ActivityLog
        fields = '__all__'


class ActivityViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = ActivitySerializer
    filterset_fields = ['action', 'actor__role']
    search_fields = ['entity', 'detail', 'actor__name']

    def get_queryset(self):
        if self.request.user.role != Role.ADMIN:
            raise PermissionDenied('Only the Super Administrator can view all activity logs.')
        return ActivityLog.objects.select_related('actor')


class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemSettings
        exclude = ['id']


class SettingsViewSet(viewsets.ViewSet):
    permission_classes = [Allows('settings.write')]

    def list(self, request):
        return Response(SettingsSerializer(SystemSettings.load()).data)

    @action(detail=False, methods=['patch'])
    def update_settings(self, request):
        s = SettingsSerializer(SystemSettings.load(), data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        s.save()
        log(request.user, 'settings.update', 'System settings', ', '.join(request.data))
        return Response(s.data)


@api_view(['GET'])
def dashboard(request):
    """Role-scoped headline numbers for the dashboards."""
    u, t = request.user, date.today()
    customers = customers_for(u)
    subs = Subscription.objects.filter(customer__in=customers)
    occ = [o for o in occurrences(subs, t, t) if o.status not in ('paused', 'holiday')]
    inv = Invoice.objects.filter(customer__in=customers)
    agg = inv.aggregate(b=Sum('current_bill'), p=Sum('paid'))
    data = {
        'customers': customers.count(),
        'active_subscriptions': sum(1 for s in subs if s.status == 'active'),
        'today_deliveries': len(occ),
        'today_delivered': sum(1 for o in occ if o.status == 'delivered'),
        'today_missed': sum(1 for o in occ if o.status == 'missed'),
        'today_pending': sum(1 for o in occ if o.status == 'pending'),
        'outstanding': (agg['b'] or 0) - (agg['p'] or 0),
        'collected_today': Payment.objects.filter(customer__in=customers, date=t).aggregate(s=Sum('amount'))['s'] or 0,
    }
    if u.role == Role.ADMIN:
        data.update(agents=AgentProfile.objects.count(), executives=ExecutiveProfile.objects.count(), products=Product.objects.filter(status='active').count(), total_customers=CustomerProfile.objects.count())
    return Response(data)
