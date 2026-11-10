"""Authentication: role + mobile → OTP (first time / reset) → 4-digit MPIN → JWT.

Abuse protection is silent: a short resend cooldown, an hourly cap (after which the same
code is re-sent rather than a new one minted) and a progressive delay on wrong attempts.
"""
import secrets
import time
from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework_simplejwt.tokens import RefreshToken

from core.snapshot import user_ref
from distribution.models import Route, RouteStop
from engagement.services import log, notify
from geo.models import Location

from .models import AgentProfile, CustomerProfile, OtpChallenge, Role, User, mobile_validator

WEAK_MPINS = {'1234', '4321', '0123', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999'}


def exception_handler(exc, context):
    """Turn ValueError raised by domain services into clean 400 responses."""
    if isinstance(exc, ValueError):
        return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return drf_exception_handler(exc, context)


class IdentitySerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=Role.choices)
    mobile = serializers.CharField(validators=[mobile_validator])


def _user(role, mobile) -> User:
    u = User.objects.filter(role=role, mobile=mobile).first()
    if not u:
        hint = 'Tap "Create Account" to register.' if role == Role.CUSTOMER else 'Please check the account type.'
        raise serializers.ValidationError({'detail': f'No account found for this number. {hint}'})
    if u.status != 'active':
        raise serializers.ValidationError({'detail': 'This account is inactive. Please contact the agency.'})
    return u


def _tokens(user: User):
    user.last_login = timezone.now()
    user.save(update_fields=['last_login'])
    r = RefreshToken.for_user(user)
    r['role'] = user.role
    return {'access': str(r.access_token), 'refresh': str(r), 'role': user.role, 'user_id': user_ref(user), 'name': user.name}


class OtpThrottle(AnonRateThrottle):
    scope = 'otp'


@api_view(['POST'])
@permission_classes([AllowAny])
def lookup(request):
    s = IdentitySerializer(data=request.data)
    s.is_valid(raise_exception=True)
    u = _user(**s.validated_data)
    return Response({'name': u.name, 'has_mpin': bool(u.mpin_hash)})


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([OtpThrottle])
def otp_request(request):
    s = IdentitySerializer(data=request.data)
    s.is_valid(raise_exception=True)
    role, mobile = s.validated_data['role'], s.validated_data['mobile']
    if request.data.get('registering'):
        if role != Role.CUSTOMER:
            return Response({'detail': 'Only customers can self-register.'}, status=400)
        if User.objects.filter(role=role, mobile=mobile).exists():
            return Response({'detail': 'A customer account already exists for this mobile number. Please sign in.'}, status=400)
    else:
        _user(role, mobile)
    last = OtpChallenge.objects.filter(role=role, mobile=mobile).order_by('-created_at').first()
    now = timezone.now()
    if last and (now - last.created_at).total_seconds() < settings.OTP_RESEND_COOLDOWN_SECONDS:
        return Response({'cooldown': settings.OTP_RESEND_COOLDOWN_SECONDS, 'reused': True})
    code = f'{secrets.randbelow(900000) + 100000}'
    OtpChallenge.objects.create(role=role, mobile=mobile, code_hash=make_password(code), expires_at=now + timedelta(seconds=settings.OTP_TTL_SECONDS))
    # Production: hand `code` to the SMS provider here. Demo mode returns it so the prototype is usable.
    body = {'cooldown': settings.OTP_RESEND_COOLDOWN_SECONDS, 'reused': False}
    if settings.OTP_DEMO_MODE:
        body['demo_otp'] = code
    return Response(body)


@api_view(['POST'])
@permission_classes([AllowAny])
def otp_verify(request):
    s = IdentitySerializer(data=request.data)
    s.is_valid(raise_exception=True)
    ch = OtpChallenge.objects.filter(**s.validated_data).order_by('-created_at').first()
    if not ch:
        return Response({'detail': 'Please request an OTP first.'}, status=400)
    if ch.failures > 4:
        time.sleep(min(4, 0.4 * (ch.failures - 4)))  # silent progressive delay
    if timezone.now() > ch.expires_at:
        return Response({'detail': 'This OTP has expired. Tap "Resend OTP".'}, status=400)
    if not check_password(str(request.data.get('otp', '')), ch.code_hash):
        ch.failures += 1
        ch.save(update_fields=['failures'])
        return Response({'detail': 'That OTP is not correct. Please try again.'}, status=400)
    ch.verified_token = secrets.token_urlsafe(24)
    ch.verified_until = timezone.now() + timedelta(minutes=10)
    ch.save(update_fields=['verified_token', 'verified_until'])
    return Response({'otp_token': ch.verified_token})


