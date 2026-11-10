/**
 * Service layer — the only place screens mutate data.
 *
 * Every function maps 1:1 to a Django REST endpoint (see backend/README.md).
 * The mock implementation enforces the same permissions, validation and business
 * rules as the backend, so swapping to HTTP is a transport change, not a logic change.
 */
import { TRUNC_LABEL, truncApply, truncCounts, type TruncKey } from '@/domain/truncate'
import { addDaysISO, monthEndISO, nowISO, todayISO } from '@/lib/dates'
import { isIndianMobile, round2, sleep, uid } from '@/lib/utils'
import { can, canSeeCustomer, findUser, type Action, type Actor } from '@/domain/access'
import { activeRoll, staffOf } from '@/domain/staff'
import { allocatePayment, customerOutstanding, draftInvoice, invoiceStatus } from '@/domain/billing'
import type { DB } from '@/domain/db'
import { descendantIds } from '@/domain/locations'
import { discountPctOf, resolvePrice, validateAgentOverride, validatePriceTriple } from '@/domain/pricing'
import { deliveryKey, deriveSubscriptionStatus, matchesFrequency, qtyOn } from '@/domain/schedule'
import type {
  Agent,
  AppNotification,
  Broadcast,
  Complaint,
  Customer,
  DeliveryRecord,
  Discount,
  Executive,
  Holiday,
  ID,
  ISODate,
  Invoice,
  Licence,
  LicencePlan,
  LocationNode,
  Master,
  NotificationKind,
  Payment,
  PaymentMethod,
  PriceVersion,
  Product,
  Reseller,
  RollAction,
  Role,
  Credential,
  Route,
  StockEntry,
  Subscription,
  SubscriptionEvent,
  SystemSettings,
} from '@/domain/types'
import { FREQUENCY_META, ONLINE_METHODS } from '@/domain/types'
import { API_MODE } from './mode'
import { commit, getDB, getSession, resetDemoData, setSession } from './store'

export class ApiError extends Error {
  code: string
  constructor(message: string, code = 'invalid') {
    super(message)
    this.code = code
  }
}

const latency = () => sleep(120 + Math.random() * 180)

function actor(): Actor {
  const s = getSession()
  if (!s) throw new ApiError('Your session has ended. Please sign in again.', 'unauthenticated')
  const db = getDB()
  // A staff user who was switched off, deleted or lost their roll mid-session is stopped at once.
  if (s.staffId && !activeRoll(db, s)) throw new ApiError('Your access has been changed by the agency. Please sign in again.', 'unauthenticated')
  return { role: s.role, userId: s.userId, ...(s.staffId ? { staffId: s.staffId } : {}) }
}

function guard(action: Action, verb?: RollAction): Actor {
  const a = actor()
  if (!can(getDB(), a, action, verb)) throw new ApiError(a.staffId ? 'Your user roll does not allow this action.' : 'You do not have permission for this action.', 'forbidden')
  return a
}

/** Settings that decide who can do what stay with the agency owner. */
function ownerOnly(a: Actor): Actor {
  if (a.staffId) throw new ApiError('Only the agency owner can do this.', 'forbidden')
  return a
}

function requireCustomer(a: Actor, customerId: ID) {
  if (!canSeeCustomer(getDB(), a, customerId)) throw new ApiError('This customer is not assigned to you.', 'forbidden')
}

function log(db: DB, a: Actor, action: string, entity: string, detail?: string, entityId?: ID) {
  // Staff work under the agency's id, so the back-log notes who really did it.
  const by = a.staffId ? `by ${staffOf(db, a)?.name ?? 'staff user'}` : ''
  db.logs.unshift({ id: uid('log'), at: nowISO(), actorId: a.userId, actorRole: a.role, action, entity, entityId, detail: [detail, by].filter(Boolean).join(' · ') || undefined })
  if (db.logs.length > 800) db.logs.length = 800
}

function notify(db: DB, to: string | string[], kind: NotificationKind, title: string, body: string, link?: string) {
  for (const t of Array.isArray(to) ? to : [to]) {
    db.notifications.unshift({ id: uid('ntf'), to: t, kind, title, body, at: nowISO(), read: false, link } satisfies AppNotification)
  }
}

const nextCode = (db: DB, counter: string, prefix: string, pad = 2) => `${prefix}${String(++db.counters[counter]!).padStart(pad, '0')}`

/** Idempotency guard: replays of the same key return the original result id. */
function once(db: DB, key: string | undefined, resultId: () => string): { duplicate: boolean; id: string } {
  if (key && db.processedKeys[key]) return { duplicate: true, id: db.processedKeys[key]! }
  const id = resultId()
  if (key) db.processedKeys[key] = id
  return { duplicate: false, id }
}

function req<T>(v: T | undefined | null, msg: string): T {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) throw new ApiError(msg)
  return v
}

// =====================================================================
// AUTH — OTP + MPIN (demo OTP service; backend: /api/auth/*)
// =====================================================================
interface OtpState {
  code: string
  expires: number
  sentAt: number
  sends: number[]
  failures: number
}
const otpStore = persistedMap<OtpState>('nap.otp')

/**
 * Pending OTP challenges live in sessionStorage (this tab only), so a reload — or the OS
 * killing the installed app while the user reads the SMS — doesn't break MPIN creation.
 * The real backend keeps this server-side in OtpChallenge.
 */
function persistedMap<V>(key: string) {
  let entries: [string, V][] = []
  try {
    entries = JSON.parse(sessionStorage.getItem(key) ?? '[]') as [string, V][]
  } catch {
    /* storage unavailable */
  }
  const m = new Map<string, V>(entries)
  const save = () => {
    try {
      sessionStorage.setItem(key, JSON.stringify([...m]))
    } catch {
      /* storage unavailable */
    }
  }
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: V) => {
      m.set(k, v)
      save()
    },
    delete: (k: string) => {
      m.delete(k)
      save()
    },
  }
}
const RESEND_COOLDOWN_MS = 20_000

async function sha256(text: string) {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  // Fallback for non-secure contexts (LAN testing over http).
  let h = 0
  for (const ch of text) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0
  return `weak:${h}`
}

export const auth = {
  async lookup(role: Role, mobile: string) {
    await latency()
    if (!isIndianMobile(mobile)) throw new ApiError('Enter a valid 10-digit Indian mobile number.')
    const db = getDB()
    const user = findUser(db, role, mobile)
    if (!user) {
      throw new ApiError(
        role === 'customer'
          ? 'No customer account found for this number. Tap "Create Account" to register.'
          : 'No account found for this number under the selected account type. Please check the account type.',
        'not_found',
      )
    }
    if (user.status !== 'active') throw new ApiError('This account is inactive. Please contact the agency.', 'inactive')
    if (role === 'agent' && db.licences.find((l) => l.agentId === user.id)?.locked) throw new ApiError('This agency account is locked. Please contact the super administrator.', 'locked')
    const cred = db.credentials[`${role}:${mobile}`]
    return { name: user.name, hasMpin: !!cred?.mpinHash }
  },

  /** Sends (simulated) OTP. Background throttling only — the user simply waits a short cooldown. */
  async requestOtp(role: Role, mobile: string) {
    await latency()
    const key = `${role}:${mobile}`
    const now = Date.now()
    const prev = otpStore.get(key)
    if (prev && now - prev.sentAt < RESEND_COOLDOWN_MS) {
      return { demoOtp: prev.code, cooldown: Math.ceil((RESEND_COOLDOWN_MS - (now - prev.sentAt)) / 1000), reused: true }
    }
    const sends = (prev?.sends ?? []).filter((t) => now - t < 3600_000)
    // Abuse protection: beyond 8 sends/hour, re-deliver the same code instead of minting new ones.
    const code = sends.length >= 8 && prev ? prev.code : String(Math.floor(100000 + Math.random() * 900000))
    otpStore.set(key, { code, expires: now + 5 * 60_000, sentAt: now, sends: [...sends, now], failures: 0 })
    return { demoOtp: code, cooldown: RESEND_COOLDOWN_MS / 1000, reused: false }
  },

  async verifyOtp(role: Role, mobile: string, otp: string) {
    const st = otpStore.get(`${role}:${mobile}`)
    // Silent progressive delay after repeated failures (no hard lockout shown to users).
    await sleep(latencyMs(st?.failures ?? 0))
    if (!st) throw new ApiError('Please request an OTP first.')
    if (Date.now() > st.expires) throw new ApiError('This OTP has expired. Tap "Resend OTP" to get a new one.', 'expired')
    if (st.code !== otp) {
      st.failures++
      otpStore.set(`${role}:${mobile}`, st)
      throw new ApiError('That OTP is not correct. Please check and try again.', 'mismatch')
    }
    otpStore.delete(`${role}:${mobile}`)
    const token = uid('otp')
    verifiedOtp.set(`${role}:${mobile}`, { token, until: Date.now() + 10 * 60_000 })
    return { otpToken: token }
  },

  async setMpin(role: Role, mobile: string, mpin: string, otpToken: string) {
    await latency()
    const v = verifiedOtp.get(`${role}:${mobile}`)
    if (!v || v.token !== otpToken || Date.now() > v.until) throw new ApiError('Verification expired. Please verify your OTP again.', 'expired')
    if (!/^\d{4}$/.test(mpin)) throw new ApiError('MPIN must be exactly 4 digits.')
    if (/^(\d)\1{3}$/.test(mpin) || ['1234', '4321', '0123'].includes(mpin)) throw new ApiError('Please choose a less predictable MPIN (avoid 1111 or 1234).')
    const db = getDB()
    const user = findUser(db, role, mobile)
    if (!user) throw new ApiError('Account not found.', 'not_found')
    const salt = uid('salt')
    const hash = await sha256(`${salt}:${mpin}`)
    verifiedOtp.delete(`${role}:${mobile}`)
    commit((d) => {
      d.credentials[`${role}:${mobile}`] = { key: `${role}:${mobile}`, role, userId: user.id, mpinHash: hash, salt, createdAt: nowISO() }
    })
    return startSession(role, user.id, mobile)
  },

  async loginWithMpin(role: Role, mobile: string, mpin: string) {
    const db = getDB()
    const cred = db.credentials[`${role}:${mobile}`]
    const k = `mpin:${role}:${mobile}`
    await sleep(latencyMs(mpinFailures.get(k) ?? 0))
    if (!cred?.mpinHash) throw new ApiError('MPIN not set yet. Please verify with OTP.', 'no_mpin')
    const hash = await sha256(`${cred.salt}:${mpin}`)
    if (hash !== cred.mpinHash) {
      mpinFailures.set(k, (mpinFailures.get(k) ?? 0) + 1)
      throw new ApiError('Incorrect MPIN. Try again or tap "Forgot MPIN".', 'mismatch')
    }
    mpinFailures.delete(k)
    return startSession(role, cred.userId, mobile)
  },

  /**
   * Username + password sign-in for people the agency created: delivery boys (open the delivery screens)
   * and staff users (open the agency panel, limited by their User Roll).
   * Usernames are only unique inside one agency, so the agency code or mobile number is asked too.
   * Every failure shows the same message, so nobody can probe which agencies or usernames exist.
   */
  async loginWithPassword(agency: string, username: string, password: string) {
    if (API_MODE === 'http') throw new ApiError('Username sign-in is not available on the live server yet. Use your mobile number.')
    const ag = agency.trim().toLowerCase()
    const user = username.trim().toLowerCase()
    const k = `pwd:${ag}:${user}`
    await sleep(latencyMs(mpinFailures.get(k) ?? 0))
    if (!ag || !user || !password) throw new ApiError('Enter the agency code, your username and your password.')
    const fail = () => {
      mpinFailures.set(k, (mpinFailures.get(k) ?? 0) + 1)
      return new ApiError('Agency code, username or password is not correct.', 'mismatch')
    }
    const db = getDB()
    const owner = db.agents.find((a) => a.code.toLowerCase() === ag || a.mobile === ag)
    if (!owner) throw fail()
    // A username shared by a delivery boy and a staff user signs in as the delivery boy.
    const boy = db.executives.find((e) => e.agentId === owner.id && e.username?.trim().toLowerCase() === user)
    const staff = boy ? undefined : db.staffUsers.find((u) => u.agentId === owner.id && u.name.trim().toLowerCase() === user)
    const who = boy ?? staff
    const cred = who ? db.credentials[`pwd:${who.id}`] : undefined
    if (!who || !cred?.mpinHash) throw fail()
    if ((await sha256(`${cred.salt}:${password}`)) !== cred.mpinHash) throw fail()
    // Correct password: now say exactly why a valid account cannot enter.
    if (owner.status !== 'active') throw new ApiError('This agency account is inactive. Please contact the super administrator.', 'inactive')
    if (db.licences.find((l) => l.agentId === owner.id)?.locked) throw new ApiError('This agency account is locked. Please contact the super administrator.', 'locked')
    if (who.status !== 'active') throw new ApiError('Your account is inactive. Please contact the agency.', 'inactive')
    if (staff && db.userRolls.find((r) => r.id === staff.rollId)?.status !== 'active') throw new ApiError('Your user roll is switched off. Please contact the agency.', 'inactive')
    mpinFailures.delete(k)
    commit((d) => {
      const c = d.credentials[`pwd:${who.id}`]
      if (c) c.lastLoginAt = nowISO()
      d.logs.unshift({ id: uid('log'), at: nowISO(), actorId: boy ? boy.id : owner.id, actorRole: boy ? 'executive' : 'agent', action: 'staff.login', entity: who.name, detail: staff ? `staff user of ${owner.agencyName}` : `delivery boy of ${owner.agencyName}` })
    })
    const s = { role: (boy ? 'executive' : 'agent') as Role, userId: boy ? boy.id : owner.id, ...(staff ? { staffId: staff.id } : {}), token: uid('jwt'), issuedAt: nowISO() }
    setSession(s)
    return { name: who.name, kind: boy ? ('delivery boy' as const) : ('staff user' as const), agencyName: owner.agencyName }
  },

  async registerCustomer(input: CustomerInput) {
    await latency()
    if (!isIndianMobile(input.mobile)) throw new ApiError('Enter a valid 10-digit Indian mobile number.')
    const db = getDB()
    if (db.customers.some((c) => c.mobile === input.mobile)) throw new ApiError('A customer account already exists for this mobile number. Please sign in.')
    const area = db.locations.find((l) => l.id === input.areaId && l.level === 'area')
    if (!area) throw new ApiError('Please select your area.')
    // Self-registered customers are routed to the agent who serves that area.
    const agent = db.agents.find((a) => a.status === 'active' && a.areaIds.includes(input.areaId)) ?? db.agents[0]!
    const route = db.routes.find((r) => r.status === 'active' && r.areaIds.includes(input.areaId)) ?? null
    const id = commit((d) => {
      const c: Customer = {
        ...normalizeCustomer(input),
        id: uid('cus'),
        code: `MT-C-${1000 + ++d.counters.customer!}`,
        agentId: agent.id,
        routeId: route?.id ?? null,
        status: 'active',
        registeredOn: todayISO(),
        selfRegistered: true,
      }
      d.customers.push(c)
      if (route) d.routes.find((r) => r.id === route.id)!.stops.push({ customerId: c.id })
      notify(d, ['role:admin', agent.id], 'registration', 'New customer registration', `${c.name} registered from ${area.name}.`, `/customers/${c.id}`)
      if (route?.executiveId) notify(d, route.executiveId, 'route', 'Customer added to your route', `${c.name}, ${c.houseName}`, '/routes')
      d.logs.unshift({ id: uid('log'), at: nowISO(), actorId: c.id, actorRole: 'customer', action: 'customer.register', entity: c.name, entityId: c.id })
      return c.id
    })
    return { customerId: id }
  },

  /** Change Password screen: the old MPIN is checked, then the new one replaces it. */
  async changeMpin(oldMpin: string, newMpin: string) {
    const s = actor()
    if (s.staffId) throw new ApiError('The MPIN belongs to the agency owner. Ask the owner to change it.', 'forbidden')
    if (API_MODE === 'http') throw new ApiError('Change your MPIN with an OTP from My Profile.')
    await latency()
    const db = getDB()
    const list: { id: ID; mobile: string }[] = s.role === 'admin' ? db.admins : s.role === 'agent' ? db.agents : s.role === 'executive' ? db.executives : db.customers
    const user = req(list.find((x) => x.id === s.userId), 'Account not found')
    const key = `${s.role}:${user.mobile}`
    const cred = db.credentials[key]
    if (!cred?.mpinHash) throw new ApiError('MPIN not set yet. Sign in with an OTP first.')
    if ((await sha256(`${cred.salt}:${oldMpin}`)) !== cred.mpinHash) throw new ApiError('The old MPIN is not correct.')
    if (!/^\d{4}$/.test(newMpin)) throw new ApiError('MPIN must be exactly 4 digits.')
    if (newMpin === oldMpin) throw new ApiError('Choose a new MPIN that differs from the old one.')
    if (/^(\d)\1{3}$/.test(newMpin) || ['1234', '4321', '0123'].includes(newMpin)) throw new ApiError('Please choose a less predictable MPIN (avoid 1111 or 1234).')
    const salt = uid('salt')
    const hash = await sha256(`${salt}:${newMpin}`)
    commit((d) => {
      d.credentials[key] = { ...d.credentials[key]!, mpinHash: hash, salt }
    })
  },

  /** My profile: the signed-in administrator, agent or delivery boy corrects their own name, mobile and email. */
  async updateProfile(patch: { name: string; mobile: string; email: string }) {
    const s = actor()
    if (s.role === 'customer') throw new ApiError('Use Edit my details to change a subscriber profile.', 'forbidden')
    if (s.staffId) throw new ApiError('Staff users cannot change the owner profile.', 'forbidden')
    if (API_MODE === 'http') throw new ApiError('Profile editing is not available on the live server yet.')
    await latency()
    const db = getDB()
    const name = patch.name.trim()
    const email = patch.email.trim()
    if (!name) throw new ApiError('Enter your name.')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Enter a valid email address.')
    assertUniqueMobile(db, s.role, patch.mobile, s.userId)
    commit((d) => {
      const list: { id: ID; name: string; mobile: string; email?: string }[] = s.role === 'admin' ? d.admins : s.role === 'agent' ? d.agents : d.executives
      const me = req(list.find((x) => x.id === s.userId), 'Account not found')
      if (s.role === 'executive' && d.executives.find((x) => x.id === me.id)?.altMobile === patch.mobile) throw new ApiError('The mobile number must differ from the alternate number.')
      const changed: string[] = []
      if (me.name !== name) changed.push('name')
      if ((me.email ?? '') !== email) changed.push('email')
      if (me.mobile !== patch.mobile) {
        changed.push('mobile')
        // Sign-in is keyed by mobile: carry the MPIN over to the new number.
        const old = d.credentials[`${s.role}:${me.mobile}`]
        if (old) {
          delete d.credentials[`${s.role}:${me.mobile}`]
          d.credentials[`${s.role}:${patch.mobile}`] = { ...old, key: `${s.role}:${patch.mobile}` }
        }
      }
      if (!changed.length) return
      Object.assign(me, { name, mobile: patch.mobile, email: email || (s.role === 'executive' ? undefined : '') })
      log(d, s, 'profile.update', name, `Changed ${changed.join(', ')}`, me.id)
    })
  },

  logout() {
    setSession(null)
  },
}

