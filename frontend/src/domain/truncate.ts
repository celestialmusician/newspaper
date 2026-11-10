import type { DB } from './db'
import type { ID } from './types'

/**
 * Truncate (super administrator): clear chosen parts of one agency's data. Main tables are
 * picked on the left, sub-tables on the right; picking a main table also clears its sub-tables.
 * Anything that would leave broken links, or touch billing history, is locked with a reason.
 */
export type TruncKey =
  | 'customers'
  | 'subscriptions'
  | 'deliveries'
  | 'discounts'
  | 'complaints'
  | 'customer_logins'
  | 'executives'
  | 'handovers'
  | 'executive_logins'
  | 'routes'
  | 'staff'
  | 'staff_logins'
  | 'rolls'
  | 'products'
  | 'rates'
  | 'stock'
  | 'masters'
  | 'handling'
  | 'bills'

export const TRUNC_LABEL: Record<TruncKey, string> = {
  customers: 'Customers',
  subscriptions: 'Subscriptions',
  deliveries: 'Deliveries',
  discounts: 'Discounts',
  complaints: 'Complaints',
  customer_logins: 'Customer logins',
  executives: 'Delivery Boys',
  handovers: 'Route handovers',
  executive_logins: 'Delivery boy logins',
  routes: 'Routes',
  staff: 'Staff Users',
  staff_logins: 'Staff passwords',
  rolls: 'User Rolls',
  products: 'Own Products',
  rates: 'Product rates',
  stock: 'Stock',
  masters: 'Own Masters',
  handling: 'Handling Charges',
  bills: 'Bills & Payments',
}

export const TRUNC_MAIN: TruncKey[] = ['customers', 'executives', 'routes', 'staff', 'products', 'stock', 'masters', 'handling', 'bills']

/** Sub-tables of each main table: cleared with it, or on their own. */
export const TRUNC_SUBS: Partial<Record<TruncKey, TruncKey[]>> = {
  customers: ['subscriptions', 'deliveries', 'discounts', 'complaints', 'customer_logins'],
  executives: ['handovers', 'executive_logins'],
  staff: ['staff_logins', 'rolls'],
  products: ['rates'],
}

const PARENT: Partial<Record<TruncKey, TruncKey>> = Object.fromEntries(
  Object.entries(TRUNC_SUBS).flatMap(([p, subs]) => subs!.map((s) => [s, p])),
) as Partial<Record<TruncKey, TruncKey>>
export const parentOf = (k: TruncKey) => PARENT[k]

/** The ids an agency's data hangs on. */
function scope(db: DB, agentId: ID) {
  const customers = new Set(db.customers.filter((c) => c.agentId === agentId).map((c) => c.id))
  const executives = new Set(db.executives.filter((e) => e.agentId === agentId).map((e) => e.id))
  const routes = new Set(db.routes.filter((r) => r.agentId === agentId).map((r) => r.id))
  const staff = new Set(db.staffUsers.filter((s) => s.agentId === agentId).map((s) => s.id))
  const products = new Set(db.products.filter((p) => p.ownerId === agentId).map((p) => p.id))
  const subs = new Set(db.subscriptions.filter((s) => customers.has(s.customerId)).map((s) => s.id))
  const billing = db.invoices.some((i) => i.agentId === agentId) || db.payments.some((p) => p.agentId === agentId)
  return { customers, executives, routes, staff, products, subs, billing }
}

const credsOf = (db: DB, ids: Set<ID>) => Object.values(db.credentials).filter((c) => ids.has(c.userId))

/** Row count of every table for this agency. */
export function truncCounts(db: DB, agentId: ID): Record<TruncKey, number> {
  const s = scope(db, agentId)
  return {
    customers: s.customers.size,
    subscriptions: s.subs.size,
    deliveries: Object.values(db.deliveries).filter((d) => s.customers.has(d.customerId)).length,
    discounts: db.discounts.filter((d) => s.customers.has(d.customerId)).length,
    complaints: db.complaints.filter((c) => s.customers.has(c.customerId)).length,
    customer_logins: credsOf(db, s.customers).length,
    executives: s.executives.size,
    handovers: db.handovers.filter((h) => s.routes.has(h.routeId) || s.executives.has(h.toExecutiveId)).length,
    executive_logins: credsOf(db, s.executives).length,
    routes: s.routes.size,
    staff: s.staff.size,
    staff_logins: credsOf(db, s.staff).length,
    rolls: db.userRolls.filter((r) => r.agentId === agentId).length,
    products: s.products.size,
    rates: db.prices.filter((p) => p.agentId === agentId || s.products.has(p.productId)).length,
    stock: Object.values(db.stock).filter((e) => e.agentId === agentId).length,
    masters: db.masters.filter((m) => m.ownerId === agentId).length,
    handling: db.handlingCharges.filter((h) => h.agentId === agentId).length,
    bills: db.invoices.filter((i) => i.agentId === agentId).length + db.payments.filter((p) => p.agentId === agentId).length,
  }
}

/** Everything that will be cleared: the picks plus the sub-tables of picked main tables. */
export function truncExpand(picked: Iterable<TruncKey>): Set<TruncKey> {
  const out = new Set(picked)
  for (const k of [...out]) for (const sub of TRUNC_SUBS[k] ?? []) out.add(sub)
  return out
}