def _check_otp_token(role, mobile, token):
    ok = OtpChallenge.objects.filter(role=role, mobile=mobile, verified_token=token, verified_until__gte=timezone.now()).exists()
    if not token or not ok:
        raise serializers.ValidationError({'detail': 'Verification expired. Please verify your OTP again.'})
    OtpChallenge.objects.filter(role=role, mobile=mobile).delete()


@api_view(['POST'])
@permission_classes([AllowAny])
def mpin_set(request):
    s = IdentitySerializer(data=request.data)
    s.is_valid(raise_exception=True)
    mpin = str(request.data.get('mpin', ''))
    if not (len(mpin) == 4 and mpin.isdigit()):
        return Response({'detail': 'MPIN must be exactly 4 digits.'}, status=400)
    if mpin in WEAK_MPINS:
        return Response({'detail': 'Please choose a less predictable MPIN.'}, status=400)
    _check_otp_token(s.validated_data['role'], s.validated_data['mobile'], request.data.get('otp_token'))
    u = _user(**s.validated_data)
    u.set_mpin(mpin)
    u.save(update_fields=['mpin_hash'])
    return Response(_tokens(u))


@api_view(['POST'])
@permission_classes([AllowAny])
def mpin_login(request):
    s = IdentitySerializer(data=request.data)
    s.is_valid(raise_exception=True)
    u = _user(**s.validated_data)
    if not u.mpin_hash:
        return Response({'detail': 'MPIN not set yet. Please verify with OTP.', 'code': 'no_mpin'}, status=400)
    if not u.check_mpin(str(request.data.get('mpin', ''))):
        return Response({'detail': 'Incorrect MPIN. Try again or tap "Forgot MPIN".'}, status=400)
    return Response(_tokens(u))


class RegisterSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    mobile = serializers.CharField(validators=[mobile_validator])
    email = serializers.EmailField(required=False, allow_blank=True)
    area = serializers.PrimaryKeyRelatedField(queryset=Location.objects.filter(level='area'))
    house_name = serializers.CharField(max_length=160)
    landmark = serializers.CharField(required=False, allow_blank=True)
    address = serializers.CharField()
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    alt_mobile = serializers.CharField(required=False, allow_blank=True, validators=[mobile_validator])
    whatsapp = serializers.CharField(required=False, allow_blank=True, validators=[mobile_validator])
    gender = serializers.CharField(required=False, allow_blank=True, max_length=8)
    dob = serializers.DateField(required=False, allow_null=True)
    otp_token = serializers.CharField()
    mpin = serializers.RegexField(r'^\d{4}$')


@api_view(['POST'])
@permission_classes([AllowAny])
@transaction.atomic
def register(request):
    """Customer self-registration (OTP-verified). Agent/executive accounts are created by admin/agent."""
    s = RegisterSerializer(data=request.data)
    s.is_valid(raise_exception=True)
    v = s.validated_data
    if User.objects.filter(role=Role.CUSTOMER, mobile=v['mobile']).exists():
        return Response({'detail': 'An account already exists for this number. Please sign in.'}, status=400)
    _check_otp_token(Role.CUSTOMER, v['mobile'], v['otp_token'])
    agent = AgentProfile.objects.filter(areas=v['area'], user__status='active').first() or AgentProfile.objects.first()
    route = Route.objects.filter(areas=v['area'], status='active').first()
    u = User(role=Role.CUSTOMER, mobile=v['mobile'], name=v['name'])
    u.set_mpin(v['mpin'])
    u.save()
    c = CustomerProfile.objects.create(
        user=u, code=f'MT-C-{1001 + CustomerProfile.objects.count()}', email=v.get('email', ''), area=v['area'], house_name=v['house_name'],
        alt_mobile=v.get('alt_mobile', ''), whatsapp=v.get('whatsapp', ''), gender=v.get('gender', ''), dob=v.get('dob'),
        landmark=v.get('landmark', ''), address=v['address'], lat=v['lat'], lng=v['lng'], agent=agent, route=route, registered_on=date.today(), self_registered=True,
    )
    if route:
        RouteStop.objects.create(route=route, customer=c, sequence=route.stops.count() + 1)
    notify(['role:admin', agent.user], 'registration', 'New customer registration', f'{u.name} registered from {v["area"].name}.', f'/customers/{c.id}')
    log(u, 'customer.register', u.name, c.code, c.id)
    return Response(_tokens(u), status=201)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me(request):
    u = request.user
    return Response({'id': user_ref(u), 'role': u.role, 'name': u.name, 'mobile': u.mobile, 'status': u.status})