const verifiedOtp = persistedMap<{ token: string; until: number }>('nap.otpv')
const mpinFailures = new Map<string, number>()
const latencyMs = (failures: number) => 150 + (failures > 4 ? Math.min(4000, 400 * (failures - 4)) : 0)

function startSession(role: Role, userId: ID, mobile: string) {
  commit((d) => {
    const c = d.credentials[`${role}:${mobile}`]
    if (c) c.lastLoginAt = nowISO()
    const lic = role === 'agent' ? d.licences.find((l) => l.agentId === userId) : undefined
    if (lic && !lic.lastLoginAt) {
      // First time this agency signs in: tell the administrator.
      const ag = d.agents.find((x) => x.id === userId)
      if (ag) notify(d, 'role:admin', 'registration', 'New agency signed in', `${ag.agencyName} (${ag.name}) signed in for the first time.`, `/accounts/${ag.id}`)
    }
    if (lic) lic.lastLoginAt = nowISO()
  })
  const s = { role, userId, token: uid('jwt'), issuedAt: nowISO() }
  setSession(s)
  return s
}

// =====================================================================
// PRODUCTS & PRICING — /api/products, /api/prices
// =====================================================================
export type ProductInput = Omit<Product, 'id' | 'createdOn'>

/** An agency may only change titles it created itself; the super administrator only the shared ones. */
function ownProduct(a: Actor, p: Product) {
  if ((p.ownerId ?? null) !== (a.role === 'agent' ? a.userId : null)) throw new ApiError(a.role === 'agent' ? 'This title belongs to the main agency. Set your own rate in Product Wise Rate instead.' : 'This title belongs to an agency.', 'forbidden')
}

export interface BasicProductInput {
  name: string
  billCode?: string
  company?: string
  language?: string
  hsnCode?: string
  type: string
  subscriptionType: string
  haveIssues: boolean
  maxIssues?: number
  publishWeekdays: number[]
  publishDates: number[]
  startDate?: ISODate
  intervalDays?: number
  remark?: string
  status: Product['status']
}

/** Subscription Type master to the schedule engine's frequency. */
const BASIC_FREQUENCY: Record<string, Product['defaultFrequency']> = {
  Daily: 'daily',
  Weekly: 'weekly',
  Fortnight: 'fortnightly',
  Fortnightly: 'every_14_days',
  Monthly: 'monthly',
  Yearly: 'custom',
}
const BASIC_COLOURS = ['#1d4ed8', '#be123c', '#047857', '#b45309', '#6d28d9', '#0e7490', '#a21caf', '#4d7c0f']
function basicCategory(subscriptionType: string, language?: string): Product['category'] {
  if (subscriptionType === 'Daily') return language === 'Malayalam' ? 'Malayalam Newspapers' : language === 'English' ? 'English Newspapers' : 'Regional Newspapers'
  if (subscriptionType === 'Weekly') return 'Weekly Magazines'
  if (subscriptionType === 'Fortnight' || subscriptionType === 'Fortnightly') return 'Fortnightly Magazines'
  if (subscriptionType === 'Monthly') return 'Monthly Magazines'
  return 'Other Printed Publications'
}

export const products = {
  async create(input: ProductInput & { purchasePrice: number; agentPrice: number; customerPrice: number }) {
    const a = guard('product.write')
    await latency()
    const err = validatePriceTriple(input)
    if (err) throw new ApiError(err)
    const db = getDB()
    if (db.products.some((p) => p.code.toLowerCase() === input.code.trim().toLowerCase())) throw new ApiError('Product code already exists.')
    return commit((d) => {
      const { purchasePrice, agentPrice, customerPrice, ...rest } = input
      const p: Product = { ...rest, code: rest.code.trim().toUpperCase(), id: uid('prd'), createdOn: todayISO(), ...(a.role === 'agent' ? { ownerId: a.userId } : {}) }
      d.products.push(p)
      d.prices.push({ id: uid('prc'), productId: p.id, agentId: null, purchasePrice, agentPrice, customerPrice, effectiveFrom: todayISO(), createdBy: a.userId, createdAt: nowISO(), note: 'Initial price' })
      log(d, a, 'product.create', p.name, `₹${purchasePrice} / ₹${agentPrice} / ₹${customerPrice}`, p.id)
      notify(d, d.agents.map((x) => x.id), 'price', 'New product available', `${p.name} can now be added to subscriptions.`, '/products')
      return p
    })
  },

  async update(id: ID, patch: Partial<ProductInput>) {
    const a = guard('product.write')
    await latency()
    return commit((d) => {
      const p = req(d.products.find((x) => x.id === id), 'Product not found')
      ownProduct(a, p)
      if (patch.code && d.products.some((x) => x.id !== id && x.code.toLowerCase() === patch.code!.toLowerCase())) throw new ApiError('Product code already exists.')
      Object.assign(p, patch)
      log(d, a, 'product.update', p.name, Object.keys(patch).join(', '), id)
      return p
    })
  },

  /**
   * Manage Products form: a title without a price. Rates are set afterwards in Product Wise Rate,
   * so until then the title bills at nothing and is skipped by invoices.
   */
  async saveBasic(input: BasicProductInput & { id?: ID }) {
    const a = guard('product.write')
    await latency()
    req(input.name, 'Enter the product name.')
    req(input.type, 'Select the product type.')
    req(input.subscriptionType, 'Select the subscription type.')
    if (input.haveIssues && !(input.maxIssues && input.maxIssues >= 1 && input.maxIssues <= 5)) throw new ApiError('Choose the maximum number of issues (1 to 5).')
    if (input.subscriptionType === 'Weekly' && !input.publishWeekdays.length) throw new ApiError('Select the publication week days.')
    if ((input.subscriptionType === 'Fortnight' || input.subscriptionType === 'Monthly') && !input.publishDates.length) throw new ApiError('Select the publication dates.')
    return commit((d) => {
      const dup = d.products.find((p) => p.id !== input.id && p.name.trim().toLowerCase() === input.name.trim().toLowerCase() && (p.company ?? '') === (input.company ?? ''))
      if (dup) throw new ApiError('This product already exists for the company.')
      const billCode = input.billCode?.trim().toUpperCase() || undefined
      if (billCode && d.products.some((p) => p.id !== input.id && (p.billCode ?? p.code).toUpperCase() === billCode)) throw new ApiError('This bill code is already used by another product.')
      const freq = BASIC_FREQUENCY[input.subscriptionType] ?? 'monthly'
      const fields = {
        name: input.name.trim(),
        billCode,
        company: input.company || undefined,
        publisher: input.company || 'Independent',
        language: input.language || 'English',
        hsnCode: input.hsnCode?.trim() || undefined,
        type: input.type,
        subscriptionType: input.subscriptionType,
        defaultFrequency: freq,
        haveIssues: input.haveIssues,
        maxIssues: input.haveIssues ? input.maxIssues : undefined,
        publishWeekdays: input.subscriptionType === 'Weekly' ? input.publishWeekdays : [],
        publishDates: input.subscriptionType === 'Fortnight' || input.subscriptionType === 'Monthly' ? input.publishDates : [],
        startDate: input.subscriptionType === 'Fortnightly' ? input.startDate || undefined : undefined,
        intervalDays: input.subscriptionType === 'Fortnightly' ? input.intervalDays || 14 : undefined,
        remark: input.remark?.trim() || undefined,
        category: basicCategory(input.subscriptionType, input.language),
        status: input.status,
      }
      let p = input.id ? d.products.find((x) => x.id === input.id) : undefined
      if (p) ownProduct(a, p)
      if (p) Object.assign(p, fields)
      else {
        const code = billCode ?? `P${String(d.products.length + 1).padStart(3, '0')}`
        p = {
          ...fields,
          id: uid('prd'),
          code: d.products.some((x) => x.code.toUpperCase() === code) ? `${code}-${d.products.length + 1}` : code,
          description: '',
          availability: 'Available',
          color: BASIC_COLOURS[d.products.length % BASIC_COLOURS.length]!,
          lowStockThreshold: d.settings.lowStockDefault,
          createdOn: todayISO(),
          ...(a.role === 'agent' ? { ownerId: a.userId } : {}),
        }
        d.products.push(p)
      }
      log(d, a, input.id ? 'product.update' : 'product.create', p.name, `${p.subscriptionType} · ${p.company ?? 'no company'}`, p.id)
      return p
    })
  },

  /** Usage that blocks permanent deletion. */
  usage(id: ID) {
    const db = getDB()
    return {
      invoices: db.invoices.filter((i) => i.lines.some((l) => l.productId === id)).length,
      subscriptions: db.subscriptions.filter((s) => s.productId === id).length,
      deliveries: Object.values(db.deliveries).filter((r) => r.productId === id).length,
    }
  },

  /** Deletes if unused; otherwise archives to protect financial history. */
  async remove(id: ID): Promise<'deleted' | 'archived'> {
    const a = guard('product.write', 'delete')
    await latency()
    const u = products.usage(id)
    return commit((d) => {
      const p = req(d.products.find((x) => x.id === id), 'Product not found')
      ownProduct(a, p)
      if (u.invoices || u.subscriptions || u.deliveries) {
        p.status = 'archived'
        for (const s of d.subscriptions.filter((s) => s.productId === id && !s.cancelledOn)) {
          s.cancelledOn = todayISO()
          s.status = 'cancelled'
        }
        log(d, a, 'product.archive', p.name, 'Linked to history — archived instead of deleted', id)
        return 'archived'
      }
      d.products = d.products.filter((x) => x.id !== id)
      d.prices = d.prices.filter((x) => x.productId !== id)
      log(d, a, 'product.delete', p.name, undefined, id)
      return 'deleted'
    })
  },
}

