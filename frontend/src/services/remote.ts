/**
 * Live backend adapter (VITE_API_MODE=http).
 *
 * Screens keep calling the same service objects as the demo (`products.create`,
 * `deliveries.mark`, …). `installRemote()` points every method at the Django REST API,
 * and after each change re-syncs the affected collections of the signed-in user's
 * role-scoped snapshot (GET /api/sync/snapshot/), so derived views — calendar,
 * billing previews, dashboards — always reflect what the server stored.
 *
 * Ids are opaque strings `<prefix>_<pk>` issued by the server; `pk()` turns them back
 * into primary keys for request bodies.
 */
import { create } from 'zustand'
import type { DB } from '@/domain/db'
import type { Complaint, Holiday, ID, ISODate, Product, Role, Route, StockEntry, SystemSettings } from '@/domain/types'
import { todayISO } from '@/lib/dates'
import * as api from './api'
import { ApiError, type AgentInput, type CustomerInput, type ExecutiveInput, type MarkInput, type PaymentInput, type ProductInput, type SubscriptionInput } from './api'
import { http } from './http'
import { emptyDB, getDB, getSession, replaceDB, setSession, useDB, type Session } from './store'

type Collection = Exclude<keyof DB, 'version' | 'seededOn' | 'credentials' | 'processedKeys' | 'counters' | 'publicCounts'>

const pk = (id: ID | null | undefined) => (id ? Number(id.slice(id.lastIndexOf('_') + 1)) : null)
const pks = (ids: ID[] | undefined) => (ids ?? []).map((x) => pk(x)!)
const nil = <T,>(v: T | undefined | null) => (v === undefined || v === '' ? null : v)

// ---------------------------------------------------------------- sync state
export const useSync = create<{ status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; lastPull?: number }>(() => ({ status: 'idle' }))

/** Pull (part of) the snapshot into the local store. */
export async function pull(only?: Collection[], token?: string) {
  const q = only?.length ? `?only=${[...new Set(only)].join(',')}` : ''
  if (!only) useSync.setState({ status: useSync.getState().status === 'ready' ? 'ready' : 'loading', error: undefined })
  try {
    const snap = await http<Partial<DB>>(`/sync/snapshot/${q}`, { token })
    const base = only ? getDB() : emptyDB()
    replaceDB({ ...base, ...snap } as DB, { cache: true })
    useSync.setState({ status: 'ready', lastPull: Date.now(), error: undefined })
  } catch (e) {
    if (!only) useSync.setState({ status: getDB().seededOn ? 'ready' : 'error', error: e instanceof Error ? e.message : String(e) })
    throw e
  }
}

const COMMON: Collection[] = ['notifications', 'logs']
async function mutate<T>(path: string, init: Parameters<typeof http>[1], refresh: Collection[] | 'all'): Promise<T> {
  const res = await http<T>(path, init)
  await pull(refresh === 'all' ? undefined : [...refresh, ...COMMON]).catch(() => undefined)
  return res
}
const post = <T,>(path: string, json: unknown, refresh: Collection[] | 'all') => mutate<T>(path, { method: 'POST', json }, refresh)
const patch = <T,>(path: string, json: unknown, refresh: Collection[] | 'all') => mutate<T>(path, { method: 'PATCH', json }, refresh)
const del = <T,>(path: string, refresh: Collection[] | 'all') => mutate<T>(path, { method: 'DELETE' }, refresh)

/** Find the entity a create call just made, once the snapshot has it. */
function found<K extends 'products' | 'agents' | 'executives' | 'customers' | 'locations' | 'subscriptions' | 'routes' | 'complaints' | 'discounts' | 'holidays'>(key: K, prefix: string, serverPk: number) {
  const id = `${prefix}_${serverPk}`
  const hit = (getDB()[key] as { id: ID }[]).find((x) => x.id === id)
  if (!hit) throw new ApiError('Saved, but the update has not reached this device yet. Pull to refresh.')
  return hit as DB[K][number]
}

// ---------------------------------------------------------------- sign-in
interface Tokens {
  access: string
  refresh: string
  role: Role
  user_id: ID
  name: string
}

async function startSession(t: Tokens) {
  // Load the user's data first so the dashboard opens fully populated.
  await pull(undefined, t.access)
  const s: Session = { role: t.role, userId: t.user_id, token: t.access, refresh: t.refresh, issuedAt: new Date().toISOString() }
  setSession(s)
  return s
}

