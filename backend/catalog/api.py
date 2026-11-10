import base64
import binascii
from datetime import date

from django.core.files.base import ContentFile

from django.db import transaction
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from core.access import Allows
from core.pricing import resolve_price, validate_agent_override
from engagement.models import SystemSettings
from engagement.services import log, notify

from .models import PriceVersion, Product


class ProductSerializer(serializers.ModelSerializer):
    current_price = serializers.SerializerMethodField()
    # Initial three-level price on create
    purchase_price = serializers.DecimalField(max_digits=8, decimal_places=2, write_only=True, required=False)
    agent_price = serializers.DecimalField(max_digits=8, decimal_places=2, write_only=True, required=False)
    customer_price = serializers.DecimalField(max_digits=8, decimal_places=2, write_only=True, required=False)
    # Cover image as a data URL from the PWA (empty string clears it).
    image_data = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Product
        fields = '__all__'

    def _image(self, v):
        data = v.pop('image_data', None)
        if data is None:
            return None
        if not data:
            return ''
        try:
            header, b64 = data.split(',', 1)
            ext = header.split('/')[1].split(';')[0]
            raw = base64.b64decode(b64)
        except (ValueError, IndexError, binascii.Error):
            raise ValidationError({'image': 'Upload a PNG, JPEG or WebP image.'})
        if ext not in ('png', 'jpeg', 'jpg', 'webp') or len(raw) > 2 * 1024 * 1024:
            raise ValidationError({'image': 'Upload a PNG, JPEG or WebP image up to 2 MB.'})
        return ContentFile(raw, name=f'product.{ext}')

    def create(self, v):
        img = self._image(v)
        if img:
            v['image'] = img
        return super().create(v)

    def update(self, inst, v):
        img = self._image(v)
        if img is not None:
            v['image'] = img or None
        return super().update(inst, v)

    def get_current_price(self, obj):
        user = self.context['request'].user
        p = resolve_price(obj.id, date.today(), user.agent.id if user.role == 'agent' else None)
        if not p:
            return None
        data = {'agent_price': p.agent_price, 'customer_price': p.customer_price, 'agent_margin': p.agent_margin, 'source': p.source}
        if user.role == 'admin':
            data.update(purchase_price=p.purchase_price, agency_margin=p.agency_margin)
        return data


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [Allows('product.write')]
    filterset_fields = ['category', 'status', 'language']
    search_fields = ['name', 'code', 'publisher']

    def get_queryset(self):
        return Product.objects.all().order_by('name')

    @transaction.atomic
    def perform_create(self, serializer):
        prices = {k: serializer.validated_data.pop(k, None) for k in ('purchase_price', 'agent_price', 'customer_price')}
        if not all(prices.values()):
            raise ValidationError({'detail': 'Purchase, agent and customer prices are required.'})
        p = serializer.save()
        v = PriceVersion(product=p, effective_from=date.today(), created_by=self.request.user, note='Initial price', **prices)
        v.full_clean()
        v.save()
        log(self.request.user, 'product.create', p.name, f'{prices}', p.id)

    def destroy(self, request, *args, **kwargs):
        """Deletes unused products; archives anything linked to invoices / subscriptions / deliveries."""
        p = self.get_object()
        if p.subscriptions.exists() or p.invoiceline_set.exists() or p.deliveryrecord_set.exists():
            p.status = Product.Status.ARCHIVED
            p.save(update_fields=['status'])
            p.subscriptions.filter(cancelled_on__isnull=True).update(cancelled_on=date.today(), status='cancelled')
            log(request.user, 'product.archive', p.name, 'Linked to history — archived')
            return Response({'result': 'archived'})
        log(request.user, 'product.delete', p.name)
        p.delete()
        return Response({'result': 'deleted'})


class PriceVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PriceVersion
        fields = '__all__'
        read_only_fields = ['created_by', 'created_at']

    def validate(self, attrs):
        v = PriceVersion(**attrs)
        v.clean()
        if attrs['effective_from'] < date.today():
            raise ValidationError({'effective_from': 'Effective date cannot be in the past — past invoices keep their original prices.'})
        if attrs.get('agent'):
            base = resolve_price(attrs['product'].id, attrs['effective_from'])
            if not base:
                raise ValidationError({'detail': 'Set a base price first.'})
            err = validate_agent_override(base, attrs['customer_price'], SystemSettings.load().agent_price_max_markup_pct)
            if err:
                raise ValidationError({'customer_price': err})
            if attrs['purchase_price'] != base.purchase_price:
                raise ValidationError({'purchase_price': 'Agency purchase price is set at base level.'})
        return attrs


class PriceVersionViewSet(viewsets.ModelViewSet):
    serializer_class = PriceVersionSerializer
    permission_classes = [Allows('price.write')]
    filterset_fields = ['product', 'agent']
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        qs = PriceVersion.objects.select_related('product')
        u = self.request.user
        if u.role == 'agent':
            qs = qs.filter(agent__isnull=True) | qs.filter(agent=u.agent)
        return qs

    def perform_create(self, serializer):
        v = serializer.save(created_by=self.request.user)
        from accounts.models import User

        recipients = [v.agent.user] if v.agent else list(User.objects.filter(role='agent'))
        notify(recipients, 'price', 'Product price change', f'{v.product.name}: customer price ₹{v.customer_price} from {v.effective_from}.', '/pricing')
        log(self.request.user, 'price.create', v.product.name, f'{v.purchase_price}/{v.agent_price}/{v.customer_price} from {v.effective_from}')

    def perform_destroy(self, instance):
        if instance.effective_from <= date.today():
            raise ValidationError({'detail': 'Prices already in effect are part of billing history and cannot be deleted.'})
        instance.delete()

    @action(detail=False)
    def resolve(self, request):
        """GET /api/prices/resolve/?product=<id>&date=YYYY-MM-DD&agent=<id>"""
        p = resolve_price(int(request.query_params['product']), date.fromisoformat(request.query_params.get('date', date.today().isoformat())), request.query_params.get('agent'))
        return Response(p and {**p.__dict__, 'agency_margin': p.agency_margin, 'agent_margin': p.agent_margin})
