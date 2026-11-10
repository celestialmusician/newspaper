"""Three-level, effective-dated pricing — mirrors frontend/src/domain/pricing.ts."""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from catalog.models import PriceVersion


@dataclass
class ResolvedPrice:
    purchase_price: Decimal
    agent_price: Decimal
    customer_price: Decimal
    source: str

    @property
    def agency_margin(self):
        return self.agent_price - self.purchase_price

    @property
    def agent_margin(self):
        return self.customer_price - self.agent_price


def resolve_price(product_id: int, on: date, agent_id: int | None = None) -> ResolvedPrice | None:
    base = PriceVersion.objects.filter(product_id=product_id, agent__isnull=True, effective_from__lte=on).order_by('-effective_from', '-created_at').first()
    if not base:
        return None
    override = None
    if agent_id:
        override = PriceVersion.objects.filter(product_id=product_id, agent_id=agent_id, effective_from__lte=on).order_by('-effective_from', '-created_at').first()
    v = override or base
    # Purchase price is agency-level; agent overrides change agent/customer price only.
    return ResolvedPrice(base.purchase_price, v.agent_price, v.customer_price, 'agent' if override else 'base')


def validate_agent_override(base: ResolvedPrice, customer_price: Decimal, max_pct: Decimal) -> str | None:
    dev = abs(customer_price - base.customer_price) / base.customer_price
    if dev > max_pct / Decimal(100):
        return f'Agent-specific customer price must stay within ±{max_pct}% of the base price ({base.customer_price}).'
    return None