export const prices = {
  async addVersion(input: Pick<PriceVersion, 'productId' | 'agentId' | 'purchasePrice' | 'agentPrice' | 'customerPrice' | 'effectiveFrom' | 'note' | 'monthlyRate' | 'dayRates' | 'issueRates' | 'specials'>) {
    const a = guard('price.write')
    await latency()
    const err = validatePriceTriple(input)
    if (err) throw new ApiError(err)
    const db = getDB()
    if (a.role === 'agent') {
      const owned = db.products.find((p) => p.id === input.productId)?.ownerId === a.userId
      if (!owned && input.agentId !== a.userId) throw new ApiError('You can set your own rate for a main-agency title, or any rate for your own titles.', 'forbidden')
      if (owned && input.agentId) throw new ApiError('Your own titles use one rate for every customer.')
    }
    if (input.effectiveFrom < todayISO()) throw new ApiError('Effective date cannot be in the past — past invoices keep their original prices.')
    if (input.agentId) {
      const base = resolvePrice(db, input.productId, input.effectiveFrom, null)
      if (!base) throw new ApiError('Set a base price before adding agent-specific pricing.')
      const e = validateAgentOverride(base, input.customerPrice, db.settings.agentPriceMaxMarkupPct)
      if (e) throw new ApiError(e)
      if (Math.abs(input.purchasePrice - base.purchasePrice) > 0.001) throw new ApiError('Agency purchase price is set at base level and cannot differ per agent.')
    }
    return commit((d) => {
      // Same-day same-scope revision replaces the pending future row instead of stacking duplicates.
      d.prices = d.prices.filter((p) => !(p.productId === input.productId && p.agentId === input.agentId && p.effectiveFrom === input.effectiveFrom && p.effectiveFrom > todayISO()))
      d.prices.push({ ...input, id: uid('prc'), createdBy: a.userId, createdAt: nowISO() })
      const prod = d.products.find((p) => p.id === input.productId)!
      log(d, a, 'price.create', prod.name, `${input.agentId ? 'Agent-specific' : 'Base'}: ₹${input.purchasePrice} / ₹${input.agentPrice} / ₹${input.customerPrice} from ${input.effectiveFrom}`, prod.id)
      const to = input.agentId ? [input.agentId] : d.agents.map((x) => x.id)
      notify(d, to, 'price', 'Product price change', `${prod.name}: customer price ₹${input.customerPrice} from ${input.effectiveFrom}.`, '/pricing')
    })
  },

  async removeFuture(id: ID) {
    const a = guard('price.write', 'delete')
    await latency()
    commit((d) => {
      const p = req(d.prices.find((x) => x.id === id), 'Price not found')
      if (a.role === 'agent' && p.agentId !== a.userId && d.products.find((x) => x.id === p.productId)?.ownerId !== a.userId) throw new ApiError('This rate is not yours.', 'forbidden')
      if (p.effectiveFrom <= todayISO()) throw new ApiError('Prices already in effect cannot be deleted — they are part of billing history.')
      d.prices = d.prices.filter((x) => x.id !== id)
      log(d, a, 'price.delete', d.products.find((x) => x.id === p.productId)?.name ?? '', `Removed scheduled price from ${p.effectiveFrom}`)
    })
  },
}

// =====================================================================
// PEOPLE — /api/agents, /api/executives, /api/customers
// =====================================================================
export type AgentInput = Omit<Agent, 'id' | 'code'>
export type ExecutiveInput = Omit<Executive, 'id' | 'code'> & { code?: string; password?: string }

/** Legacy username + password (delivery boy, staff user): the password is only ever kept salted and hashed. */
async function passwordCredential(role: Role, userId: ID, password: string): Promise<Credential> {
  const salt = uid('salt')
  return { key: `pwd:${userId}`, role, userId, mpinHash: await sha256(`${salt}:${password}`), salt, createdAt: nowISO() }
}
export type CustomerInput = Omit<Customer, 'id' | 'code' | 'agentId' | 'routeId' | 'status' | 'registeredOn'> & { agentId?: ID; routeId?: ID | null; code?: string; registeredOn?: ISODate }

/** Sign-in is keyed by mobile: when someone's number changes, their MPIN moves to the new number. */
function moveCredential(d: DB, role: Role, from: string, to: string) {
  if (from === to) return
  const old = d.credentials[`${role}:${from}`]
  if (!old) return
  delete d.credentials[`${role}:${from}`]
  d.credentials[`${role}:${to}`] = { ...old, key: `${role}:${to}` }
}

function assertUniqueMobile(db: DB, role: Role, mobile: string, selfId?: ID) {
  if (!isIndianMobile(mobile)) throw new ApiError('Enter a valid 10-digit Indian mobile number.')
  const list: { id: ID; mobile: string }[] = role === 'agent' ? db.agents : role === 'executive' ? db.executives : role === 'customer' ? db.customers : db.admins
  if (list.some((x) => x.mobile === mobile && x.id !== selfId)) throw new ApiError('This mobile number is already registered for another account of this type.')
}

function normalizeCustomer(input: CustomerInput) {
  const { agentId: _a, routeId: _r, ...rest } = input
  void _a
  void _r
  return { ...rest, name: rest.name.trim(), securityDeposit: Number(rest.securityDeposit) || 0, handlingCharge: Number(rest.handlingCharge) || 0 }
}

export const agents = {
  async create(input: AgentInput) {
    const a = guard('agent.write')
    await latency()
    assertUniqueMobile(getDB(), 'agent', input.mobile)
    return commit((d) => {
      const ag: Agent = { ...input, id: uid('agt'), code: nextCode(d, 'agent', 'AG-') }
      d.agents.push(ag)
      d.licences.push(newLicence(d, ag))
      log(d, a, 'agent.create', ag.name, ag.agencyName, ag.id)
      notify(d, 'role:admin', 'registration', 'New agent registered', `${ag.name} (${ag.agencyName}) added.`, `/agents/${ag.id}`)
      return ag
    })
  },
  async update(id: ID, patch: Partial<AgentInput>) {
    const a = guard('agent.write')
    await latency()
    if (patch.mobile) assertUniqueMobile(getDB(), 'agent', patch.mobile, id)
    return commit((d) => {
      const ag = req(d.agents.find((x) => x.id === id), 'Agent not found')
      if (patch.mobile) moveCredential(d, 'agent', ag.mobile, patch.mobile)
      Object.assign(ag, patch)
      log(d, a, patch.status ? `agent.${patch.status}` : 'agent.update', ag.name, undefined, id)
      return ag
    })
  },
}

function assertAltContact(mobile: string, alt?: string, relation?: string) {
  if (!alt || !relation) throw new ApiError('Add an alternate mobile number and its relation to the executive.')
  if (!/^[6-9]\d{9}$/.test(alt)) throw new ApiError('Enter a valid 10-digit alternate mobile number.')
  if (alt === mobile) throw new ApiError("The alternate number must differ from the executive's own mobile.")
}

export const executives = {
  usage(id: ID) {
    const db = getDB()
    return {
      routes: db.routes.filter((r) => r.executiveId === id).length,
      deliveries: Object.values(db.deliveries).filter((x) => x.executiveId === id).length,
      handovers: db.handovers.filter((h) => h.fromExecutiveId === id || h.toExecutiveId === id).length,
    }
  },
  async remove(id: ID) {
    const a = guard('executive.write', 'delete')
    await latency()
    commit((d) => {
      const ex = req(d.executives.find((x) => x.id === id), 'Delivery boy not found')
      if (a.role === 'agent' && ex.agentId !== a.userId) throw new ApiError('This delivery boy is not in your agency.', 'forbidden')
      const u = executives.usage(id)
      if (u.routes || u.deliveries || u.handovers) throw new ApiError('This delivery boy has routes or delivery history. Mark the account discontinued instead.')
      d.executives = d.executives.filter((x) => x.id !== id)
      for (const k of Object.keys(d.credentials)) if (d.credentials[k]!.userId === id) delete d.credentials[k]
      log(d, a, 'executive.delete', ex.name, ex.code, id)
    })
  },
  async create(input: ExecutiveInput) {
    const a = guard('executive.write')
    await latency()
    assertUniqueMobile(getDB(), 'executive', input.mobile)
    assertAltContact(input.mobile, input.altMobile, input.altMobileRelation)
    if (a.role === 'agent' && input.agentId !== a.userId) throw new ApiError('Agents can only add executives to their own agency.', 'forbidden')
    const { password, ...rest } = input
    if (input.username !== undefined) {
      req(input.username.trim(), 'Enter the username.')
      req(password && password.length >= 4, 'Enter a password of at least 4 characters.')
    }
    const id = uid('exe')
    const cred = password ? await passwordCredential('executive', id, password) : null
    return commit((d) => {
      if (input.code?.trim() && d.executives.some((x) => x.code.toLowerCase() === input.code!.trim().toLowerCase())) throw new ApiError('This delivery boy code is already used.')
      if (rest.username && d.executives.some((x) => x.agentId === rest.agentId && x.username?.toLowerCase() === rest.username!.trim().toLowerCase())) throw new ApiError('This username is already used in your agency.')
      const ex: Executive = { ...rest, username: rest.username?.trim(), id, code: input.code?.trim() || nextCode(d, 'executive', 'DE-') }
      if (cred) d.credentials[cred.key] = cred
      d.executives.push(ex)
      log(d, a, 'executive.create', ex.name, undefined, ex.id)
      return ex
    })
  },
  async update(id: ID, patch: Partial<ExecutiveInput>) {
    const a = guard('executive.write')
    await latency()
    if (patch.mobile) assertUniqueMobile(getDB(), 'executive', patch.mobile, id)
    const { password, ...rest } = patch
    if (rest.username !== undefined) req(rest.username.trim(), 'Enter the username.')
    if (password) req(password.length >= 4, 'The password needs at least 4 characters.')
    const cred = password ? await passwordCredential('executive', id, password) : null
    return commit((d) => {
      const ex = req(d.executives.find((x) => x.id === id), 'Executive not found')
      if (a.role === 'agent' && ex.agentId !== a.userId) throw new ApiError('This executive is not in your agency.', 'forbidden')
      if (rest.username && d.executives.some((x) => x.id !== id && x.agentId === ex.agentId && x.username?.toLowerCase() === rest.username!.trim().toLowerCase())) throw new ApiError('This username is already used in your agency.')
      if (cred) d.credentials[cred.key] = cred
      patch = rest
      if ('altMobile' in patch || 'altMobileRelation' in patch || patch.mobile) assertAltContact(patch.mobile ?? ex.mobile, patch.altMobile ?? ex.altMobile, patch.altMobileRelation ?? ex.altMobileRelation)
      if (patch.status === 'inactive' && d.routes.some((r) => r.executiveId === id)) throw new ApiError('Hand over this executive\'s routes before deactivating the account.')
      if (patch.mobile) moveCredential(d, 'executive', ex.mobile, patch.mobile)
      Object.assign(ex, patch)
      log(d, a, patch.status ? `executive.${patch.status}` : 'executive.update', ex.name, undefined, id)
      return ex
    })
  },
}

