"""Delivery schedule engine — mirrors frontend/src/domain/schedule.ts.

The calendar is derived, never stored. Only outcomes live in DeliveryRecord
(unique per subscription+date), so duplicate entries are impossible.
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from crm.models import Subscription
from distribution.models import DeliveryRecord, Holiday


def js_weekday(d: date) -> int:
    """0=Sunday … 6=Saturday (same convention as the frontend)."""
    return (d.weekday() + 1) % 7


def effective_end(sub: Subscription):
    ends = [x for x in [sub.end_date, sub.cancelled_on - timedelta(days=1) if sub.cancelled_on else None] if x]
    return min(ends) if ends else None


def matches_frequency(sub: Subscription, d: date) -> bool:
    if d < sub.start_date:
        return False
    end = effective_end(sub)
    if end and d > end:
        return False
    f = sub.frequency
    if f == 'daily':
        return True
    if f == 'weekly':
        return js_weekday(d) == (sub.weekdays[0] if sub.weekdays else js_weekday(sub.start_date))
    if f == 'twice_weekly':
        return js_weekday(d) in sub.weekdays
    if f == 'every_14_days':
        return (d - sub.start_date).days % 14 == 0
    if f == 'fortnightly':
        return d.day in (1, 16)
    if f in ('monthly', 'twice_monthly'):
        days = sub.month_days or [sub.start_date.day]
        dim = calendar.monthrange(d.year, d.month)[1]
        return any(min(md, dim) == d.day for md in days)
    if f == 'custom':
        return d.isoformat() in sub.custom_dates
    return False


def is_paused(sub: Subscription, d: date, pauses=None) -> bool:
    pauses = pauses if pauses is not None else list(sub.pauses.all())
    return any(p.date_from <= d and (p.date_to is None or d <= p.date_to) for p in pauses)


def derive_status(sub: Subscription, today: date | None = None) -> str:
    today = today or date.today()
    if sub.cancelled_on and sub.cancelled_on <= today:
        return 'cancelled'
    if sub.end_date and sub.end_date < today:
        return 'expired'
    if is_paused(sub, today):
        return 'paused'
    return 'active'


class HolidayIndex:
    def __init__(self, start: date, end: date):
        self.by_date: dict[date, list[Holiday]] = {}
        for h in Holiday.objects.filter(date__range=(start, end), delivery_applicable=False).prefetch_related('locations', 'products'):
            self.by_date.setdefault(h.date, []).append(h)
        self._chains: dict[int, set[int]] = {}

    def blocking(self, area, product_id: int, d: date):
        hs = self.by_date.get(d)
        if not hs:
            return None
        chain = self._chains.get(area.id)
        if chain is None:
            chain = {n.id for n in area.ancestors()}
            self._chains[area.id] = chain
        for h in hs:
            locs = [l.id for l in h.locations.all()]
            prods = [p.id for p in h.products.all()]
            if (not locs or chain.intersection(locs)) and (not prods or product_id in prods):
                return h
        return None


@dataclass
class Occurrence:
    subscription: Subscription
    date: date
    status: str
    quantity: int
    holiday: Holiday | None = None
    record: DeliveryRecord | None = None


def occurrences(subs, start: date, end: date):
    subs = list(subs.select_related('customer__area', 'product').prefetch_related('pauses')) if hasattr(subs, 'select_related') else list(subs)
    records = {(r.subscription_id, r.date): r for r in DeliveryRecord.objects.filter(subscription__in=subs, date__range=(start, end))}
    hol = HolidayIndex(start, end)
    today = date.today()
    out = []
    for sub in subs:
        pauses = list(sub.pauses.all())
        d = start
        while d <= end:
            if matches_frequency(sub, d):
                rec = records.get((sub.id, d))
                holiday = hol.blocking(sub.customer.area, sub.product_id, d)
                if rec:
                    status = rec.status
                elif is_paused(sub, d, pauses):
                    status = 'paused'
                elif holiday:
                    status = 'holiday'
                else:
                    status = 'pending' if d <= today else 'scheduled'
                out.append(Occurrence(sub, d, status, sub.quantity, holiday, rec))
            d += timedelta(days=1)
    return out


def billable_deliveries(sub: Subscription, start: date, end: date) -> list[date]:
    """Billing rule: holidays/strikes do NOT reduce the bill; only paused days are excluded."""
    pauses = list(sub.pauses.all())
    out, d = [], start
    while d <= end:
        if matches_frequency(sub, d) and not is_paused(sub, d, pauses):
            out.append(d)
        d += timedelta(days=1)
    return out