/** Public data for the sign-in / registration screens (agency name, locations, sample accounts in demo mode). */
export async function loadPublic() {
  try {
    const b = await http<{ settings: SystemSettings; locations: DB['locations']; counts: NonNullable<DB['publicCounts']>; samples: { role: Role; name: string; mobile: string; id: ID }[] }>('/sync/bootstrap/')
    const db = emptyDB()
    db.settings = b.settings
    db.locations = b.locations
    db.publicCounts = b.counts
    for (const s of b.samples) {
      const person = { id: s.id, name: s.name, mobile: s.mobile, status: 'active' as const }
      if (s.role === 'admin') db.admins.push({ ...person, email: '' })
      if (s.role === 'agent') db.agents.push({ ...person, code: '', email: '', agencyName: '', areaIds: [], maxDiscountPct: 0, canManageRoutes: false, joiningDate: '' })
      if (s.role === 'executive') db.executives.push({ ...person, code: '', agentId: '', areaIds: [], joiningDate: '', canCollectCash: false })
      if (s.role === 'customer') db.customers.push({ ...person, code: '', areaId: '', houseName: '', address: '', lat: 0, lng: 0, agentId: '', routeId: null, idProof: 'None', securityDeposit: 0, handlingCharge: 0, registeredOn: '' })
    }
    replaceDB(db, { cache: false })
  } catch {
    /* server offline: the sign-in form still works once it is reachable */
  }
}

const known = new Set<string>() // role:mobile confirmed by lookup → OTP is for sign-in, not registration
const demoCodes = new Map<string, string>()
const PENDING_REG = 'nap.pendingRegistration'

const auth: Partial<typeof api.auth> = {
  async lookup(role, mobile) {
    const r = await http<{ name: string; has_mpin: boolean }>('/auth/lookup/', { method: 'POST', json: { role, mobile } })
    known.add(`${role}:${mobile}`)
    return { name: r.name, hasMpin: r.has_mpin }
  },
  async requestOtp(role, mobile) {
    const key = `${role}:${mobile}`
    const registering = role === 'customer' && !known.has(key)
    const r = await http<{ cooldown: number; reused: boolean; demo_otp?: string }>('/auth/otp/request/', { method: 'POST', json: { role, mobile, registering } })
    if (r.demo_otp) demoCodes.set(key, r.demo_otp)
    return { demoOtp: r.demo_otp ?? demoCodes.get(key) ?? '', cooldown: r.cooldown, reused: r.reused || !r.demo_otp }
  },
  async verifyOtp(role, mobile, otp) {
    const r = await http<{ otp_token: string }>('/auth/otp/verify/', { method: 'POST', json: { role, mobile, otp } })
    return { otpToken: r.otp_token }
  },
  async setMpin(role, mobile, mpin, otpToken) {
    const pending = readPending()
    if (role === 'customer' && pending?.mobile === mobile) {
      // Self-registration is created together with the MPIN in one verified call.
      const t = await http<Tokens>('/auth/register/', { method: 'POST', json: { ...customerBody(pending), otp_token: otpToken, mpin } })
      sessionStorage.removeItem(PENDING_REG)
      return startSession(t)
    }
    return startSession(await http<Tokens>('/auth/mpin/set/', { method: 'POST', json: { role, mobile, mpin, otp_token: otpToken } }))
  },
  async loginWithMpin(role, mobile, mpin) {
    return startSession(await http<Tokens>('/auth/mpin/login/', { method: 'POST', json: { role, mobile, mpin } }))
  },
  async registerCustomer(input) {
    // Held until the MPIN step, where /auth/register/ creates the account atomically.
    try {
      sessionStorage.setItem(PENDING_REG, JSON.stringify(input))
    } catch {
      /* ignore */
    }
    return { customerId: '' }
  },
  logout() {
    setSession(null)
    replaceDB(emptyDB(), { cache: false })
    useSync.setState({ status: 'idle' })
    void loadPublic()
  },
}

