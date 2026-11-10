from django.db import models


class Notification(models.Model):
    """Recipient is a user, or a role broadcast (`role` set, `user` null)."""

    user = models.ForeignKey('accounts.User', null=True, blank=True, on_delete=models.CASCADE, related_name='notifications')
    role = models.CharField(max_length=12, blank=True)
    kind = models.CharField(max_length=20)
    title = models.CharField(max_length=160)
    body = models.TextField()
    link = models.CharField(max_length=200, blank=True)
    at = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ['-at']


class PushSubscription(models.Model):
    user = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='push_subscriptions')
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)


class Complaint(models.Model):
    class Status(models.TextChoices):
        OPEN = 'open'
        IN_PROGRESS = 'in_progress'
        RESOLVED = 'resolved'

    number = models.CharField(max_length=16, unique=True)
    customer = models.ForeignKey('accounts.CustomerProfile', on_delete=models.CASCADE, related_name='complaints')
    category = models.CharField(max_length=30)
    message = models.TextField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)


class ComplaintUpdate(models.Model):
    complaint = models.ForeignKey(Complaint, on_delete=models.CASCADE, related_name='updates')
    at = models.DateTimeField(auto_now_add=True)
    by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    note = models.TextField()
    status = models.CharField(max_length=12)


class ActivityLog(models.Model):
    at = models.DateTimeField(auto_now_add=True, db_index=True)
    actor = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=40)
    entity = models.CharField(max_length=160)
    entity_id = models.CharField(max_length=40, blank=True)
    detail = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['-at']


class SystemSettings(models.Model):
    """Singleton (pk=1)."""

    agency_name = models.CharField(max_length=120, default='Morning Talk News Agency')
    agency_address = models.TextField(blank=True)
    gstin = models.CharField(max_length=20, blank=True)
    support_phone = models.CharField(max_length=10, blank=True)
    invoice_prefix = models.CharField(max_length=8, default='MTN')
    receipt_prefix = models.CharField(max_length=8, default='RCP')
    billing_due_days = models.PositiveSmallIntegerField(default=10)
    admin_max_discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=50)
    default_agent_max_discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=10)
    agent_price_max_markup_pct = models.DecimalField(max_digits=5, decimal_places=2, default=10)
    low_stock_default = models.PositiveSmallIntegerField(default=3)
    overdue_after_days = models.PositiveSmallIntegerField(default=10)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
