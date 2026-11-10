import { addDaysISO, dayOfMonth, daysInMonth, diffDays, eachDay, todayISO, weekday } from '@/lib/dates'
import type { DB } from './db'
import { locationChain } from './locations'
import type { Customer, DeliveryRecord, DeliveryStatus, Holiday, ID, ISODate, Subscription } from './types'

/**
 * Delivery schedule engine.
 *
 * The calendar is never stored — it is derived from subscriptions every time.
 * Only real outcomes (delivered / missed) are persisted, keyed by `${subscriptionId}|${date}`.
 * That makes duplicate delivery entries structurally impossible, and every change to a
 * subscription (frequency, pause, resume, expiry) or holiday is reflected instantly.
 */

export const deliveryKey = (subscriptionId: ID, date: ISODate) => `${subscriptionId}|${date}`

/** Last date the subscription can deliver on (end date / cancellation), or null = open-ended. */
export function effectiveEnd(sub: Subscription): ISODate | null {
  const ends = [sub.endDate, sub.cancelledOn ? addDaysISO(sub.cancelledOn, -1) : null].filter(Boolean) as ISODate[]
  return ends.length ? ends.sort()[0]! : null
}

/** Frequency rule only — ignores pauses and holidays. */
/** Copies delivered on a date: the per-weekday quantity for Individual Day subscriptions, otherwise the flat quantity. */
export function qtyOn(sub: Subscription, date: ISODate): number {
  return sub.dayQuantities ? sub.dayQuantities[weekday(date)] ?? 0 : sub.quantity
}

export function matchesFrequency(sub: Subscription, date: ISODate): boolean {
  if (date < sub.startDate) return false
  const end = effectiveEnd(sub)
  if (end && date > end) return false
  switch (sub.frequency) {
    case 'daily':
      return sub.dayQuantities ? (sub.dayQuantities[weekday(date)] ?? 0) > 0 : true
    case 'weekly':
      return weekday(date) === (sub.weekdays[0] ?? weekday(sub.startDate))
    case 'twice_weekly':
      return sub.weekdays.includes(weekday(date))
    case 'every_14_days':
      return diffDays(date, sub.startDate) % 14 === 0
    case 'fortnightly': {
      const d = dayOfMonth(date)
      return d === 1 || d === 16
    }
    case 'monthly':
    case 'twice_monthly': {
      const days = sub.monthDays.length ? sub.monthDays : [dayOfMonth(sub.startDate)]
      const dim = daysInMonth(date)
      const d = dayOfMonth(date)
      // 31st on a 30-day month falls on the last day — never skipped.
      return days.some((md) => Math.min(md, dim) === d)
    }
    case 'custom':
      return sub.customDates.includes(date)
  }
}

export function isPausedOn(sub: Subscription, date: ISODate) {
  return sub.pauses.some((p) => date >= p.from && (p.to === null || date <= p.to))
}

export interface HolidayContext {
  holidaysByDate: Map<ISODate, Holiday[]>
  chainCache: Map<ID, Set<ID>>
}

export function holidayContext(db: Pick<DB, 'holidays' | 'locations'>): HolidayContext {
  const holidaysByDate = new Map<ISODate, Holiday[]>()
  for (const h of db.holidays) {
    const list = holidaysByDate.get(h.date) ?? []
    list.push(h)
    holidaysByDate.set(h.date, list)
  }
  return { holidaysByDate, chainCache: new Map() }
}

function areaChainIds(db: Pick<DB, 'locations'>, ctx: HolidayContext, areaId: ID) {
  let s = ctx.chainCache.get(areaId)
  if (!s) {
    s = new Set(locationChain(db, areaId).map((l) => l.id))
    ctx.chainCache.set(areaId, s)
  }
  return s
}

