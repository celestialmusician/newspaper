from decimal import Decimal

from django.db import models


class Invoice(models.Model):
    class Status(models.TextChoices):
        UNPAID = 'unpaid'
        PARTIAL = 'partial'
        PAID = 'paid'

    number = models.CharField(max_length=30, unique=True)
    customer = models.ForeignKey('accounts.CustomerProfile', on_delete=models.PROTECT, related_name='invoices')
    agent = models.ForeignKey('accounts.AgentProfile', on_delete=models.PROTECT, related_name='invoices')
    period_start = models.DateField()
    period_end = models.DateField()
    issued_on = models.DateField()
    due_date = models.DateField()
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    handling_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    current_bill = models.DecimalField(max_digits=10, decimal_places=2)
    previous_balance = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.UNPAID)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['customer', 'period_start'], name='uniq_invoice_per_period')]
        ordering = ['-period_start', 'number']

    @property
    def remaining(self) -> Decimal:
        return max(Decimal('0'), self.current_bill - self.paid)

    def refresh_status(self):
        if self.paid <= 0:
            self.status = self.Status.PAID if self.current_bill <= 0 else self.Status.UNPAID
        else:
            self.status = self.Status.PAID if self.paid >= self.current_bill else self.Status.PARTIAL


class InvoiceLine(models.Model):
    """Prices are snapshots and never recalculated after issue."""

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='lines')
    subscription = models.ForeignKey('crm.Subscription', on_delete=models.PROTECT)
    product = models.ForeignKey('catalog.Product', on_delete=models.PROTECT)
    product_name = models.CharField(max_length=120)
    deliveries = models.PositiveIntegerField()
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=8, decimal_places=2)
    agent_price = models.DecimalField(max_digits=8, decimal_places=2)
    purchase_price = models.DecimalField(max_digits=8, decimal_places=2)
    amount = models.DecimalField(max_digits=10, decimal_places=2)


class InvoiceAdjustment(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='adjustments')
    label = models.CharField(max_length=200)
    amount = models.DecimalField(max_digits=10, decimal_places=2, help_text='Negative = credit')
    approved_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
    at = models.DateTimeField(auto_now_add=True)


class Payment(models.Model):
    class Method(models.TextChoices):
        UPI = 'UPI'
        DEBIT = 'Debit Card'
        CREDIT = 'Credit Card'
        CASH = 'Cash'
        AGENT = 'Agent Collection'
        EXECUTIVE = 'Delivery Executive Collection'

    ONLINE = {Method.UPI, Method.DEBIT, Method.CREDIT}

    receipt_no = models.CharField(max_length=20, unique=True)
    customer = models.ForeignKey('accounts.CustomerProfile', on_delete=models.PROTECT, related_name='payments')
    agent = models.ForeignKey('accounts.AgentProfile', on_delete=models.PROTECT, related_name='payments')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    method = models.CharField(max_length=32, choices=Method.choices)
    date = models.DateField()
    at = models.DateTimeField(auto_now_add=True)
    collected_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL, related_name='+')
    gateway_ref = models.CharField(max_length=60, blank=True)
    simulated = models.BooleanField(default=False, help_text='Demo gateway — never a real bank transaction')
    verified = models.BooleanField(default=True)
    idempotency_key = models.CharField(max_length=64, unique=True)
    note = models.CharField(max_length=200, blank=True)


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(Payment, on_delete=models.CASCADE, related_name='allocations')
    invoice = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name='allocations')
    amount = models.DecimalField(max_digits=10, decimal_places=2)


class Remittance(models.Model):
    agent = models.ForeignKey('accounts.AgentProfile', on_delete=models.PROTECT, related_name='remittances')
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    date = models.DateField()
    reference = models.CharField(max_length=60)
    recorded_by = models.ForeignKey('accounts.User', null=True, on_delete=models.SET_NULL)
