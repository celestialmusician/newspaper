from django.core.exceptions import ValidationError
from django.db import models


class Frequency(models.TextChoices):
    DAILY = 'daily', 'Daily'
    WEEKLY = 'weekly', 'Weekly (1 day/week)'
    TWICE_WEEKLY = 'twice_weekly', 'Twice Weekly (2 days/week)'
    EVERY_14_DAYS = 'every_14_days', 'Every 14 Days'
    FORTNIGHTLY = 'fortnightly', 'Fortnightly (1st & 16th)'
    MONTHLY = 'monthly', 'Monthly (1 date/month)'
    TWICE_MONTHLY = 'twice_monthly', 'Twice Monthly (2 dates/month)'
    CUSTOM = 'custom', 'Custom Schedule'


class Product(models.Model):
    class Category(models.TextChoices):
        MALAYALAM = 'Malayalam Newspapers'
        ENGLISH = 'English Newspapers'
        REGIONAL = 'Regional Newspapers'
        WEEKLY = 'Weekly Magazines'
        FORTNIGHTLY = 'Fortnightly Magazines'
        MONTHLY = 'Monthly Magazines'
        CHILDREN = "Children's Magazines"
        EDUCATIONAL = 'Educational Publications'
        COMICS = 'Comics and Story Books'
        OTHER = 'Other Printed Publications'

    class Status(models.TextChoices):
        ACTIVE = 'active'
        INACTIVE = 'inactive'
        ARCHIVED = 'archived'

    ext_id = models.CharField(max_length=40, blank=True, db_index=True)
    code = models.CharField(max_length=10, unique=True)
    name = models.CharField(max_length=120)
    category = models.CharField(max_length=40, choices=Category.choices)
    publisher = models.CharField(max_length=160)
    language = models.CharField(max_length=30)
    product_type = models.CharField(max_length=20, default='Newspaper')
    description = models.TextField(blank=True)
    image = models.ImageField(upload_to='products/', blank=True)
    availability = models.CharField(max_length=20, default='Available')
    default_frequency = models.CharField(max_length=16, choices=Frequency.choices, default=Frequency.DAILY)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    color = models.CharField(max_length=9, default='#14213d')
    low_stock_threshold = models.PositiveIntegerField(default=3)
    created_on = models.DateField(auto_now_add=True)

    def __str__(self):
        return self.name


class PriceVersion(models.Model):
    """Immutable, effective-dated price. agent=None is the base price.

    Agency margin = agent_price − purchase_price; agent margin = customer_price − agent_price.
    """

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name='prices')
    agent = models.ForeignKey('accounts.AgentProfile', null=True, blank=True, on_delete=models.CASCADE, related_name='prices')
    purchase_price = models.DecimalField(max_digits=8, decimal_places=2)
    agent_price = models.DecimalField(max_digits=8, decimal_places=2)
    customer_price = models.DecimalField(max_digits=8, decimal_places=2)
    effective_from = models.DateField()
    note = models.CharField(max_length=200, blank=True)
    created_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-effective_from', '-created_at']
        indexes = [models.Index(fields=['product', 'agent', '-effective_from'])]

    def clean(self):
        if not (self.purchase_price > 0 and self.agent_price > 0 and self.customer_price > 0):
            raise ValidationError('All three prices must be greater than zero.')
        if self.agent_price < self.purchase_price:
            raise ValidationError('Agent price cannot be lower than the agency purchase price.')
        if self.customer_price < self.agent_price:
            raise ValidationError('Customer price cannot be lower than the agent price.')