function readPending(): CustomerInput | null {
  try {
    return JSON.parse(sessionStorage.getItem(PENDING_REG) ?? 'null') as CustomerInput | null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- body mappers
function customerBody(c: Partial<CustomerInput & { status: string }>) {
  const b: Record<string, unknown> = {}
  const set = (k: string, v: unknown) => v !== undefined && (b[k] = v)
  set('name', c.name?.trim())
  set('mobile', c.mobile)
  set('alt_mobile', c.altMobile ?? (c.altMobile === undefined ? undefined : ''))
  set('whatsapp', c.whatsapp)
  set('email', c.email)
  set('gender', c.gender)
  set('dob', c.dob === undefined ? undefined : nil(c.dob))
  set('area', c.areaId === undefined ? undefined : pk(c.areaId))
  set('house_name', c.houseName)
  set('landmark', c.landmark)
  set('address', c.address)
  set('lat', c.lat)
  set('lng', c.lng)
  set('id_proof', c.idProof)
  set('id_number', c.idNumber)
  set('security_deposit', c.securityDeposit === undefined ? undefined : Number(c.securityDeposit) || 0)
  set('handling_charge', c.handlingCharge === undefined ? undefined : Number(c.handlingCharge) || 0)
  set('agent', c.agentId === undefined ? undefined : pk(c.agentId))
  set('route', c.routeId === undefined ? undefined : pk(c.routeId))
  set('status', c.status)
  return b
}

function productBody(p: Partial<ProductInput & { purchasePrice: number; agentPrice: number; customerPrice: number }>) {
  const map: Record<string, string> = { code: 'code', name: 'name', category: 'category', publisher: 'publisher', language: 'language', type: 'product_type', description: 'description', availability: 'availability', defaultFrequency: 'default_frequency', status: 'status', color: 'color', lowStockThreshold: 'low_stock_threshold', purchasePrice: 'purchase_price', agentPrice: 'agent_price', customerPrice: 'customer_price' }
  const b: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(p)) if (map[k] && v !== undefined) b[map[k]] = k === 'code' ? String(v).trim().toUpperCase() : v
  if (p.image !== undefined) {
    if (!p.image) b.image_data = ''
    else if (p.image.startsWith('data:')) b.image_data = p.image
  }
  return b
}

function agentBody(a: Partial<AgentInput>) {
  return drop({ name: a.name, mobile: a.mobile, status: a.status, agency_name: a.agencyName, email: a.email, areas: a.areaIds && pks(a.areaIds), max_discount_pct: a.maxDiscountPct, can_manage_routes: a.canManageRoutes, joining_date: a.joiningDate })
}
function executiveBody(e: Partial<ExecutiveInput>) {
  return drop({ name: e.name, mobile: e.mobile, status: e.status, agent: e.agentId && pk(e.agentId), areas: e.areaIds && pks(e.areaIds), joining_date: e.joiningDate, can_collect_cash: e.canCollectCash, alt_mobile: e.altMobile, alt_mobile_relation: e.altMobileRelation })
}
function subscriptionBody(s: Partial<SubscriptionInput>) {
  return drop({
    customer: s.customerId && pk(s.customerId), product: s.productId && pk(s.productId), start_date: s.startDate, end_date: s.endDate === undefined ? undefined : nil(s.endDate),
    frequency: s.frequency, weekdays: s.weekdays, month_days: s.monthDays, custom_dates: s.customDates, quantity: s.quantity, notes: s.notes ?? (s.notes === undefined ? undefined : ''),
  })
}
const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

const SUBS: Collection[] = ['subscriptions', 'subscriptionEvents']
const PEOPLE: Collection[] = ['customers', 'routes', 'agents', 'executives']

// ---------------------------------------------------------------- services
const products: Partial<typeof api.products> = {
  async create(input) {
    const r = await post<{ id: number }>('/products/', productBody(input), ['products', 'prices'])
    return found('products', 'prd', r.id) as Product
  },
  async update(id, p) {
    await patch(`/products/${pk(id)}/`, productBody(p), ['products'])
    return getDB().products.find((x) => x.id === id)!
  },
  async remove(id) {
    const r = await del<{ result: 'deleted' | 'archived' }>(`/products/${pk(id)}/`, ['products', 'prices', 'subscriptions'])
    return r.result
  },
}

const prices: Partial<typeof api.prices> = {
  async addVersion(v) {
    await post('/prices/', { product: pk(v.productId), agent: pk(v.agentId), purchase_price: v.purchasePrice, agent_price: v.agentPrice, customer_price: v.customerPrice, effective_from: v.effectiveFrom, note: v.note ?? '' }, ['prices'])
  },
  async removeFuture(id) {
    await del(`/prices/${pk(id)}/`, ['prices'])
  },
}

const agents: Partial<typeof api.agents> = {
  async create(input) {
    const r = await post<{ id: number }>('/agents/', agentBody(input), ['agents'])
    return found('agents', 'agt', r.id)
  },
  async update(id, p) {
    await patch(`/agents/${pk(id)}/`, agentBody(p), ['agents'])
    return getDB().agents.find((x) => x.id === id)!
  },
}

const executives: Partial<typeof api.executives> = {
  async create(input) {
    const r = await post<{ id: number }>('/executives/', executiveBody(input), ['executives'])
    return found('executives', 'exe', r.id)
  },
  async update(id, p) {
    await patch(`/executives/${pk(id)}/`, executiveBody(p), ['executives'])
    return getDB().executives.find((x) => x.id === id)!
  },
}

const customers: Partial<typeof api.customers> = {
  async create(input) {
    const s = getSession()
    const body = customerBody({ ...input, agentId: input.agentId ?? (s?.role === 'agent' ? s.userId : undefined), routeId: input.routeId ?? null })
    const r = await post<{ id: number }>('/customers/', body, PEOPLE)
    return found('customers', 'cus', r.id)
  },
  async update(id, p) {
    await patch(`/customers/${pk(id)}/`, customerBody(p), PEOPLE)
    return getDB().customers.find((x) => x.id === id)!
  },
}

const locations: Partial<typeof api.locations> = {
  async create(input) {
    const r = await post<{ id: number }>('/locations/', { level: input.level, name: input.name.trim(), parent: pk(input.parentId), pincode: input.pincode ?? '', lat: input.lat ?? null, lng: input.lng ?? null }, ['locations', 'agents'])
    return found('locations', 'loc', r.id)
  },
  async update(id, p) {
    await patch(`/locations/${pk(id)}/`, drop({ name: p.name, pincode: p.pincode, lat: p.lat, lng: p.lng }), ['locations'])
    return getDB().locations.find((x) => x.id === id)!
  },
  async remove(id) {
    await del(`/locations/${pk(id)}/`, ['locations'])
  },
}

const subscriptions: Partial<typeof api.subscriptions> = {
  async create(input) {
    const r = await post<{ id: number }>('/subscriptions/', subscriptionBody(input), SUBS)
    return found('subscriptions', 'sub', r.id)
  },
  async update(id, p) {
    const { customerId: _c, ...rest } = p
    void _c
    await patch(`/subscriptions/${pk(id)}/`, subscriptionBody(rest), SUBS)
    return getDB().subscriptions.find((x) => x.id === id)!
  },
  async pause(id, from, to, reason) {
    await post(`/subscriptions/${pk(id)}/pause/`, { from, to, reason: reason ?? '' }, SUBS)
    return getDB().subscriptions.find((x) => x.id === id)!
  },
  async resume(id, on = todayISO()) {
    await post(`/subscriptions/${pk(id)}/resume/`, { on }, SUBS)
    return getDB().subscriptions.find((x) => x.id === id)!
  },
  async cancel(id, effective = todayISO()) {
    await post(`/subscriptions/${pk(id)}/cancel/`, { effective }, SUBS)
    return getDB().subscriptions.find((x) => x.id === id)!
  },
  async renew(id, newEnd) {
    await post(`/subscriptions/${pk(id)}/renew/`, { end_date: newEnd }, SUBS)
    return getDB().subscriptions.find((x) => x.id === id)!
  },
  async change(id, input) {
    const r = await post<{ id: number }>(`/subscriptions/${pk(id)}/change/`, subscriptionBody(input), SUBS)
    return found('subscriptions', 'sub', r.id)
  },
}

const holidays: Partial<typeof api.holidays> = {
  async save(h: Omit<Holiday, 'id'> & { id?: ID }) {
    const body = { name: h.name, date: h.date, type: h.type, locations: pks(h.locationIds), products: pks(h.productIds), delivery_applicable: h.deliveryApplicable, description: h.description ?? '' }
    if (h.id) {
      await patch(`/holidays/${pk(h.id)}/`, body, ['holidays'])
      return getDB().holidays.find((x) => x.id === h.id)!
    }
    const r = await post<{ id: number }>('/holidays/', body, ['holidays'])
    return found('holidays', 'hol', r.id) as Holiday
  },
  async remove(id) {
    await del(`/holidays/${pk(id)}/`, ['holidays'])
  },
}

const routes: Partial<typeof api.routes> = {
  async save(r) {
    const body = { name: r.name, areas: pks(r.areaIds), agent: pk(r.agentId), executive: pk(r.executiveId), instructions: r.instructions ?? '', status: r.status }
    if (r.id) {
      await patch(`/routes/${pk(r.id)}/`, body, ['routes', 'handovers'])
      return getDB().routes.find((x) => x.id === r.id)!
    }
    const res = await post<{ id: number }>('/routes/', body, ['routes', 'handovers'])
    return found('routes', 'rte', res.id) as Route
  },
  async remove(id) {
    await del(`/routes/${pk(id)}/`, ['routes'])
  },
  async setStops(id, stops) {
    await mutate(`/routes/${pk(id)}/stops/`, { method: 'PUT', json: { stops: stops.map((s) => ({ customer: pk(s.customerId), instructions: s.instructions ?? '' })) } }, ['routes', 'customers'])
    return getDB().routes.find((x) => x.id === id)!
  },
  async handover(id, toExecutiveId, note) {
    await post(`/routes/${pk(id)}/handover/`, { to_executive: pk(toExecutiveId), note: note ?? '' }, ['routes', 'handovers', 'executives', 'customers'])
    return getDB().routes.find((x) => x.id === id)!
  },
}

const markBody = (m: MarkInput) => ({ subscription: pk(m.subscriptionId), date: m.date, status: m.status, reason: m.reason ?? '', remarks: m.remarks ?? '', from_offline: !!m.fromOffline })
const deliveries: Partial<typeof api.deliveries> = {
  // The server upserts on subscription + date, so a replayed tap can never create a second record.
  async mark(input) {
    await post('/deliveries/mark/', markBody(input), ['deliveries', 'stock'])
    return 'ok'
  },
  async markMany(items) {
    for (const m of items) await http('/deliveries/mark/', { method: 'POST', json: markBody(m) })
    await pull(['deliveries', 'stock', ...COMMON]).catch(() => undefined)
    return items.length
  },
}

const stock: Partial<typeof api.stock> = {
  async upsert(e) {
    await post('/stock/', { date: e.date, product: pk(e.productId), agent: pk(e.agentId), opening: e.opening, received: e.received, returned: e.returned, damaged: e.damaged }, ['stock'])
    return getDB().stock[`${e.date}|${e.productId}|${e.agentId}`]!
  },
  async reconcile(key) {
    const entry = getDB().stock[key] as (StockEntry & { serverId?: number }) | undefined
    if (!entry?.serverId) throw new ApiError('Stock entry not found.')
    await post(`/stock/${entry.serverId}/reconcile/`, {}, ['stock'])
  },
}

const discounts: Partial<typeof api.discounts> = {
  async create(d) {
    const r = await post<{ id: number }>('/discounts/', { customer: pk(d.customerId), subscription: pk(d.subscriptionId), kind: d.kind, category: d.category, value: d.value, start_date: d.startDate, expiry_date: d.expiryDate, reason: d.reason }, ['discounts'])
    return found('discounts', 'dsc', r.id)
  },
  async revoke(id) {
    await post(`/discounts/${pk(id)}/revoke/`, {}, ['discounts'])
  },
}

const billing: Partial<typeof api.billing> = {
  async generate(periodStart: ISODate, customerIds?: ID[]) {
    const r = await post<{ created: number; skipped: number }>('/invoices/generate/', { period_start: periodStart, customers: customerIds && pks(customerIds) }, ['invoices', 'payments'])
    return { ...r, ids: [] }
  },
  async adjust(invoiceId, label, amount) {
    await post(`/invoices/${pk(invoiceId)}/adjust/`, { label, amount }, ['invoices'])
    return getDB().invoices.find((i) => i.id === invoiceId)!
  },
}

const paymentBody = (p: PaymentInput) => ({ customer: pk(p.customerId), amount: p.amount, method: p.method, idempotency_key: p.idempotencyKey, note: p.note ?? '', from_offline: !!p.fromOffline })
async function record(path: string, body: Record<string, unknown>) {
  const r = await post<{ id: number; duplicate: boolean }>(path, body, ['payments', 'invoices'])
  const payment = getDB().payments.find((x) => x.id === `pay_${r.id}`)
  if (!payment) throw new ApiError('Payment saved — refresh to see the receipt.')
  return { payment, duplicate: r.duplicate }
}
const payments: Partial<typeof api.payments> = {
  collect: (input) => record('/payments/collect/', paymentBody(input)),
  // DEMO GATEWAY on the server too: simulated=true and a SIM- reference; no money moves.
  payOnline: (input) => record('/payments/pay_online/', { ...paymentBody(input), simulate: input.outcome === 'failure' ? 'failure' : undefined }),
  async verify(id) {
    await post(`/payments/${pk(id)}/verify/`, {}, ['payments'])
  },
}

const remittances: Partial<typeof api.remittances> = {
  async create(r) {
    await post('/remittances/', { agent: pk(r.agentId), amount: r.amount, date: r.date, reference: r.reference }, ['remittances'])
  },
}

const complaints: Partial<typeof api.complaints> = {
  async create(c) {
    const r = await post<{ id: number }>('/complaints/', { category: c.category, message: c.message }, ['complaints'])
    return found('complaints', 'cmp', r.id) as Complaint
  },
  async respond(id, note, status) {
    await post(`/complaints/${pk(id)}/respond/`, { note, status }, ['complaints'])
  },
}

const notifications: Partial<typeof api.notifications> = {
  async markRead(ids) {
    // Optimistic: the bell clears immediately.
    const set = new Set(ids)
    const db = getDB()
    useDB.setState({ db: { ...db, notifications: db.notifications.map((n) => (set.has(n.id) ? { ...n, read: true } : n)) } })
    await post('/notifications/mark_read/', { ids: pks(ids) }, [])
  },
}

const SETTINGS_MAP: Record<keyof SystemSettings, string> = {
  agencyName: 'agency_name', agencyAddress: 'agency_address', gstin: 'gstin', supportPhone: 'support_phone', invoicePrefix: 'invoice_prefix', receiptPrefix: 'receipt_prefix',
  billingDueDays: 'billing_due_days', adminMaxDiscountPct: 'admin_max_discount_pct', defaultAgentMaxDiscountPct: 'default_agent_max_discount_pct',
  agentPriceMaxMarkupPct: 'agent_price_max_markup_pct', lowStockDefault: 'low_stock_default', overdueAfterDays: 'overdue_after_days',
}
const settings: Partial<typeof api.settings> = {
  async update(p) {
    await patch('/settings/update_settings/', Object.fromEntries(Object.entries(p).map(([k, v]) => [SETTINGS_MAP[k as keyof SystemSettings], v])), ['settings'])
  },
  async resetDemo() {
    const t = await http<Tokens>('/sync/reset-demo/', { method: 'POST' })
    await startSession(t)
  },
}

// ---------------------------------------------------------------- install
export function installRemote() {
  const overrides: [object, object][] = [
    [api.auth, auth], [api.products, products], [api.prices, prices], [api.agents, agents], [api.executives, executives], [api.customers, customers],
    [api.locations, locations], [api.subscriptions, subscriptions], [api.holidays, holidays], [api.routes, routes], [api.deliveries, deliveries],
    [api.stock, stock], [api.discounts, discounts], [api.billing, billing], [api.payments, payments], [api.remittances, remittances],
    [api.complaints, complaints], [api.notifications, notifications], [api.settings, settings],
  ]
  for (const [target, impl] of overrides) Object.assign(target, impl)

  if (getSession()) {
    // Cached copy opens instantly (works offline); refresh it in the background.
    useSync.setState({ status: getDB().seededOn ? 'ready' : 'loading' })
    void pull().catch(() => undefined)
  } else {
    replaceDB(emptyDB(), { cache: false })
    void loadPublic()
  }

  // Keep the copy fresh: on focus, when the network returns, and every minute while visible.
  const refresh = () => {
    const last = useSync.getState().lastPull ?? 0
    if (getSession() && navigator.onLine && document.visibilityState === 'visible' && Date.now() - last > 15_000) void pull().catch(() => undefined)
  }
  window.addEventListener('focus', refresh)
  window.addEventListener('online', refresh)
  setInterval(refresh, 60_000)
}