export const customers = {
  /** Customers with subscriptions, deliveries, bills or payments are deactivated, never deleted. */
  usage(id: ID) {
    const db = getDB()
    return {
      subscriptions: db.subscriptions.filter((x) => x.customerId === id).length,
      invoices: db.invoices.filter((x) => x.customerId === id).length,
      payments: db.payments.filter((x) => x.customerId === id).length,
      deliveries: Object.values(db.deliveries).filter((x) => x.customerId === id).length,
    }
  },
  async remove(id: ID) {
    const a = guard('customer.write', 'delete')
    requireCustomer(a, id)
    await latency()
    commit((d) => {
      const c = req(d.customers.find((x) => x.id === id), 'Customer not found')
      const u = customers.usage(id)
      if (u.subscriptions || u.invoices || u.payments || u.deliveries) throw new ApiError('This customer has subscriptions, deliveries or bills, so it cannot be deleted. Mark it inactive instead.')
      for (const r of d.routes) r.stops = r.stops.filter((x) => x.customerId !== id)
      d.customers = d.customers.filter((x) => x.id !== id)
      for (const k of Object.keys(d.credentials)) if (d.credentials[k]!.userId === id) delete d.credentials[k]
      log(d, a, 'customer.delete', c.name, c.code, id)
    })
  },
  async create(input: CustomerInput) {
    const a = guard('customer.write')
    await latency()
    const db = getDB()
    assertUniqueMobile(db, 'customer', input.mobile)
    const agentId = a.role === 'agent' ? a.userId : req(input.agentId, 'Select the assigned agent.')
    return commit((d) => {
      const c: Customer = {
        ...normalizeCustomer(input),
        id: uid('cus'),
        code: input.code?.trim() ? input.code.trim().toUpperCase() : `MT-C-${1000 + ++d.counters.customer!}`,
        agentId,
        routeId: input.routeId ?? null,
        status: 'active',
        registeredOn: input.registeredOn ?? todayISO(),
      }
      if (d.customers.some((x) => x.code.toLowerCase() === c.code.toLowerCase())) throw new ApiError('This customer code is already used.')
      d.customers.push(c)
      if (c.routeId) {
        const r = d.routes.find((x) => x.id === c.routeId)!
        r.stops.push({ customerId: c.id })
        if (r.executiveId) notify(d, r.executiveId, 'route', 'Customer added', `${c.name} added to ${r.name}.`, '/routes')
      }
      log(d, a, 'customer.create', c.name, c.code, c.id)
      notify(d, ['role:admin', agentId].filter((x) => x !== a.userId), 'registration', 'New customer registration', `${c.name} (${c.code}) registered.`, `/customers/${c.id}`)
      return c
    })
  },

  async update(id: ID, patch: Partial<CustomerInput & { status: Customer['status'] }>) {
    const a = actor()
    const db = getDB()
    const self = a.role === 'customer' && a.userId === id
    if (!self && !can(db, a, 'customer.write')) throw new ApiError('You do not have permission for this action.', 'forbidden')
    if (!self) requireCustomer(a, id)
    if (self && (patch.agentId || patch.routeId !== undefined || patch.status)) throw new ApiError('Only the agency can change assignment or status.', 'forbidden')
    await latency()
    if (patch.mobile) assertUniqueMobile(db, 'customer', patch.mobile, id)
    return commit((d) => {
      const c = req(d.customers.find((x) => x.id === id), 'Customer not found')
      const { routeId, ...rest } = patch
      if (rest.mobile) moveCredential(d, 'customer', c.mobile, rest.mobile)
      Object.assign(c, rest)
      if (routeId !== undefined && routeId !== c.routeId) moveCustomerToRoute(d, c, routeId)
      log(d, a, patch.status ? `customer.${patch.status}` : 'customer.update', c.name, undefined, id)
      return c
    })
  },
}

function moveCustomerToRoute(d: DB, c: Customer, routeId: ID | null) {
  for (const r of d.routes) r.stops = r.stops.filter((s) => s.customerId !== c.id)
  c.routeId = routeId
  if (routeId) {
    const r = req(d.routes.find((x) => x.id === routeId), 'Route not found')
    r.stops.push({ customerId: c.id })
    if (r.executiveId) notify(d, r.executiveId, 'route', 'Customer added', `${c.name} added to ${r.name}.`, '/routes')
  }
}

