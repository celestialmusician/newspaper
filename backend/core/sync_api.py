"""Sync endpoints used by the PWA (frontend/src/services/remote.ts)."""
from django.conf import settings
from django.core.management import call_command
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from accounts.api import _tokens as tokens
from accounts.models import Role, User
from engagement.services import log

from .snapshot import COLLECTIONS, build, public_bootstrap


@api_view(['GET'])
def snapshot(request):
    """GET /api/sync/snapshot/[?only=customers,deliveries] — everything this user may see, in the frontend DB shape."""
    only = {x for x in request.query_params.get('only', '').split(',') if x in COLLECTIONS} or None
    return Response(build(request.user, only))


@api_view(['GET'])
@permission_classes([AllowAny])
def bootstrap(request):
    """GET /api/sync/bootstrap/ — public data for the sign-in and registration screens."""
    return Response(public_bootstrap(settings.OTP_DEMO_MODE))


@api_view(['POST'])
def reset_demo(request):
    """POST /api/sync/reset-demo/ — reload the Kerala demo dataset (demo deployments only). MPINs are kept."""
    if request.user.role != Role.ADMIN:
        raise PermissionDenied('Only the Super Administrator can reset demo data.')
    if not settings.OTP_DEMO_MODE:
        raise PermissionDenied('Demo reset is disabled on this server.')
    pins = dict(((r, m), h) for r, m, h in User.objects.exclude(mpin_hash='').values_list('role', 'mobile', 'mpin_hash'))
    call_command('seed_demo', reset=True, verbosity=0)
    for (role, mobile), h in pins.items():
        User.objects.filter(role=role, mobile=mobile).update(mpin_hash=h)
    # Users were recreated, so the caller's old token no longer matches anyone: issue fresh ones.
    admin = User.objects.get(role=Role.ADMIN, mobile=request.user.mobile)
    log(admin, 'settings.reset', 'Demo data', 'Dataset restored')
    return Response(tokens(admin))
