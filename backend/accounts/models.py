from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser, UserManager
from django.core.validators import RegexValidator
from django.db import models

mobile_validator = RegexValidator(r'^[6-9]\d{9}$', 'Enter a valid 10-digit Indian mobile number.')


class Role(models.TextChoices):
    ADMIN = 'admin', 'Super Administrator'
    AGENT = 'agent', 'Distribution Agent'
    EXECUTIVE = 'executive', 'Delivery Executive'
    CUSTOMER = 'customer', 'Customer / Subscriber'


class Status(models.TextChoices):
    ACTIVE = 'active', 'Active'
    INACTIVE = 'inactive', 'Inactive'


class User(AbstractUser):
    """One login per (role, mobile). `username` is derived as `role:mobile`."""

    role = models.CharField(max_length=12, choices=Role.choices)
    mobile = models.CharField(max_length=10, validators=[mobile_validator])
    name = models.CharField(max_length=120)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    mpin_hash = models.CharField(max_length=128, blank=True)
    ext_id = models.CharField(max_length=40, blank=True, db_index=True, help_text='Stable id used by the frontend / fixtures')

    objects = UserManager()

    class Meta:
        constraints = [models.UniqueConstraint(fields=['role', 'mobile'], name='uniq_role_mobile')]

    def save(self, *args, **kwargs):
        if not self.username:
            self.username = f'{self.role}:{self.mobile}'
        super().save(*args, **kwargs)

    def set_mpin(self, mpin: str):
        self.mpin_hash = make_password(mpin)

    def check_mpin(self, mpin: str) -> bool:
        return bool(self.mpin_hash) and check_password(mpin, self.mpin_hash)

    def __str__(self):
        return f'{self.name} ({self.get_role_display()})'


class AgentProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='agent')
    code = models.CharField(max_length=12, unique=True)
    agency_name = models.CharField(max_length=120)
    email = models.EmailField(blank=True)
    areas = models.ManyToManyField('geo.Location', related_name='agents', blank=True)
    max_discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=10)
    can_manage_routes = models.BooleanField(default=True)
    joining_date = models.DateField()

    def __str__(self):
        return f'{self.code} · {self.agency_name}'


class ExecutiveProfile(models.Model):
    class Relation(models.TextChoices):
        FATHER = 'Father'
        MOTHER = 'Mother'
        SPOUSE = 'Spouse'
        BROTHER = 'Brother'
        SISTER = 'Sister'
        SON = 'Son'
        DAUGHTER = 'Daughter'
        GUARDIAN = 'Guardian'
        FRIEND = 'Friend'
        OTHER = 'Other'

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='executive')
    code = models.CharField(max_length=12, unique=True)
    agent = models.ForeignKey(AgentProfile, on_delete=models.PROTECT, related_name='executives')
    areas = models.ManyToManyField('geo.Location', related_name='executives', blank=True)
    joining_date = models.DateField()
    can_collect_cash = models.BooleanField(default=True)
    # Second number to reach the executive (or their family) when their own phone is off on the round.
    alt_mobile = models.CharField(max_length=10, blank=True, validators=[mobile_validator])
    alt_mobile_relation = models.CharField(max_length=12, choices=Relation.choices, blank=True)

    def __str__(self):
        return f'{self.code} · {self.user.name}'


class CustomerProfile(models.Model):
    class IdProof(models.TextChoices):
        AADHAAR = 'Aadhaar Card'
        VOTER = 'Voter ID'
        DL = 'Driving Licence'
        PAN = 'PAN Card'
        NONE = 'None'

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='customer')
    code = models.CharField(max_length=16, unique=True)
    alt_mobile = models.CharField(max_length=10, blank=True, validators=[mobile_validator])
    whatsapp = models.CharField(max_length=10, blank=True, validators=[mobile_validator])
    email = models.EmailField(blank=True)
    gender = models.CharField(max_length=8, blank=True)
    dob = models.DateField(null=True, blank=True)
    area = models.ForeignKey('geo.Location', on_delete=models.PROTECT, related_name='customers')
    house_name = models.CharField(max_length=160)
    landmark = models.CharField(max_length=160, blank=True)
    address = models.TextField()
    lat = models.FloatField()
    lng = models.FloatField()
    agent = models.ForeignKey(AgentProfile, on_delete=models.PROTECT, related_name='customers')
    route = models.ForeignKey('distribution.Route', null=True, blank=True, on_delete=models.SET_NULL, related_name='customers')
    id_proof = models.CharField(max_length=20, choices=IdProof.choices, default=IdProof.NONE)
    id_number = models.CharField(max_length=32, blank=True, help_text='Last 4 digits only')
    security_deposit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    handling_charge = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    registered_on = models.DateField()
    self_registered = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=['lat', 'lng'])]

    def __str__(self):
        return f'{self.code} · {self.user.name}'


class OtpChallenge(models.Model):
    """Hashed OTP with silent abuse protection (cooldown + hourly cap + progressive delay)."""

    role = models.CharField(max_length=12, choices=Role.choices)
    mobile = models.CharField(max_length=10)
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    failures = models.PositiveSmallIntegerField(default=0)
    verified_token = models.CharField(max_length=64, blank=True)
    verified_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['role', 'mobile', '-created_at'])]
