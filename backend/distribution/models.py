from django.db import models


class Holiday(models.Model):
    class Type(models.TextChoices):
        PUBLIC = 'Public Holiday'
        NEWSPAPER = 'Newspaper Holiday'
        REGIONAL = 'Regional Holiday'
        STRIKE = 'Strike / Hartal'
        SPECIAL = 'Special Holiday'

    name = models.CharField(max_length=160)
    date = models.DateField(db_index=True)
    type = models.CharField(max_length=20, choices=Type.choices)
    locations = models.ManyToManyField('geo.Location', blank=True, help_text='Empty = everywhere; a node covers its descendants')
    products = models.ManyToManyField('catalog.Product', blank=True, help_text='Empty = all products')
    delivery_applicable = models.BooleanField(default=False, help_text='True = informational, delivery continues')
    description = models.TextField(blank=True)


class Route(models.Model):
    ext_id = models.CharField(max_length=40, blank=True, db_index=True)
    code = models.CharField(max_length=12, unique=True)
    name = models.CharField(max_length=160)
    areas = models.ManyToManyField('geo.Location', related_name='routes')
    agent = models.ForeignKey('accounts.AgentProfile', on_delete=models.PROTECT, related_name='routes')
    executive = models.ForeignKey('accounts.ExecutiveProfile', null=True, blank=True, on_delete=models.SET_NULL, related_name='routes')
    instructions = models.TextField(blank=True)
    status = models.CharField(max_length=10, default='active')
    created_on = models.DateField(auto_now_add=True)

    def __str__(self):
        return f'{self.code} · {self.name}'


class RouteStop(models.Model):
    """Ordered delivery sequence. One route per customer."""

    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name='stops')
    customer = models.OneToOneField('accounts.CustomerProfile', on_delete=models.CASCADE, related_name='stop')
    sequence = models.PositiveIntegerField()
    instructions = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['route', 'sequence']


class Handover(models.Model):
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name='handovers')
    from_executive = models.ForeignKey('accounts.ExecutiveProfile', null=True, blank=True, on_delete=models.SET_NULL, related_name='+')
    to_executive = models.ForeignKey('accounts.ExecutiveProfile', on_delete=models.PROTECT, related_name='+')
    at = models.DateTimeField(auto_now_add=True)
    by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ['-at']


class DeliveryRecord(models.Model):
    """Only real outcomes are stored; the schedule is derived. Unique per subscription + date → no duplicates."""

    class Status(models.TextChoices):
        DELIVERED = 'delivered'
        MISSED = 'missed'

    subscription = models.ForeignKey('crm.Subscription', on_delete=models.CASCADE, related_name='deliveries')
    customer = models.ForeignKey('accounts.CustomerProfile', on_delete=models.CASCADE, related_name='deliveries')
    product = models.ForeignKey('catalog.Product', on_delete=models.PROTECT)
    date = models.DateField(db_index=True)
    status = models.CharField(max_length=10, choices=Status.choices)
    quantity = models.PositiveSmallIntegerField(default=1)
    executive = models.ForeignKey('accounts.ExecutiveProfile', null=True, blank=True, on_delete=models.SET_NULL, related_name='deliveries')
    actual_at = models.DateTimeField(null=True, blank=True)
    updated_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    updated_at = models.DateTimeField(auto_now=True)
    reason = models.CharField(max_length=80, blank=True)
    remarks = models.CharField(max_length=300, blank=True)
    synced_from_offline = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['subscription', 'date'], name='uniq_delivery_per_day')]


class StockEntry(models.Model):
    """Daily ledger. remaining = opening + received − distributed + returned − damaged."""

    date = models.DateField()
    product = models.ForeignKey('catalog.Product', on_delete=models.PROTECT)
    agent = models.ForeignKey('accounts.AgentProfile', on_delete=models.CASCADE, related_name='stock')
    opening = models.PositiveIntegerField(default=0)
    received = models.PositiveIntegerField(default=0)
    distributed = models.PositiveIntegerField(default=0)
    returned = models.PositiveIntegerField(default=0)
    damaged = models.PositiveIntegerField(default=0)
    reconciled = models.BooleanField(default=False)
    updated_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['date', 'product', 'agent'], name='uniq_stock_row')]

    @property
    def remaining(self):
        return self.opening + self.received - self.distributed + self.returned - self.damaged
