import { round2 } from '@/lib/utils'
import type { DB } from './db'
import { weekday } from '@/lib/dates'
import type { Discount, ID, ISODate, PriceVersion, RateRow, Subscription } from './types'

/**
 * Three-level pricing.
 *   Agency margin = agentPrice − purchasePrice
 *   Agent margin  = customerPrice − agentPrice
 * Versions are immutable and effective-dated: editing a price adds a version.
 * Invoices snapshot the resolved price, so history never changes.
 */

export function versionsFor(db: Pick<DB, 'prices'>, productId: ID, agentId: ID | null = null) {
  return db.prices
    .filter((p) => p.productId === productId && p.agentId === agentId)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.createdAt.localeCompare(a.createdAt)))
}

function pick(versions: PriceVersion[], date: ISODate) {
  return versions.find((v) => v.effectiveFrom <= date)
}

export interface ResolvedPrice {
  purchasePrice: number
  agentPrice: number
  customerPrice: number
  agencyMargin: number
  agentMargin: number
  source: 'agent' | 'base'
  version: PriceVersion
}

/**
 * The rates that apply on one date: a special (festival / special edition) rate for that date range
 * wins, then the weekday rate of a daily title, then the version's headline rates.
 */
export function ratesOn(v: PriceVersion, date: ISODate): RateRow {
  const special = v.specials?.find((s) => s.from <= date && date <= s.to)
  if (special) return special
  const day = v.dayRates?.[weekday(date)]
  if (day && (day.purchase > 0 || day.sale > 0 || day.agent > 0)) return day
  return { purchase: v.purchasePrice, sale: v.customerPrice, agent: v.agentPrice }
}

export function resolvePrice(db: Pick<DB, 'prices'>, productId: ID, date: ISODate, agentId?: ID | null): ResolvedPrice | null {
  const base = pick(versionsFor(db, productId, null), date)
  if (!base) return null
  const override = agentId ? pick(versionsFor(db, productId, agentId), date) : undefined
  // Purchase price is always agency-level; an agent override changes agent / customer price only.
  const v = override ?? base
  const purchasePrice = ratesOn(base, date).purchase
  const r = ratesOn(v, date)
  return {
    purchasePrice,
    agentPrice: r.agent,
    customerPrice: r.sale,
    agencyMargin: round2(r.agent - purchasePrice),
    agentMargin: round2(r.sale - r.agent),
    source: override ? 'agent' : 'base',
    version: v,
  }
}

export function upcomingVersion(db: Pick<DB, 'prices'>, productId: ID, today: ISODate) {
  return versionsFor(db, productId, null)
    .filter((v) => v.effectiveFrom > today)
    .at(-1)
}

export function validatePriceTriple(p: { purchasePrice: number; agentPrice: number; customerPrice: number }): string | null {
  if ([p.purchasePrice, p.agentPrice, p.customerPrice].some((x) => !(x > 0))) return 'All three prices must be greater than zero.'
  if (p.agentPrice < p.purchasePrice) return 'Agent price cannot be lower than the agency purchase price.'
  if (p.customerPrice < p.agentPrice) return 'Customer price cannot be lower than the agent price.'
  return null
}

/** Agent-specific price must stay within ±maxPct of the base customer price. */
export function validateAgentOverride(base: ResolvedPrice, customerPrice: number, maxPct: number): string | null {
  const dev = Math.abs(customerPrice - base.customerPrice) / base.customerPrice
  if (dev > maxPct / 100 + 1e-9) return `Agent-specific customer price must stay within ±${maxPct}% of the base price (${base.customerPrice}).`
  return null
}

// ---------- Discounts ----------

export function activeDiscounts(db: Pick<DB, 'discounts'>, customerId: ID, from: ISODate, to: ISODate) {
  return db.discounts.filter(
    (d) => !d.revoked && d.customerId === customerId && d.startDate <= to && (d.expiryDate === null || d.expiryDate >= from),
  )
}

/** Discount amount for one line or whole bill. Percentage applies to base; fixed is capped at base. */
export function discountAmount(d: Discount, base: number) {
  const raw = d.kind === 'percentage' ? (base * d.value) / 100 : d.value
  return round2(Math.min(raw, base))
}

export function discountPctOf(d: Pick<Discount, 'kind' | 'value'>, base: number) {
  if (d.kind === 'percentage') return d.value
  return base > 0 ? (d.value / base) * 100 : 0
}

export const subscriptionLabel = (db: Pick<DB, 'products'>, s: Subscription) => db.products.find((p) => p.id === s.productId)?.name ?? 'Product'
