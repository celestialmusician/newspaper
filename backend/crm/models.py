from django.db import models

from catalog.models import Frequency


class Subscription(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active'
        PAUSED = 'paused'
        CANCELLED = 'cancelled'
        EXPIRED = 'expired'

    ext_id = models.CharField(max_length=40, blank=True, db_index=True)
    customer = models.ForeignKey('accounts.CustomerProfile', on_delete=models.CASCADE, related_name='subscriptions')
    product = models.ForeignKey('catalog.Product', on_delete=models.PROTECT, related_name='subscriptions')
    start_date = models.DateField()
    end_date = models.DateField(null=True, blank=True)
    frequency = models.CharField(max_length=16, choices=Frequency.choices)
    weekdays = models.JSONField(default=list, blank=True, help_text='0=Sun … 6=Sat')
    month_days = models.JSONField(default=list, blank=True, help_text='1 … 31')
    custom_dates = models.JSONField(default=list, blank=True, help_text='ISO dates')
    quantity = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    cancelled_on = models.DateField(null=True, blank=True)
    notes = models.CharField(max_length=300, blank=True)
    created_on = models.DateField(auto_now_add=True)

    def __str__(self):
        return f'{self.customer} · {self.product}'


class SubscriptionPause(models.Model):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name='pauses')
    date_from = models.DateField()
    date_to = models.DateField(null=True, blank=True, help_text='Null = until resumed')
    reason = models.CharField(max_length=200, blank=True)


class SubscriptionEvent(models.Model):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name='events')
    at = models.DateTimeField(auto_now_add=True)
    by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=20)
    detail = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['-at']


class Discount(models.Model):
    class Kind(models.TextChoices):
        PERCENTAGE = 'percentage'
        FIXED = 'fixed'

    class Category(models.TextChoices):
        CUSTOMER = 'Customer-Specific'
        SUBSCRIPTION = 'Subscription'
        PROMOTIONAL = 'Promotional'
        LONG_TERM = 'Long-Term Subscription'

    customer = models.ForeignKey('accounts.CustomerProfile', on_delete=models.CASCADE, related_name='discounts')
    subscription = models.ForeignKey(Subscription, null=True, blank=True, on_delete=models.CASCADE, related_name='discounts')
    kind = models.CharField(max_length=12, choices=Kind.choices)
    category = models.CharField(max_length=30, choices=Category.choices)
    value = models.DecimalField(max_digits=8, decimal_places=2)
    start_date = models.DateField()
    expiry_date = models.DateField(null=True, blank=True)
    reason = models.CharField(max_length=200)
    approved_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    revoked = models.BooleanField(default=False)
