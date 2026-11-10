from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError

from core.access import Allows
from engagement.services import log

from .models import Location


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ['id', 'ext_id', 'level', 'name', 'parent', 'pincode', 'lat', 'lng']

    def validate(self, attrs):
        if attrs.get('level', getattr(self.instance, 'level', None)) == 'area' and not str(attrs.get('pincode', getattr(self.instance, 'pincode', ''))).isdigit():
            raise ValidationError({'pincode': 'Areas need a valid 6-digit pincode.'})
        return attrs


class LocationViewSet(viewsets.ModelViewSet):
    """GET /api/locations/?parent=<id>&level=area&pincode=695011 — drives every dependent dropdown."""

    serializer_class = LocationSerializer
    permission_classes = [Allows('location.write')]
    filterset_fields = ['parent', 'level', 'pincode']
    search_fields = ['name', 'pincode']
    pagination_class = None

    def get_queryset(self):
        return Location.objects.all()

    def perform_create(self, serializer):
        user = self.request.user
        if user.role == 'agent' and serializer.validated_data['level'] not in ('locality', 'area'):
            raise PermissionDenied('Agents can add localities and areas only.')
        loc = serializer.save(created_by=user)
        if user.role == 'agent' and loc.level == 'area':
            user.agent.areas.add(loc)
        log(user, 'location.create', loc.name, loc.level, loc.id)

    def perform_destroy(self, instance):
        ids = instance.descendant_ids()
        from accounts.models import CustomerProfile

        if CustomerProfile.objects.filter(area_id__in=ids).exists() or instance.routes.exists():
            raise ValidationError({'detail': 'This location is used by customers or routes and cannot be deleted.'})
        log(self.request.user, 'location.delete', instance.name)
        instance.delete()