// =====================================================================
// LOCATIONS — /api/locations
// =====================================================================
export const locations = {
  async create(input: Omit<LocationNode, 'id' | 'createdBy'>) {
    const a = guard('location.write')
    await latency()
    const db = getDB()
    if (a.role === 'agent' && input.level !== 'area' && input.level !== 'locality') throw new ApiError('Agents can add localities and areas only.', 'forbidden')
    if (db.locations.some((l) => l.parentId === input.parentId && l.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new ApiError(`"${input.name}" already exists here.`)
    if (input.level === 'area' && !/^\d{6}$/.test(input.pincode ?? '')) throw new ApiError('Areas need a valid 6-digit pincode.')
    return commit((d) => {
      const n: LocationNode = { ...input, name: input.name.trim(), id: uid('loc'), createdBy: a.userId }
      d.locations.push(n)
      if (a.role === 'agent' && n.level === 'area') d.agents.find((x) => x.id === a.userId)!.areaIds.push(n.id)
      log(d, a, 'location.create', n.name, n.level, n.id)
      return n
    })
  },
  async update(id: ID, patch: Partial<Pick<LocationNode, 'name' | 'pincode' | 'lat' | 'lng'>>) {
    const a = guard('location.write')
    await latency()
    return commit((d) => {
      const n = req(d.locations.find((x) => x.id === id), 'Location not found')
      Object.assign(n, patch)
      log(d, a, 'location.update', n.name, undefined, id)
      return n
    })
  },
  usage(id: ID) {
    const db = getDB()
    const ids = descendantIds(db, id)
    return db.customers.filter((c) => ids.has(c.areaId)).length + db.routes.filter((r) => r.areaIds.some((x) => ids.has(x))).length
  },
  async remove(id: ID) {
    const a = guard('location.write', 'delete')
    await latency()
    if (locations.usage(id)) throw new ApiError('This location is used by customers or routes and cannot be deleted.')
    commit((d) => {
      const ids = descendantIds(d, id)
      const n = d.locations.find((x) => x.id === id)
      d.locations = d.locations.filter((l) => !ids.has(l.id))
      log(d, a, 'location.delete', n?.name ?? id)
    })
  },
}

// =====================================================================
// SUBSCRIPTIONS — /api/subscriptions (+ /pause /resume /cancel /renew /change)
// =====================================================================
export type SubscriptionInput = Pick<Subscription, 'customerId' | 'productId' | 'startDate' | 'endDate' | 'frequency' | 'weekdays' | 'monthDays' | 'customDates' | 'quantity' | 'notes'> & { dayQuantities?: number[] }

function validateSubscription(db: DB, s: SubscriptionInput) {
  const prod = db.products.find((p) => p.id === s.productId)
  if (!prod || prod.status !== 'active') throw new ApiError('Select an active product.')
  if (s.dayQuantities) {
    if (s.dayQuantities.length !== 7 || s.dayQuantities.some((q) => !Number.isInteger(q) || q < 0 || q > 50)) throw new ApiError('Each day quantity must be a whole number from 0 to 50.')
    if (!s.dayQuantities.some((q) => q > 0)) throw new ApiError('Choose at least one delivery day with a quantity.')
  } else if (!(s.quantity >= 1 && s.quantity <= 50)) throw new ApiError('Quantity must be between 1 and 50.')
  if (s.endDate && s.endDate < s.startDate) throw new ApiError('End date must be after the start date.')
  if (s.frequency === 'weekly' && s.weekdays.length !== 1) throw new ApiError('Weekly: choose exactly one delivery day.')
  if (s.frequency === 'twice_weekly' && s.weekdays.length !== 2) throw new ApiError('Twice Weekly: choose exactly two delivery days.')
  if (s.frequency === 'monthly' && s.monthDays.length !== 1) throw new ApiError('Monthly: choose one date of the month.')
  if (s.frequency === 'twice_monthly' && s.monthDays.length !== 2) throw new ApiError('Twice Monthly: choose two dates of the month.')
  if (s.frequency === 'custom' && !s.customDates.length) throw new ApiError('Custom schedule: pick at least one delivery date.')
  const dup = db.subscriptions.find(
    (x) => x.customerId === s.customerId && x.productId === s.productId && !x.cancelledOn && (x.endDate === null || x.endDate >= s.startDate) && deriveSubscriptionStatus(x) !== 'expired',
  )
  return { prod, dup }
}

function subEvent(d: DB, a: Actor, subscriptionId: ID, action: SubscriptionEvent['action'], detail: string) {
  d.subscriptionEvents.unshift({ id: uid('sev'), subscriptionId, at: nowISO(), by: a.userId, action, detail })
}

function subActor(customerId: ID) {
  const a = guard('subscription.write')
  requireCustomer(a, customerId)
  return a
}

function notifySubChange(d: DB, a: Actor, sub: Subscription, title: string, body: string) {
  const c = d.customers.find((x) => x.id === sub.customerId)!
  const route = d.routes.find((r) => r.id === c.routeId)
  const to = [c.agentId, c.id, route?.executiveId ?? ''].filter((x) => x && x !== a.userId)
  notify(d, to, 'subscription', title, `${c.name}: ${body}`, '/subscriptions')
}

export const subscriptions = {
  async create(input: SubscriptionInput) {
    const a = subActor(input.customerId)
    await latency()
    const db = getDB()
    const { prod, dup } = validateSubscription(db, input)
    if (dup) throw new ApiError(`${prod.name} is already subscribed for this customer. Edit the existing subscription instead.`)
    return commit((d) => {
      const s: Subscription = { ...input, id: uid('sub'), status: 'active', pauses: [], createdOn: todayISO() }
      s.status = deriveSubscriptionStatus(s)
      d.subscriptions.push(s)
      subEvent(d, a, s.id, 'created', `${prod.name} · ${input.frequency.replace('_', ' ')} · qty ${input.quantity}`)
      log(d, a, 'subscription.create', prod.name, d.customers.find((c) => c.id === s.customerId)?.name, s.id)
      notifySubChange(d, a, s, 'New subscription', `${prod.name} from ${input.startDate}.`)
      return s
    })
  },

  async update(id: ID, patch: Partial<SubscriptionInput>) {
    const cur = req(getDB().subscriptions.find((s) => s.id === id), 'Subscription not found')
    const a = subActor(cur.customerId)
    await latency()
    const merged = { ...cur, ...patch }
    validateSubscription(getDB(), merged)
    return commit((d) => {
      const s = d.subscriptions.find((x) => x.id === id)!
      // Past delivery records are untouched; the derived calendar re-flows from today.
      Object.assign(s, patch)
      s.status = deriveSubscriptionStatus(s)
      subEvent(d, a, id, 'edited', Object.keys(patch).join(', '))
      notifySubChange(d, a, s, 'Subscription changed', `${d.products.find((p) => p.id === s.productId)?.name} schedule updated.`)
      return s
    })
  },

  async pause(id: ID, from: ISODate, to: ISODate | null, reason?: string) {
    const cur = req(getDB().subscriptions.find((s) => s.id === id), 'Subscription not found')
    const a = subActor(cur.customerId)
    await latency()
    if (to && to < from) throw new ApiError('Resume date must be after pause start.')
    if (from < todayISO()) throw new ApiError('Pause cannot start in the past.')
    return commit((d) => {
      const s = d.subscriptions.find((x) => x.id === id)!
      if (s.pauses.some((p) => p.to === null || (p.to >= from && (to === null || p.from <= to)))) throw new ApiError('This period overlaps an existing pause.')
      s.pauses.push({ from, to, reason })
      s.status = deriveSubscriptionStatus(s)
      subEvent(d, a, id, 'paused', `${from} → ${to ?? 'until resumed'}${reason ? ` · ${reason}` : ''}`)
      notifySubChange(d, a, s, 'Subscription paused', `${d.products.find((p) => p.id === s.productId)?.name} paused from ${from}.`)
      return s
    })
  },

  async resume(id: ID, on: ISODate = todayISO()) {
    const cur = req(getDB().subscriptions.find((s) => s.id === id), 'Subscription not found')
    const a = subActor(cur.customerId)
    await latency()
    return commit((d) => {
      const s = d.subscriptions.find((x) => x.id === id)!
      const open = s.pauses.filter((p) => p.to === null || p.to >= on)
      if (!open.length) throw new ApiError('This subscription has no active or upcoming pause.')
      for (const p of open) {
        if (p.from >= on) s.pauses = s.pauses.filter((x) => x !== p)
        else p.to = addDaysISO(on, -1)
      }
      s.status = deriveSubscriptionStatus(s)
      subEvent(d, a, id, 'resumed', `Deliveries resume ${on}`)
      notifySubChange(d, a, s, 'Subscription resumed', `${d.products.find((p) => p.id === s.productId)?.name} resumes ${on}.`)
      return s
    })
  },

  async cancel(id: ID, effective: ISODate = todayISO(), reason?: string) {
    const cur = req(getDB().subscriptions.find((s) => s.id === id), 'Subscription not found')
    const a = subActor(cur.customerId)
    await latency()
    return commit((d) => {
      const s = d.subscriptions.find((x) => x.id === id)!
      if (s.cancelledOn) throw new ApiError('Already cancelled.')
      s.cancelledOn = effective
      s.status = deriveSubscriptionStatus(s)
      subEvent(d, a, id, 'cancelled', `Effective ${effective}${reason ? ` · ${reason}` : ''}`)
      notifySubChange(d, a, s, 'Subscription cancelled', `${d.products.find((p) => p.id === s.productId)?.name} stops from ${effective}.`)
      return s
    })
  },

  async renew(id: ID, newEnd: ISODate | null) {
    const cur = req(getDB().subscriptions.find((s) => s.id === id), 'Subscription not found')
    const a = subActor(cur.customerId)
    await latency()
    if (newEnd && newEnd <= todayISO()) throw new ApiError('Choose a renewal end date in the future.')
    return commit((d) => {
      const s = d.subscriptions.find((x) => x.id === id)!
      const was = s.endDate
      s.endDate = newEnd
      delete s.cancelledOn
      s.status = deriveSubscriptionStatus(s)
      subEvent(d, a, id, 'renewed', `${was ?? 'open'} → ${newEnd ?? 'no end date'}`)
      notifySubChange(d, a, s, 'Subscription renewed', `${d.products.find((p) => p.id === s.productId)?.name} renewed${newEnd ? ` till ${newEnd}` : ''}.`)
      return s
    })
  },

  /** Switch product: closes the old subscription and opens a new one, keeping history for both. */
  async change(id: ID, input: Omit<SubscriptionInput, 'customerId'>) {
    const cur = req(getDB().subscriptions.find((s) => s.id === id), 'Subscription not found')
    const a = subActor(cur.customerId)
    await latency()
    const next = { ...input, customerId: cur.customerId }
    const { prod, dup } = validateSubscription(getDB(), next)
    if (dup && dup.id !== id) throw new ApiError(`${prod.name} is already subscribed for this customer.`)
    return commit((d) => {
      const old = d.subscriptions.find((x) => x.id === id)!
      old.cancelledOn = input.startDate
      old.status = deriveSubscriptionStatus(old)
      const s: Subscription = { ...next, id: uid('sub'), status: 'active', pauses: [], createdOn: todayISO() }
      s.status = deriveSubscriptionStatus(s)
      d.subscriptions.push(s)
      const from = d.products.find((p) => p.id === old.productId)?.name
      subEvent(d, a, old.id, 'changed', `Replaced by ${prod.name} from ${input.startDate}`)
      subEvent(d, a, s.id, 'changed', `Switched from ${from}`)
      notifySubChange(d, a, s, 'Subscription changed', `${from} → ${prod.name} from ${input.startDate}.`)
      return s
    })
  },
}

// =====================================================================
// HOLIDAYS — /api/holidays
// =====================================================================
export const holidays = {
  async save(input: Omit<Holiday, 'id'> & { id?: ID }) {
    const a = guard('holiday.write')
    await latency()
    req(input.name, 'Holiday name is required.')
    return commit((d) => {
      let h = input.id ? d.holidays.find((x) => x.id === input.id) : undefined
      if (h) Object.assign(h, input)
      else {
        h = { ...input, id: uid('hol') }
        d.holidays.push(h)
      }
      log(d, a, input.id ? 'holiday.update' : 'holiday.create', h.name, `${h.date} · ${h.type}`, h.id)
      if (!h.deliveryApplicable && h.date >= todayISO()) {
        notify(d, [...d.agents.map((x) => x.id), ...d.executives.map((x) => x.id)], 'delivery', `${h.type}: ${h.name}`, `No delivery on ${h.date} in the affected areas. Bills are not reduced.`, '/calendar')
      }
      return h
    })
  },
  async remove(id: ID) {
    const a = guard('holiday.write')
    await latency()
    commit((d) => {
      const h = d.holidays.find((x) => x.id === id)
      d.holidays = d.holidays.filter((x) => x.id !== id)
      log(d, a, 'holiday.delete', h?.name ?? id)
    })
  },
}

// =====================================================================
// ROUTES — /api/routes (+ /reorder /handover)
// =====================================================================
export const routes = {
  async save(input: Pick<Route, 'name' | 'areaIds' | 'agentId' | 'executiveId' | 'instructions' | 'status'> & { id?: ID; code?: string }) {
    const a = guard('route.write')
    await latency()
    if (a.role === 'agent' && input.agentId !== a.userId) throw new ApiError('You can only manage your own routes.', 'forbidden')
    req(input.name, 'Route name is required.')
    if (!input.areaIds.length) throw new ApiError('Select at least one area for the route.')
    return commit((d) => {
      let r = input.id ? d.routes.find((x) => x.id === input.id) : undefined
      const prevExec = r?.executiveId ?? null
      if (r) Object.assign(r, input)
      else {
        r = { ...input, id: uid('rte'), code: input.code?.trim() ? input.code.trim().toUpperCase() : nextCode(d, 'route', 'RT-'), stops: [], createdOn: todayISO() }
        d.routes.push(r)
      }
      if (input.executiveId && input.executiveId !== prevExec) {
        d.handovers.unshift({ id: uid('hnd'), routeId: r.id, fromExecutiveId: prevExec, toExecutiveId: input.executiveId, at: nowISO(), by: a.userId, note: input.id ? 'Reassigned from route editor' : 'Initial assignment' })
        notify(d, input.executiveId, 'route', 'New route assignment', `You are assigned to ${r.name} (${r.code}).`, '/routes')
      }
      log(d, a, input.id ? 'route.update' : 'route.create', r.name, undefined, r.id)
      return r
    })
  },

  async remove(id: ID) {
    const a = guard('route.write', 'delete')
    await latency()
    commit((d) => {
      const r = req(d.routes.find((x) => x.id === id), 'Route not found')
      if (r.stops.length) throw new ApiError('Only routes without customers can be deleted. Move customers first.')
      if (Object.values(d.deliveries).some((x) => d.customers.find((c) => c.id === x.customerId)?.routeId === id)) throw new ApiError('Route has delivery history; deactivate instead.')
      d.routes = d.routes.filter((x) => x.id !== id)
      log(d, a, 'route.delete', r.name)
    })
  },

  async setStops(id: ID, stops: Route['stops']) {
    const a = guard('route.write')
    await latency()
    return commit((d) => {
      const r = req(d.routes.find((x) => x.id === id), 'Route not found')
      const added = stops.filter((s) => !r.stops.some((x) => x.customerId === s.customerId))
      for (const s of added) {
        const c = d.customers.find((x) => x.id === s.customerId)
        if (c) moveCustomerToRoute(d, c, null)
      }
      for (const s of r.stops) {
        if (!stops.some((x) => x.customerId === s.customerId)) {
          const c = d.customers.find((x) => x.id === s.customerId)
          if (c) c.routeId = null
        }
      }
      r.stops = stops
      for (const s of stops) {
        const c = d.customers.find((x) => x.id === s.customerId)
        if (c) c.routeId = id
      }
      log(d, a, 'route.sequence', r.name, `${stops.length} stops`, id)
      if (r.executiveId) notify(d, r.executiveId, 'route', 'Route changes', `${r.name}: delivery sequence updated.`, '/routes')
      return r
    })
  },

  /** Hand the route — customers, coordinates, instructions, schedules — to another executive. History stays with the original executive. */
  async handover(id: ID, toExecutiveId: ID, note?: string) {
    const a = guard('route.handover')
    await latency()
    return commit((d) => {
      const r = req(d.routes.find((x) => x.id === id), 'Route not found')
      if (a.role === 'agent' && r.agentId !== a.userId) throw new ApiError('Not your route.', 'forbidden')
      const to = req(d.executives.find((e) => e.id === toExecutiveId && e.status === 'active'), 'Select an active delivery executive.')
      if (r.executiveId === to.id) throw new ApiError(`${to.name} already handles this route.`)
      const from = r.executiveId
      r.executiveId = to.id
      if (!to.areaIds.length || r.areaIds.some((x) => !to.areaIds.includes(x))) to.areaIds = [...new Set([...to.areaIds, ...r.areaIds])]
      d.handovers.unshift({ id: uid('hnd'), routeId: id, fromExecutiveId: from, toExecutiveId: to.id, at: nowISO(), by: a.userId, note })
      notify(d, to.id, 'route', 'New route assignment', `${r.name}: ${r.stops.length} customers with addresses, map pins and instructions are now on your app.`, '/routes')
      if (from) notify(d, from, 'route', 'Route handed over', `${r.name} is now handled by ${to.name}.`, '/routes')
      log(d, a, 'route.handover', r.name, `${d.executives.find((e) => e.id === from)?.name ?? 'Unassigned'} → ${to.name}`, id)
      return r
    })
  },
}

// =====================================================================
// DELIVERIES — /api/deliveries (idempotent upsert by subscription+date)
// =====================================================================
export interface MarkInput {
  subscriptionId: ID
  date: ISODate
  status: 'delivered' | 'missed' | 'clear'
  reason?: string
  remarks?: string
  idempotencyKey?: string
  fromOffline?: boolean
}

export const deliveries = {
  async mark(input: MarkInput) {
    const a = guard('delivery.mark')
    await latency()
    return markNow(a, input)
  },
  async markMany(items: MarkInput[]) {
    const a = guard('delivery.mark')
    await latency()
    let n = 0
    for (const it of items) if (markNow(a, it) !== 'duplicate') n++
    return n
  },
}

function markNow(a: Actor, input: MarkInput): 'ok' | 'duplicate' {
  const db = getDB()
  if (input.idempotencyKey && db.processedKeys[input.idempotencyKey]) return 'duplicate'
  const sub = req(db.subscriptions.find((s) => s.id === input.subscriptionId), 'Subscription not found')
  requireCustomer(a, sub.customerId)
  if (!matchesFrequency(sub, input.date)) throw new ApiError('No delivery is scheduled for this date.')
  if (input.date > todayISO()) throw new ApiError('Future deliveries cannot be marked yet.')
  if (a.role === 'executive' && input.date < addDaysISO(todayISO(), -2)) throw new ApiError('Executives can update deliveries from the last 2 days only. Ask your agent for older corrections.', 'forbidden')
  if (input.status === 'missed' && !input.reason) throw new ApiError('Choose a reason for the missed delivery.')
  commit((d) => {
    const key = deliveryKey(sub.id, input.date)
    once(d, input.idempotencyKey, () => key)
    if (input.status === 'clear') {
      delete d.deliveries[key]
      return
    }
    const c = d.customers.find((x) => x.id === sub.customerId)!
    const route = d.routes.find((r) => r.id === c.routeId)
    const rec: DeliveryRecord = {
      key,
      subscriptionId: sub.id,
      customerId: sub.customerId,
      productId: sub.productId,
      date: input.date,
      status: input.status,
      quantity: qtyOn(sub, input.date),
      executiveId: a.role === 'executive' ? a.userId : route?.executiveId ?? null,
      actualAt: input.status === 'delivered' ? nowISO() : null,
      updatedBy: a.userId,
      updatedAt: nowISO(),
      reason: input.reason,
      remarks: input.remarks,
      syncedFromOffline: input.fromOffline,
    }
    d.deliveries[key] = rec // upsert — one record per subscription per day
    syncDistributed(d, c.agentId, sub.productId, input.date, a)
    if (input.status === 'missed') {
      const prod = d.products.find((p) => p.id === sub.productId)?.name
      notify(d, [c.agentId, c.id].filter((x) => x !== a.userId), 'delivery', 'Delivery missed', `${prod} for ${c.name} on ${input.date}: ${input.reason}.`, '/deliveries')
    }
  })
  return 'ok'
}

/** Keep the stock ledger's "distributed" in sync with delivered records (no double deduction). */
function syncDistributed(d: DB, agentId: ID, productId: ID, date: ISODate, a: Actor) {
  const key = `${date}|${productId}|${agentId}`
  const entry = d.stock[key]
  const agentCustomers = new Set(d.customers.filter((c) => c.agentId === agentId).map((c) => c.id))
  const distributed = Object.values(d.deliveries)
    .filter((r) => r.date === date && r.productId === productId && r.status === 'delivered' && agentCustomers.has(r.customerId))
    .reduce((s, r) => s + r.quantity, 0)
  if (entry) {
    entry.distributed = distributed
    entry.updatedAt = nowISO()
    entry.updatedBy = a.userId
  }
}

// =====================================================================
// STOCK — /api/stock (unique per date+product+agent)
// =====================================================================
export const stock = {
  async upsert(input: Pick<StockEntry, 'date' | 'productId' | 'agentId' | 'opening' | 'received' | 'returned' | 'damaged'> & { distributed?: number }) {
    const a = guard('stock.write')
    await latency()
    if (a.role === 'agent' && input.agentId !== a.userId) throw new ApiError('You can only update your own agency stock.', 'forbidden')
    for (const k of ['opening', 'received', 'returned', 'damaged'] as const) if (!(input[k] >= 0) || !Number.isInteger(input[k])) throw new ApiError('Quantities must be whole numbers ≥ 0.')
    return commit((d) => {
      const key = `${input.date}|${input.productId}|${input.agentId}`
      const prev = d.stock[key]
      const entry: StockEntry = {
        key,
        date: input.date,
        productId: input.productId,
        agentId: input.agentId,
        opening: input.opening,
        received: input.received,
        distributed: input.distributed ?? prev?.distributed ?? 0,
        returned: input.returned,
        damaged: input.damaged,
        reconciled: false,
        updatedBy: a.userId,
        updatedAt: nowISO(),
      }
      d.stock[key] = entry
      syncDistributed(d, input.agentId, input.productId, input.date, a)
      const prod = d.products.find((p) => p.id === input.productId)!
      const remaining = entry.opening + entry.received - d.stock[key]!.distributed + entry.returned - entry.damaged
      if (remaining < prod.lowStockThreshold) notify(d, ['role:admin', input.agentId].filter((x) => x !== a.userId), 'stock', `Low stock: ${prod.name}`, `Only ${remaining} copies left on ${input.date}.`, '/stock')
      log(d, a, prev ? 'stock.update' : 'stock.create', prod.name, `${input.date}`, key)
      return entry
    })
  },
  async reconcile(key: string) {
    const a = guard('stock.write')
    await latency()
    commit((d) => {
      const e = req(d.stock[key], 'Stock entry not found')
      if (a.role === 'agent' && e.agentId !== a.userId) throw new ApiError('Not your stock.', 'forbidden')
      e.reconciled = true
      e.updatedBy = a.userId
      e.updatedAt = nowISO()
      log(d, a, 'stock.reconcile', d.products.find((p) => p.id === e.productId)?.name ?? '', e.date, key)
    })
  },
}

// =====================================================================
// DISCOUNTS — /api/discounts
// =====================================================================
export const discounts = {
  async create(input: Omit<Discount, 'id' | 'approvedBy' | 'createdAt'>) {
    const a = guard('discount.write')
    requireCustomer(a, input.customerId)
    await latency()
    const db = getDB()
    if (!(input.value > 0)) throw new ApiError('Discount value must be greater than zero.')
    if (input.expiryDate && input.expiryDate < input.startDate) throw new ApiError('Expiry must be after start date.')
    req(input.reason, 'Please record a reason for the discount.')
    // Evaluate against a typical monthly bill for the scope to enforce % ceilings on fixed discounts too.
    const from = todayISO().slice(0, 8) + '01'
    const draft = draftInvoice(db, input.customerId, from, monthEndISO(from))
    const base = input.subscriptionId ? draft.lines.filter((l) => l.subscriptionId === input.subscriptionId).reduce((s, l) => s + l.amount, 0) : draft.subtotal
    const pct = discountPctOf(input, base)
    const limit = a.role === 'admin' ? db.settings.adminMaxDiscountPct : db.agents.find((x) => x.id === a.userId)?.maxDiscountPct ?? db.settings.defaultAgentMaxDiscountPct
    if (input.kind === 'percentage' && input.value > 100) throw new ApiError('Percentage cannot exceed 100%.')
    if (pct > limit + 1e-9) throw new ApiError(`This discount is ${pct.toFixed(1)}% of the bill — above your authorised limit of ${limit}%.`)
    return commit((d) => {
      const disc: Discount = { ...input, id: uid('dsc'), approvedBy: a.userId, createdAt: nowISO() }
      d.discounts.push(disc)
      log(d, a, 'discount.create', d.customers.find((c) => c.id === input.customerId)?.name ?? '', `${input.kind === 'percentage' ? `${input.value}%` : `₹${input.value}`} · ${input.reason}`, disc.id)
      return disc
    })
  },
  async revoke(id: ID) {
    const a = guard('discount.write', 'delete')
    await latency()
    commit((d) => {
      const disc = req(d.discounts.find((x) => x.id === id), 'Discount not found')
      requireCustomer(a, disc.customerId)
      disc.revoked = true
      if (!disc.expiryDate || disc.expiryDate > todayISO()) disc.expiryDate = addDaysISO(todayISO(), -1) < disc.startDate ? disc.startDate : addDaysISO(todayISO(), -1)
      log(d, a, 'discount.revoke', d.customers.find((c) => c.id === disc.customerId)?.name ?? '', undefined, id)
    })
  },
}

// =====================================================================
// BILLING — /api/invoices/generate, /api/invoices/:id/adjustments
// =====================================================================
/** Bill Serials: an agency with its own prefix and starting number gets its own sequence; others share the default one. */
function billNumber(d: DB, agentId: ID, periodStart: ISODate) {
  const agent = d.agents.find((x) => x.id === agentId)
  if (agent?.billPrefix) {
    const key = `bill:${agentId}`
    d.counters[key] = d.counters[key] ?? (agent.billStart ?? 1) - 1
    return `${agent.billPrefix}${String(++d.counters[key]!).padStart(4, '0')}`
  }
  return `${d.settings.invoicePrefix}-${periodStart.slice(0, 7).replace('-', '')}-${String(++d.counters.invoice!).padStart(4, '0')}`
}

export const billing = {
  preview(customerId: ID, from: ISODate, to: ISODate) {
    return draftInvoice(getDB(), customerId, from, to)
  },

  async generate(periodStart: ISODate, customerIds?: ID[]) {
    const a = guard('invoice.generate')
    await latency()
    const periodEnd = monthEndISO(periodStart)
    if (periodStart > todayISO()) throw new ApiError('You cannot bill a month that has not started.')
    return commit((d) => {
      const scope = d.customers.filter((c) => (a.role === 'admin' || c.agentId === a.userId) && !c.skipBill && (!customerIds || customerIds.includes(c.id)))
      let created = 0
      let skipped = 0
      const createdIds: ID[] = []
      for (const c of scope) {
        if (d.invoices.some((i) => i.customerId === c.id && i.periodStart === periodStart)) {
          skipped++
          continue
        }
        const draft = draftInvoice(d, c.id, periodStart, periodEnd)
        if (!draft.lines.length) continue
        const inv: Invoice = {
          id: uid('inv'),
          number: billNumber(d, c.agentId, periodStart),
          customerId: c.id,
          agentId: c.agentId,
          periodStart,
          periodEnd,
          issuedOn: todayISO(),
          dueDate: addDaysISO(todayISO(), d.settings.billingDueDays),
          lines: draft.lines,
          subtotal: draft.subtotal,
          discount: draft.discount,
          handlingCharge: draft.handlingCharge,
          adjustments: [],
          currentBill: draft.currentBill,
          previousBalance: draft.previousBalance,
          paid: 0,
          status: invoiceStatus(draft.currentBill, 0),
        }
        d.invoices.push(inv)
        createdIds.push(inv.id)
        created++
        notify(d, c.id, 'invoice', 'New invoice', `${inv.number}: ₹${inv.currentBill} for ${periodStart.slice(0, 7)}. Total payable ₹${round2(inv.currentBill + inv.previousBalance)}.`, '/invoices')
      }
      log(d, a, 'invoice.generate', periodStart.slice(0, 7), `${created} created, ${skipped} already billed`)
      return { created, skipped, ids: createdIds }
    })
  },

  /** Approved manual adjustment (e.g. concession for a long strike). Line items are never edited. */
  async adjust(invoiceId: ID, label: string, amount: number) {
    const a = guard('invoice.adjust')
    await latency()
    req(label, 'Describe the adjustment.')
    if (!amount) throw new ApiError('Enter a non-zero amount.')
    return commit((d) => {
      const inv = req(d.invoices.find((i) => i.id === invoiceId), 'Invoice not found')
      if (inv.currentBill + amount < inv.paid) throw new ApiError('Adjustment would make the bill lower than the amount already paid.')
      inv.adjustments.push({ id: uid('adj'), label, amount: round2(amount), approvedBy: a.userId, at: nowISO() })
      inv.currentBill = round2(inv.currentBill + amount)
      inv.status = invoiceStatus(inv.currentBill, inv.paid)
      log(d, a, 'invoice.adjust', inv.number, `${label}: ₹${amount}`, inv.id)
      notify(d, inv.customerId, 'invoice', 'Bill adjusted', `${inv.number}: ${label} (₹${amount}).`, '/invoices')
      return inv
    })
  },
}

// =====================================================================
// PAYMENTS — /api/payments (idempotent), /api/payments/simulate
// =====================================================================
export interface PaymentInput {
  customerId: ID
  amount: number
  method: PaymentMethod
  idempotencyKey: string
  note?: string
  fromOffline?: boolean
}

export const payments = {
  /** Records an offline (cash/agent/executive) collection. */
  async collect(input: PaymentInput) {
    const a = guard('payment.collect')
    if (ONLINE_METHODS.includes(input.method)) throw new ApiError('Online payments are completed by the customer through the payment gateway.')
    requireCustomer(a, input.customerId)
    await latency()
    return recordPayment(a, input, undefined)
  },

  /**
   * DEMO GATEWAY. No money moves. The result is clearly flagged `simulated: true`
   * and the reference is prefixed SIM- so it can never be mistaken for a real transaction.
   */
  async payOnline(input: PaymentInput & { outcome?: 'success' | 'failure' }) {
    const a = guard('payment.online')
    if (!ONLINE_METHODS.includes(input.method)) throw new ApiError('Choose UPI, Debit Card or Credit Card.')
    requireCustomer(a, input.customerId)
    await sleep(900)
    if (input.outcome === 'failure') throw new ApiError('The demo gateway declined this payment. No amount was debited.', 'gateway_declined')
    const ref = `SIM-${input.method === 'UPI' ? 'UPI' : 'CARD'}-${Math.floor(1e7 + Math.random() * 9e7)}`
    return recordPayment(a, input, ref)
  },

  async verify(paymentId: ID) {
    const a = guard('payment.collect')
    await latency()
    commit((d) => {
      const p = req(d.payments.find((x) => x.id === paymentId), 'Payment not found')
      p.verified = true
      log(d, a, 'payment.verify', p.receiptNo, undefined, p.id)
    })
  },
}

function recordPayment(a: Actor, input: PaymentInput, gatewayRef: string | undefined) {
  const amount = round2(Number(input.amount))
  if (!(amount > 0)) throw new ApiError('Enter an amount greater than zero.')
  return commit((d) => {
    if (d.processedKeys[input.idempotencyKey]) {
      // Double tap / offline replay — return the original receipt, never charge twice.
      return { payment: d.payments.find((p) => p.id === d.processedKeys[input.idempotencyKey])!, duplicate: true }
    }
    const c = req(d.customers.find((x) => x.id === input.customerId), 'Customer not found')
    const allocations = allocatePayment(d, c.id, amount)
    for (const al of allocations) {
      const inv = d.invoices.find((i) => i.id === al.invoiceId)!
      inv.paid = round2(inv.paid + al.amount)
      inv.status = invoiceStatus(inv.currentBill, inv.paid)
    }
    const online = !!gatewayRef
    const p: Payment = {
      id: uid('pay'),
      receiptNo: `${d.settings.receiptPrefix}-${String(++d.counters.receipt!).padStart(5, '0')}`,
      customerId: c.id,
      agentId: c.agentId,
      amount,
      method: input.method,
      date: todayISO(),
      at: nowISO(),
      collectedBy: a.userId,
      allocations,
      gatewayRef,
      simulated: online,
      verified: online || a.role !== 'executive', // executive cash needs agent verification
      idempotencyKey: input.idempotencyKey,
      note: input.note,
    }
    d.payments.push(p)
    d.processedKeys[input.idempotencyKey] = p.id
    const left = customerOutstanding(d, c.id)
    notify(d, c.id, 'payment_success', 'Payment received', `₹${amount} received via ${input.method}. Receipt ${p.receiptNo}. Balance ₹${left}.`, '/payments')
    if (a.userId !== c.agentId) notify(d, c.agentId, 'payment_success', 'Collection recorded', `${c.name} paid ₹${amount} (${input.method}).`, '/collections')
    log(d, a, 'payment.record', c.name, `₹${amount} · ${input.method}${online ? ' · simulated gateway' : ''}${input.fromOffline ? ' · synced from offline' : ''}`, p.id)
    return { payment: p, duplicate: false }
  })
}

export const remittances = {
  async create(input: { agentId: ID; amount: number; date: ISODate; reference: string }) {
    const a = guard('remittance.write')
    await latency()
    if (!(input.amount > 0)) throw new ApiError('Enter an amount greater than zero.')
    req(input.reference, 'Enter the transfer reference.')
    commit((d) => {
      d.remittances.push({ ...input, id: uid('rem'), recordedBy: a.userId })
      log(d, a, 'remittance.create', d.agents.find((x) => x.id === input.agentId)?.name ?? '', `₹${input.amount} · ${input.reference}`)
      notify(d, input.agentId, 'payment_success', 'Remittance recorded', `₹${input.amount} received by agency (${input.reference}).`, '/settlements')
    })
  },
}

// =====================================================================
// COMPLAINTS & NOTIFICATIONS
// =====================================================================
export const complaints = {
  async create(input: Pick<Complaint, 'customerId' | 'category' | 'message'>) {
    const a = guard('complaint.create')
    requireCustomer(a, input.customerId)
    await latency()
    req(input.message, 'Please describe the issue.')
    return commit((d) => {
      const c: Complaint = { ...input, id: uid('cmp'), number: `CMP-${String(++d.counters.complaint!).padStart(4, '0')}`, status: 'open', createdAt: nowISO(), updates: [] }
      d.complaints.unshift(c)
      const cust = d.customers.find((x) => x.id === input.customerId)!
      notify(d, ['role:admin', cust.agentId], 'complaint', `New complaint ${c.number}`, `${cust.name}: ${input.category}.`, '/complaints')
      log(d, a, 'complaint.create', c.number, input.category, c.id)
      return c
    })
  },
  async respond(id: ID, note: string, status: Complaint['status']) {
    const a = guard('complaint.respond')
    await latency()
    req(note, 'Add a short note for the customer.')
    commit((d) => {
      const c = req(d.complaints.find((x) => x.id === id), 'Complaint not found')
      requireCustomer(a, c.customerId)
      c.status = status
      c.updates.push({ at: nowISO(), by: a.userId, note, status })
      notify(d, c.customerId, 'complaint', `Complaint ${c.number} ${status.replace('_', ' ')}`, note, '/complaints')
      log(d, a, 'complaint.update', c.number, status, id)
    })
  },
}

export const notifications = {
  async markRead(ids: ID[]) {
    commit((d) => {
      for (const n of d.notifications) if (ids.includes(n.id)) n.read = true
    })
  },
}

export const settings = {
  async update(patch: Partial<SystemSettings>) {
    const a = guard('settings.write')
    await latency()
    commit((d) => {
      Object.assign(d.settings, patch)
      log(d, a, 'settings.update', 'System settings', Object.keys(patch).join(', '))
    })
  },
  async resetDemo() {
    guard('settings.write')
    await latency()
    resetDemoData()
  },
}

// =====================================================================
// LICENCE CONSOLE (Super Administrator) — /api/masters, /api/account-requests,
// /api/licences, /api/broadcasts, /api/resellers, /api/licence-plans
// =====================================================================
function newLicence(d: DB, agent: Agent, over: Partial<Licence> = {}): Licence {
  const n = ++d.counters.licence!
  const t = todayISO()
  return {
    agentId: agent.id,
    accountNo: `${String(n).padStart(3, '0')}-${t.slice(5, 7)}${t.slice(2, 4)}/D`,
    planId: d.licencePlans.find((p) => p.primary)?.id ?? null,
    registeredOn: t,
    verifiedOn: t,
    licenceEnd: addDaysISO(t, 365),
    userLimit: 3,
    locked: false,
    ...over,
  }
}

const norm = (s: string) => s.trim().toLowerCase()

export const masters = {
  /** How many records still point at this entry — non-zero blocks deletion (the lock icon). */
  usage(m: Pick<Master, 'kind' | 'name' | 'ownerId'>): number {
    const db = getDB()
    const n = norm(m.name)
    switch (m.kind) {
      case 'language':
        return db.products.filter((p) => norm(p.language) === n).length
      case 'company':
        return db.products.filter((p) => (p.ownerId ?? null) === (m.ownerId ?? null) && norm(p.company ?? '') === n).length
      case 'product_type':
        return db.products.filter((p) => norm(p.type) === n).length
      case 'subscription_type':
        return db.products.filter((p) => (p.ownerId ?? null) === (m.ownerId ?? null) && norm(p.subscriptionType ?? FREQUENCY_META[p.defaultFrequency]?.label ?? '') === n).length
      case 'payment_mode':
        return m.ownerId ? 0 : db.payments.filter((p) => norm(p.method) === n).length
      case 'area':
        return 0
    }
  },

  async save(input: Omit<Master, 'id'> & { id?: ID }) {
    const a = guard('master.write')
    await latency()
    req(input.name, 'Enter a name.')
    const owner = a.role === 'agent' ? a.userId : undefined
    if (owner && !['subscription_type', 'company', 'payment_mode'].includes(input.kind)) throw new ApiError('Only the main agency manages this master.', 'forbidden')
    return commit((d) => {
      if (d.masters.some((x) => x.kind === input.kind && x.id !== input.id && x.ownerId === owner && norm(x.name) === norm(input.name))) throw new ApiError(`"${input.name.trim()}" already exists.`)
      let m = input.id ? d.masters.find((x) => x.id === input.id) : undefined
      if (m && m.ownerId !== owner) throw new ApiError('This entry belongs to the main agency and cannot be changed here.', 'forbidden')
      if (m) {
        const was = m.name
        Object.assign(m, input, { name: input.name.trim() })
        // Keep products pointing at the renamed entry.
        if (norm(was) !== norm(m.name)) {
          for (const p of d.products) {
            if (m.kind === 'language' && norm(p.language) === norm(was)) p.language = m.name
            if (m.kind === 'company' && norm(p.company ?? '') === norm(was)) p.company = m.name
            if (m.kind === 'product_type' && norm(p.type) === norm(was)) p.type = m.name
          }
        }
      } else {
        m = { ...input, ownerId: owner, name: input.name.trim(), id: uid('mst') }
        d.masters.push(m)
      }
      log(d, a, input.id ? 'master.update' : 'master.create', m.name, m.kind.replace('_', ' '), m.id)
      return m
    })
  },

  async remove(id: ID) {
    const a = guard('master.write', 'delete')
    await latency()
    commit((d) => {
      const m = req(d.masters.find((x) => x.id === id), 'Entry not found')
      if (m.ownerId !== (a.role === 'agent' ? a.userId : undefined)) throw new ApiError('This entry belongs to the main agency and cannot be deleted here.', 'forbidden')
      const used = masters.usage(m)
      if (used) throw new ApiError(`"${m.name}" is used by ${used} record${used > 1 ? 's' : ''}. Mark it inactive instead of deleting.`)
      d.masters = d.masters.filter((x) => x.id !== id)
      log(d, a, 'master.delete', m.name, m.kind.replace('_', ' '), id)
    })
  },
}

export const accountRequests = {
  /**
   * Public sign-up of a new distribution agency. There is no manual approval: the account and its
   * licence are opened at once (the primary plan, one year, three users), the agency signs in with
   * its mobile number and an OTP, and the administrator is only told, with a link to the profile.
   */
  async submit(input: { agencyName: string; ownerName: string; mobile: string; email: string; location: string }) {
    await latency()
    if (API_MODE === 'http') throw new ApiError('Agency registration is not available on the live server yet. Please contact NewsRound support.')
    const agencyName = input.agencyName.trim()
    const ownerName = input.ownerName.trim()
    if (agencyName.length < 3) throw new ApiError('Enter the agency name.')
    if (ownerName.length < 3) throw new ApiError('Enter the owner name.')
    if (!isIndianMobile(input.mobile)) throw new ApiError('Enter a valid 10-digit Indian mobile number.')
    return commit((d) => {
      if (d.agents.some((x) => x.mobile === input.mobile)) throw new ApiError('An agency account already exists for this mobile number. Please sign in.')
      // "India / State / District / City": give the agency the areas of its city (else its district, else every
      // area), so it can start at once. An area sits under locality > city > district > state.
      const [, , district = '', city = ''] = input.location.split('/').map((x) => x.trim().toLowerCase())
      const areas = d.locations.filter((l) => l.level === 'area')
      const within = (n: LocationNode, level: string, name: string) => {
        for (let p = n.parentId ? d.locations.find((x) => x.id === n.parentId) : undefined; p; p = p.parentId ? d.locations.find((x) => x.id === p!.parentId) : undefined) if (p.level === level && p.name.toLowerCase() === name) return true
        return false
      }
      const inCity = city ? areas.filter((l) => within(l, 'city', city)) : []
      const inDistrict = district ? areas.filter((l) => within(l, 'district', district)) : []
      const chosen = inCity.length ? inCity : inDistrict.length ? inDistrict : areas
      const ag: Agent = {
        id: uid('agt'),
        code: nextCode(d, 'agent', 'AG-'),
        name: ownerName,
        mobile: input.mobile,
        email: input.email.trim(),
        agencyName,
        areaIds: chosen.map((l) => l.id),
        maxDiscountPct: d.settings.defaultAgentMaxDiscountPct,
        canManageRoutes: true,
        joiningDate: todayISO(),
        status: 'active',
      }
      d.agents.push(ag)
      const lic = newLicence(d, ag)
      d.licences.push(lic)
      d.logs.unshift({ id: uid('log'), at: nowISO(), actorId: ag.id, actorRole: 'agent', action: 'licence.register', entity: agencyName, detail: `Self-registered · ${lic.accountNo} · ${input.location}`, entityId: ag.id })
      notify(d, 'role:admin', 'registration', 'New agency registered', `${agencyName} (${ownerName}) registered and can sign in now.`, `/accounts/${ag.id}`)
      return { accountNo: lic.accountNo }
    })
  },
}

export const licences = {
  /** Add agency: the super administrator opens an account directly, without a public registration. */
  async create(input: { agencyName: string; ownerName: string; mobile: string; email: string; areaIds: ID[]; planId: ID | null; licenceEnd: ISODate; userLimit: number }) {
    const a = guard('licence.manage')
    await latency()
    const agencyName = input.agencyName.trim()
    const ownerName = input.ownerName.trim()
    const email = input.email.trim()
    if (agencyName.length < 3) throw new ApiError('Enter the agency name.')
    if (ownerName.length < 3) throw new ApiError('Enter the owner name.')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Enter a valid email address.')
    if (!input.areaIds.length) throw new ApiError('Assign at least one service area.')
    if (input.licenceEnd <= todayISO()) throw new ApiError('Licence end date must be in the future.')
    if (!(input.userLimit >= 1)) throw new ApiError('Allow at least one user.')
    return commit((d) => {
      assertUniqueMobile(d, 'agent', input.mobile)
      const ag: Agent = {
        id: uid('agt'),
        code: nextCode(d, 'agent', 'AG-'),
        name: ownerName,
        mobile: input.mobile,
        email,
        agencyName,
        areaIds: input.areaIds,
        maxDiscountPct: d.settings.defaultAgentMaxDiscountPct,
        canManageRoutes: true,
        joiningDate: todayISO(),
        status: 'active',
      }
      d.agents.push(ag)
      const lic = newLicence(d, ag, { planId: input.planId, licenceEnd: input.licenceEnd, userLimit: input.userLimit })
      d.licences.push(lic)
      log(d, a, 'licence.create', agencyName, `Added by the administrator · ${lic.accountNo} · valid till ${input.licenceEnd}`, ag.id)
      notify(d, 'role:admin', 'registration', 'Agency added', `${agencyName} is now an active account (${ag.code}).`, '/accounts')
      return { ...ag, accountNo: lic.accountNo }
    })
  },
  async setLocked(agentId: ID, locked: boolean) {
    const a = guard('licence.manage')
    await latency()
    commit((d) => {
      const l = req(d.licences.find((x) => x.agentId === agentId), 'Licence not found')
      l.locked = locked
      log(d, a, locked ? 'licence.lock' : 'licence.unlock', d.agents.find((x) => x.id === agentId)?.agencyName ?? '', locked ? 'Sign-in blocked' : 'Sign-in restored', agentId)
    })
  },

  async update(agentId: ID, patch: Partial<Pick<Licence, 'planId' | 'licenceEnd' | 'userLimit'>>) {
    const a = guard('licence.manage')
    await latency()
    if (patch.userLimit !== undefined && !(patch.userLimit >= 1)) throw new ApiError('Allow at least one user.')
    commit((d) => {
      const l = req(d.licences.find((x) => x.agentId === agentId), 'Licence not found')
      const ag = d.agents.find((x) => x.id === agentId)!
      Object.assign(l, patch)
      if (patch.licenceEnd) {
        l.renewalRequested = false
        notify(d, agentId, 'renewal', 'Licence renewed', `Your licence is valid till ${patch.licenceEnd}.`, '/')
      }
      log(d, a, patch.licenceEnd ? 'licence.renew' : 'licence.update', ag.agencyName, patch.licenceEnd ? `Valid till ${patch.licenceEnd}` : Object.keys(patch).join(', '), agentId)
    })
  },

  /** Account Details (Truncate panel): the super administrator corrects an agency's registration details. */
  async updateAccount(agentId: ID, patch: { agencyName: string; email: string; mobile: string; registeredOn: string; verifiedOn: string; licenceEnd: string; userLimit: number }) {
    const a = guard('licence.manage')
    await latency()
    const db = getDB()
    const name = patch.agencyName.trim()
    const email = patch.email.trim()
    if (!name) throw new ApiError('Enter the company name.')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('Enter a valid email address.')
    assertUniqueMobile(db, 'agent', patch.mobile, agentId)
    if (!patch.registeredOn || !patch.verifiedOn || !patch.licenceEnd) throw new ApiError('Fill in all three dates.')
    if (patch.verifiedOn < patch.registeredOn) throw new ApiError('The verified date cannot be before the registration date.')
    if (patch.licenceEnd < patch.verifiedOn) throw new ApiError('The extending date cannot be before the verified date.')
    const users = 1 + db.executives.filter((e) => e.agentId === agentId).length
    if (!(patch.userLimit >= users)) throw new ApiError(`This agency already has ${users} users. Allow at least ${users}.`)
    commit((d) => {
      const ag = req(d.agents.find((x) => x.id === agentId), 'Account not found')
      const l = req(d.licences.find((x) => x.agentId === agentId), 'Licence not found')
      const changed: string[] = []
      if (ag.agencyName !== name) changed.push('company name')
      if (ag.email !== email) changed.push('email')
      if (ag.mobile !== patch.mobile) {
        changed.push('mobile')
        // Sign-in is keyed by mobile: move the agency's MPIN to the new number.
        const old = d.credentials[`agent:${ag.mobile}`]
        if (old) {
          delete d.credentials[`agent:${ag.mobile}`]
          d.credentials[`agent:${patch.mobile}`] = { ...old, key: `agent:${patch.mobile}` }
        }
      }
      if (l.registeredOn !== patch.registeredOn) changed.push('registration date')
      if (l.verifiedOn !== patch.verifiedOn) changed.push('verified date')
      if (l.licenceEnd !== patch.licenceEnd) changed.push('extending date')
      if (l.userLimit !== patch.userLimit) changed.push('addon users')
      if (!changed.length) return
      Object.assign(ag, { agencyName: name, email, mobile: patch.mobile })
      const extended = patch.licenceEnd !== l.licenceEnd
      Object.assign(l, { registeredOn: patch.registeredOn, verifiedOn: patch.verifiedOn, licenceEnd: patch.licenceEnd, userLimit: patch.userLimit })
      if (extended) {
        l.renewalRequested = false
        notify(d, agentId, 'renewal', 'Licence updated', `Your licence is valid till ${patch.licenceEnd}.`, '/')
      }
      log(d, a, 'licence.update', ag.agencyName, `Changed ${changed.join(', ')}`, agentId)
    })
  },

  /** Agencies with customers, executives or billing history are locked, never deleted. */
  linked(agentId: ID) {
    const db = getDB()
    return {
      customers: db.customers.filter((c) => c.agentId === agentId).length,
      executives: db.executives.filter((e) => e.agentId === agentId).length,
      routes: db.routes.filter((r) => r.agentId === agentId).length,
      invoices: db.invoices.filter((i) => i.agentId === agentId).length,
    }
  },

  async remove(agentId: ID) {
    const a = guard('licence.manage')
    await latency()
    commit((d) => {
      const ag = req(d.agents.find((x) => x.id === agentId), 'Account not found')
      const u = licences.linked(agentId)
      if (u.customers || u.executives || u.routes || u.invoices) throw new ApiError('This agency has customers or billing history and cannot be deleted. Lock the account instead.')
      d.agents = d.agents.filter((x) => x.id !== agentId)
      d.licences = d.licences.filter((x) => x.agentId !== agentId)
      log(d, a, 'licence.delete', ag.agencyName, undefined, agentId)
    })
  },

  /** Truncate: clears the chosen tables of one agency (see domain/truncate.ts for the rules). Billing history is never touched. */
  async truncate(agentId: ID, tables: TruncKey[]) {
    const a = guard('licence.manage')
    await latency()
    if (!tables.length) throw new ApiError('Pick at least one table.')
    commit((d) => {
      const ag = req(d.agents.find((x) => x.id === agentId), 'Account not found')
      const counts = truncCounts(d, agentId)
      let cleared: Set<TruncKey>
      try {
        cleared = truncApply(d, agentId, tables)
      } catch (e) {
        throw new ApiError(e instanceof Error ? e.message : String(e))
      }
      const detail = [...cleared].filter((k) => counts[k]).map((k) => `${TRUNC_LABEL[k]} ${counts[k]}`).join(', ')
      log(d, a, 'licence.truncate', ag.agencyName, detail || 'Nothing to clear', agentId)
    })
  },

  /** "Root login": the super administrator opens an agency account. The return path is kept in the session. */
  async rootLogin(agentId: ID) {
    const a = guard('licence.manage')
    if (API_MODE === 'http') throw new ApiError('Root login is available in demo mode only.')
    await latency()
    const s = req(getSession(), 'Your session has ended.')
    const ag = req(getDB().agents.find((x) => x.id === agentId), 'Account not found')
    commit((d) => log(d, a, 'licence.root_login', ag.agencyName, 'Signed in as the agency', agentId))
    const { returnTo: _ignored, ...origin } = s
    void _ignored
    setSession({ role: 'agent', userId: agentId, token: uid('jwt'), issuedAt: nowISO(), returnTo: origin })
  },
  returnFromRoot() {
    const s = getSession()
    if (s?.returnTo) setSession({ ...s.returnTo, token: uid('jwt'), issuedAt: nowISO() })
  },
}

export const broadcasts = {
  async save(input: Pick<Broadcast, 'accountIds' | 'startDate' | 'expiryDate' | 'message' | 'kind'> & { id?: ID }) {
    const a = guard('licence.manage')
    await latency()
    if (!input.accountIds.length) throw new ApiError('Select at least one account.')
    req(input.message, 'Write the message to send.')
    if (input.expiryDate < input.startDate) throw new ApiError('Expiry date must be on or after the start date.')
    return commit((d) => {
      let b = input.id ? d.broadcasts.find((x) => x.id === input.id) : undefined
      if (b) Object.assign(b, input)
      else {
        b = { ...input, id: uid('bcs'), createdAt: nowISO(), createdBy: a.userId }
        d.broadcasts.unshift(b)
        notify(d, input.accountIds, 'system', input.kind === 'alert' ? 'Alert from head office' : 'Notice from head office', input.message)
      }
      log(d, a, input.id ? 'broadcast.update' : 'broadcast.send', `${input.accountIds.length} account${input.accountIds.length > 1 ? 's' : ''}`, input.message.slice(0, 80), b.id)
      return b
    })
  },
  async remove(id: ID) {
    const a = guard('licence.manage')
    await latency()
    commit((d) => {
      d.broadcasts = d.broadcasts.filter((x) => x.id !== id)
      log(d, a, 'broadcast.delete', 'Notice removed', undefined, id)
    })
  },
}

export const resellers = {
  async save(input: Omit<Reseller, 'id' | 'accountNo'> & { id?: ID }) {
    const a = guard('licence.manage')
    await latency()
    req(input.name, 'Enter the reseller name.')
    if (!isIndianMobile(input.mobile)) throw new ApiError('Enter a valid 10-digit Indian mobile number.')
    if (input.email && !/^\S+@\S+\.\S+$/.test(input.email)) throw new ApiError('Enter a valid email address.')
    return commit((d) => {
      if (d.resellers.some((x) => x.mobile === input.mobile && x.id !== input.id)) throw new ApiError('A reseller with this mobile number already exists.')
      let r = input.id ? d.resellers.find((x) => x.id === input.id) : undefined
      if (r) Object.assign(r, input, { name: input.name.trim() })
      else {
        r = { ...input, name: input.name.trim(), id: uid('rsl'), accountNo: `RS-${String(++d.counters.reseller!).padStart(3, '0')}` }
        d.resellers.push(r)
      }
      log(d, a, input.id ? 'reseller.update' : 'reseller.create', r.name, r.accountNo, r.id)
      return r
    })
  },
  async remove(id: ID) {
    const a = guard('licence.manage')
    await latency()
    commit((d) => {
      const r = req(d.resellers.find((x) => x.id === id), 'Reseller not found')
      d.resellers = d.resellers.filter((x) => x.id !== id)
      log(d, a, 'reseller.delete', r.name, r.accountNo, id)
    })
  },
}

export type PlanInput = Pick<LicencePlan, 'name' | 'rate' | 'gstPct' | 'renewalAmount' | 'logo' | 'primary'>

export const licencePlans = {
  usage: (id: ID) => getDB().licences.filter((l) => l.planId === id).length,

  async save(input: PlanInput & { id?: ID }) {
    const a = guard('licence.manage')
    await latency()
    req(input.name, 'Enter the version type.')
    if (!(input.rate > 0)) throw new ApiError('Enter a rate greater than zero.')
    if (!(input.gstPct >= 0 && input.gstPct <= 100)) throw new ApiError('GST must be between 0 and 100%.')
    if (!(input.renewalAmount >= 0)) throw new ApiError('Renewal amount cannot be negative.')
    return commit((d) => {
      const withGst = (x: number) => round2(x * (1 + input.gstPct / 100))
      const calc = { netAmount: withGst(input.rate), totalRenewal: withGst(input.renewalAmount) }
      let p = input.id ? d.licencePlans.find((x) => x.id === input.id) : undefined
      const first = !d.licencePlans.length
      if (p) Object.assign(p, input, calc, { name: input.name.trim() })
      else {
        p = { ...input, ...calc, name: input.name.trim(), id: uid('lpl') }
        d.licencePlans.push(p)
      }
      if (first) p.primary = true
      if (p.primary) for (const o of d.licencePlans) if (o.id !== p.id) o.primary = false
      log(d, a, input.id ? 'plan.update' : 'plan.create', p.name, `₹${p.rate} + ${p.gstPct}% GST`, p.id)
      return p
    })
  },

  async remove(id: ID) {
    const a = guard('licence.manage')
    await latency()
    commit((d) => {
      const p = req(d.licencePlans.find((x) => x.id === id), 'Plan not found')
      if (licencePlans.usage(id)) throw new ApiError('This plan is assigned to agency accounts and cannot be deleted.')
      if (p.primary && d.licencePlans.length > 1) throw new ApiError('Make another plan primary before deleting this one.')
      d.licencePlans = d.licencePlans.filter((x) => x.id !== id)
      log(d, a, 'plan.delete', p.name, undefined, id)
    })
  },
}


// =====================================================================
// AGENCY BACK OFFICE (Settings menu of the agent login)
// =====================================================================
function agencyId(a: Actor): ID {
  if (a.role !== 'agent') throw new ApiError('Open an agency account first.', 'forbidden')
  return a.userId
}

export const agency = {
  /** Profile: account information and the details printed on bills. */
  async saveProfile(patch: { agencyName: string; email: string; profile: NonNullable<Agent['profile']> }) {
    const a = guard('agency.settings')
    const id = agencyId(a)
    await latency()
    req(patch.agencyName, 'Enter the agency name.')
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(patch.email)) throw new ApiError('Enter a valid email address.')
    if (patch.profile.pincode && !/^\d{6}$/.test(patch.profile.pincode)) throw new ApiError('Pincode must be 6 digits.')
    if (patch.profile.gstNo && !/^[0-9A-Z]{15}$/i.test(patch.profile.gstNo)) throw new ApiError('GST number must be 15 characters.')
    if (patch.profile.panNo && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(patch.profile.panNo)) throw new ApiError('PAN must look like ABCDE1234F.')
    commit((d) => {
      const ag = req(d.agents.find((x) => x.id === id), 'Account not found')
      ag.agencyName = patch.agencyName.trim()
      ag.email = patch.email
      ag.profile = { ...ag.profile, ...patch.profile }
      log(d, a, 'agency.update', ag.agencyName, 'Profile saved', id)
    })
  },

  /** Subscription Details: ask the main agency to renew the licence. */
  async requestRenewal() {
    const a = ownerOnly(guard('agency.settings'))
    const id = agencyId(a)
    await latency()
    commit((d) => {
      const l = req(d.licences.find((x) => x.agentId === id), 'Licence not found')
      l.renewalRequested = true
      notify(d, 'role:admin', 'renewal', 'Licence renewal requested', `${d.agents.find((x) => x.id === id)?.agencyName} asked to renew its licence.`, '/accounts')
      log(d, a, 'licence.renewal_request', d.agents.find((x) => x.id === id)?.agencyName ?? '', undefined, id)
    })
  },

  /** Bill Serials and Rate Setting. */
  async saveSettings(patch: { billPrefix?: string; billStart?: number; subAgentBilling?: boolean }) {
    const a = guard('agency.settings')
    const id = agencyId(a)
    await latency()
    if (patch.billPrefix !== undefined && !patch.billPrefix.trim()) throw new ApiError('Enter the bill prefix.')
    if (patch.billStart !== undefined && !(Number.isInteger(patch.billStart) && patch.billStart >= 1)) throw new ApiError('The starting bill number must be a whole number from 1.')
    commit((d) => {
      const ag = req(d.agents.find((x) => x.id === id), 'Account not found')
      const startChanged = patch.billStart !== undefined && patch.billStart !== ag.billStart
      Object.assign(ag, { ...patch, billPrefix: patch.billPrefix?.trim().toUpperCase() ?? ag.billPrefix })
      // A new starting number restarts the sequence only while no bill used the old one.
      if (startChanged && !d.invoices.some((i) => i.agentId === id)) delete d.counters[`bill:${id}`]
      log(d, a, 'agency.update', ag.agencyName, Object.keys(patch).join(', '), id)
    })
  },
}

export const handlingCharges = {
  async save(input: { id?: ID; month: string; amount: number }) {
    const a = guard('agency.settings')
    const id = agencyId(a)
    await latency()
    if (!/^\d{4}-\d{2}$/.test(input.month)) throw new ApiError('Choose the month and year.')
    if (!(input.amount >= 0)) throw new ApiError('Enter the handling charge amount.')
    return commit((d) => {
      if (d.handlingCharges.some((h) => h.agentId === id && h.month === input.month && h.id !== input.id)) throw new ApiError('A handling charge is already set for this month. Edit that row instead.')
      let h = input.id ? d.handlingCharges.find((x) => x.id === input.id && x.agentId === id) : undefined
      if (h) Object.assign(h, { month: input.month, amount: input.amount })
      else {
        h = { id: uid('hch'), agentId: id, month: input.month, amount: input.amount }
        d.handlingCharges.push(h)
      }
      log(d, a, input.id ? 'handling.update' : 'handling.create', input.month, `₹${input.amount}`, h.id)
      return h
    })
  },
  async remove(hid: ID) {
    const a = guard('agency.settings', 'delete')
    const id = agencyId(a)
    await latency()
    commit((d) => {
      const h = req(d.handlingCharges.find((x) => x.id === hid && x.agentId === id), 'Entry not found')
      if (d.invoices.some((i) => i.agentId === id && i.periodStart.slice(0, 7) === h.month)) throw new ApiError('Bills were already generated for this month, so its handling charge cannot be deleted.')
      d.handlingCharges = d.handlingCharges.filter((x) => x.id !== hid)
      log(d, a, 'handling.delete', h.month, undefined, hid)
    })
  },
}

export const userRolls = {
  async save(input: { id?: ID; name: string; description: string; status: 'active' | 'inactive'; perms: Record<string, ('view' | 'add' | 'edit' | 'delete')[]> }) {
    const a = ownerOnly(guard('agency.settings'))
    const id = agencyId(a)
    await latency()
    req(input.name, 'Enter the user type.')
    return commit((d) => {
      if (d.userRolls.some((r) => r.agentId === id && r.id !== input.id && norm(r.name) === norm(input.name))) throw new ApiError('A user roll with this name already exists.')
      let r = input.id ? d.userRolls.find((x) => x.id === input.id && x.agentId === id) : undefined
      const clean = Object.fromEntries(Object.entries(input.perms).filter(([, v]) => v.length))
      if (r) Object.assign(r, { name: input.name.trim().toUpperCase(), description: input.description, status: input.status, perms: clean })
      else {
        r = { id: uid('rol'), agentId: id, name: input.name.trim().toUpperCase(), description: input.description, status: input.status, perms: clean }
        d.userRolls.push(r)
      }
      log(d, a, input.id ? 'roll.update' : 'roll.create', r.name, `${Object.keys(clean).length} pages`, r.id)
      return r
    })
  },
  async remove(rid: ID) {
    const a = ownerOnly(guard('agency.settings'))
    const id = agencyId(a)
    await latency()
    commit((d) => {
      const r = req(d.userRolls.find((x) => x.id === rid && x.agentId === id), 'User roll not found')
      if (d.staffUsers.some((u) => u.rollId === rid)) throw new ApiError('Users are assigned to this roll, so it cannot be deleted. Deactivate it instead.')
      d.userRolls = d.userRolls.filter((x) => x.id !== rid)
      log(d, a, 'roll.delete', r.name, undefined, rid)
    })
  },
}

export const staffUsers = {
  async save(input: { id?: ID; rollId: ID; name: string; extension?: string; password?: string; description: string; status: 'active' | 'inactive' }) {
    const a = ownerOnly(guard('agency.settings'))
    const id = agencyId(a)
    await latency()
    req(input.name.trim(), 'Enter the user name.')
    if (!input.id) req(input.password && input.password.length >= 4, 'Enter a password of at least 4 characters.')
    else if (input.password) req(input.password.length >= 4, 'The password needs at least 4 characters.')
    const { password, ...rest } = input
    const uidNew = input.id ?? uid('stf')
    const cred = password ? await passwordCredential('agent', uidNew, password) : null
    return commit((d) => {
      req(d.userRolls.find((r) => r.id === rest.rollId && r.agentId === id), 'Select the user roll.')
      if (d.staffUsers.some((u) => u.agentId === id && u.name.toLowerCase() === rest.name.trim().toLowerCase() && u.id !== rest.id)) throw new ApiError('This user name is already used.')
      let u = rest.id ? d.staffUsers.find((x) => x.id === rest.id && x.agentId === id) : undefined
      if (u) Object.assign(u, rest, { name: rest.name.trim() })
      else {
        u = { ...rest, id: uidNew, agentId: id, name: rest.name.trim() }
        d.staffUsers.push(u)
      }
      if (cred) d.credentials[cred.key] = cred
      log(d, a, input.id ? 'user.update' : 'user.create', u.name, undefined, u.id)
      return u
    })
  },
  async remove(uidv: ID) {
    const a = ownerOnly(guard('agency.settings'))
    const id = agencyId(a)
    await latency()
    commit((d) => {
      const u = req(d.staffUsers.find((x) => x.id === uidv && x.agentId === id), 'User not found')
      d.staffUsers = d.staffUsers.filter((x) => x.id !== uidv)
      log(d, a, 'user.delete', u.name, undefined, uidv)
    })
  },
}