/** Why a table cannot be picked with the current picks, or undefined when it can. */
export function truncLock(db: DB, agentId: ID, key: TruncKey, picked: Set<TruncKey>, counts = truncCounts(db, agentId)): string | undefined {
  const s = scope(db, agentId)
  const on = truncExpand(picked)
  const clear = (k: TruncKey) => on.has(k) || counts[k] === 0
  if (key === 'bills') return 'Billing history is never wiped'
  if (s.billing && (key === 'customers' || key === 'subscriptions' || key === 'deliveries' || key === 'discounts' || key === 'products' || key === 'rates')) return 'Bills already use this data — lock the account instead'
  if (key === 'routes' && !clear('customers')) return 'Customers still use these routes'
  if (key === 'subscriptions' && !(clear('deliveries') && clear('discounts'))) return 'Deliveries and discounts still use these subscriptions'
  if (key === 'products') {
    const used = db.subscriptions.some((x) => s.subs.has(x.id) && s.products.has(x.productId))
    if (used && !on.has('subscriptions')) return 'Subscriptions still use these titles'
  }
  if (key === 'rolls' && !clear('staff')) return 'Staff users still use these rolls'
  return undefined
}

/** "Select All": every main table that can be picked, repeated until nothing more unlocks. */
export function truncSelectAll(db: DB, agentId: ID): Set<TruncKey> {
  const counts = truncCounts(db, agentId)
  const picked = new Set<TruncKey>()
  for (let changed = true; changed; ) {
    changed = false
    for (const k of TRUNC_MAIN) if (!picked.has(k) && !truncLock(db, agentId, k, picked, counts)) {
      picked.add(k)
      changed = true
    }
  }
  return picked
}

/** Clears the chosen tables in place. Callers run it inside a commit. */
export function truncApply(d: DB, agentId: ID, picked: Iterable<TruncKey>) {
  const keys = truncExpand(picked)
  for (const k of keys) {
    const why = truncLock(d, agentId, k, new Set(picked))
    if (why) throw new Error(`${TRUNC_LABEL[k]}: ${why}`)
  }
  const s = scope(d, agentId)
  const has = (k: TruncKey) => keys.has(k)
  const dropCreds = (ids: Set<ID>) => {
    for (const [k, c] of Object.entries(d.credentials)) if (ids.has(c.userId)) delete d.credentials[k]
  }

  if (has('deliveries')) d.deliveries = Object.fromEntries(Object.entries(d.deliveries).filter(([, r]) => !s.customers.has(r.customerId)))
  if (has('discounts')) d.discounts = d.discounts.filter((x) => !s.customers.has(x.customerId))
  if (has('complaints')) d.complaints = d.complaints.filter((x) => !s.customers.has(x.customerId))
  if (has('subscriptions')) {
    d.subscriptions = d.subscriptions.filter((x) => !s.subs.has(x.id))
    d.subscriptionEvents = d.subscriptionEvents.filter((x) => !s.subs.has(x.subscriptionId))
  }
  if (has('customer_logins')) dropCreds(s.customers)
  if (has('customers')) d.customers = d.customers.filter((c) => !s.customers.has(c.id))

  if (has('handovers')) d.handovers = d.handovers.filter((h) => !(s.routes.has(h.routeId) || s.executives.has(h.toExecutiveId)))
  if (has('executive_logins')) dropCreds(s.executives)
  if (has('executives')) {
    d.executives = d.executives.filter((e) => !s.executives.has(e.id))
    // Routes and past deliveries keep their history, just without the delivery boy.
    d.routes = d.routes.map((r) => (r.executiveId && s.executives.has(r.executiveId) ? { ...r, executiveId: null } : r))
    for (const [k, r] of Object.entries(d.deliveries)) if (r.executiveId && s.executives.has(r.executiveId)) d.deliveries[k] = { ...r, executiveId: null }
  }
  if (has('routes')) {
    d.routes = d.routes.filter((r) => !s.routes.has(r.id))
    d.handovers = d.handovers.filter((h) => !s.routes.has(h.routeId))
  }

  if (has('staff_logins')) dropCreds(s.staff)
  if (has('staff')) d.staffUsers = d.staffUsers.filter((x) => !s.staff.has(x.id))
  if (has('rolls')) d.userRolls = d.userRolls.filter((r) => r.agentId !== agentId)

  if (has('rates')) d.prices = d.prices.filter((p) => !(p.agentId === agentId || s.products.has(p.productId)))
  if (has('products')) {
    d.products = d.products.filter((p) => !s.products.has(p.id))
    d.stock = Object.fromEntries(Object.entries(d.stock).filter(([, e]) => !s.products.has(e.productId)))
  }
  if (has('stock')) d.stock = Object.fromEntries(Object.entries(d.stock).filter(([, e]) => e.agentId !== agentId))
  if (has('masters')) d.masters = d.masters.filter((m) => m.ownerId !== agentId)
  if (has('handling')) d.handlingCharges = d.handlingCharges.filter((h) => h.agentId !== agentId)
  return keys
}