/** A holiday that suspends delivery for this customer+product on that date, if any. */
export function blockingHoliday(
  db: Pick<DB, 'locations'>,
  ctx: HolidayContext,
  areaId: ID,
  productId: ID,
  date: ISODate,
): Holiday | undefined {
  const list = ctx.holidaysByDate.get(date)
  if (!list) return undefined
  const chain = areaChainIds(db, ctx, areaId)
  return list.find(
    (h) =>
      !h.deliveryApplicable &&
      (h.locationIds.length === 0 || h.locationIds.some((id) => chain.has(id))) &&
      (h.productIds.length === 0 || h.productIds.includes(productId)),
  )
}

export interface Occurrence {
  key: string
  date: ISODate
  subscription: Subscription
  customerId: ID
  productId: ID
  quantity: number
  status: DeliveryStatus
  holiday?: Holiday
  record?: DeliveryRecord
}

export function occurrenceStatus(
  sub: Subscription,
  date: ISODate,
  record: DeliveryRecord | undefined,
  holiday: Holiday | undefined,
  today: ISODate,
): DeliveryStatus {
  if (record) return record.status
  if (isPausedOn(sub, date)) return 'paused'
  if (holiday) return 'holiday'
  if (date < today) return 'pending' // past and never marked — needs follow-up
  if (date === today) return 'pending'
  return 'scheduled'
}

/** All occurrences for the given subscriptions in [from, to]. */
export function occurrences(
  db: Pick<DB, 'customers' | 'locations' | 'holidays' | 'deliveries'>,
  subs: Subscription[],
  from: ISODate,
  to: ISODate,
  opts: { includePaused?: boolean; includeHoliday?: boolean } = {},
): Occurrence[] {
  const { includePaused = true, includeHoliday = true } = opts
  const ctx = holidayContext(db as DB)
  const custById = new Map<ID, Customer>(db.customers.map((c) => [c.id, c]))
  const today = todayISO()
  const days = eachDay(from, to)
  const out: Occurrence[] = []
  for (const sub of subs) {
    const cust = custById.get(sub.customerId)
    if (!cust) continue
    for (const date of days) {
      if (!matchesFrequency(sub, date)) continue
      const key = deliveryKey(sub.id, date)
      const record = db.deliveries[key]
      const holiday = blockingHoliday(db, ctx, cust.areaId, sub.productId, date)
      const status = occurrenceStatus(sub, date, record, holiday, today)
      if (!includePaused && status === 'paused') continue
      if (!includeHoliday && status === 'holiday') continue
      out.push({ key, date, subscription: sub, customerId: sub.customerId, productId: sub.productId, quantity: qtyOn(sub, date), status, holiday, record })
    }
  }
  return out
}

/**
 * Billable copies for a subscription in a period.
 * Billing rule: holidays / strikes do NOT reduce the bill (fixed-rate subscription);
 * only paused days and days outside the subscription window are excluded.
 */
export function billableDeliveries(sub: Subscription, from: ISODate, to: ISODate): number {
  let n = 0
  for (const date of eachDay(from, to)) if (matchesFrequency(sub, date) && !isPausedOn(sub, date)) n++
  return n
}

/** Upcoming n delivery dates (skipping paused + holidays) — used in customer dashboard. */
export function nextDeliveries(db: DB, subs: Subscription[], days = 14) {
  const today = todayISO()
  return occurrences(db, subs, today, addDaysISO(today, days)).filter((o) => o.status === 'scheduled' || o.status === 'pending')
}

/** Copies expected per product on a date for a set of subscriptions (stock + executive load). */
export function demandByProduct(db: DB, subs: Subscription[], date: ISODate) {
  const out = new Map<ID, number>()
  for (const o of occurrences(db, subs, date, date)) {
    if (o.status === 'paused' || o.status === 'holiday') continue
    out.set(o.productId, (out.get(o.productId) ?? 0) + o.quantity)
  }
  return out
}

export function deriveSubscriptionStatus(sub: Subscription, today = todayISO()): Subscription['status'] {
  if (sub.cancelledOn && sub.cancelledOn <= today) return 'cancelled'
  if (sub.endDate && sub.endDate < today) return 'expired'
  if (isPausedOn(sub, today)) return 'paused'
  return 'active'
}
