import { create } from 'zustand'
import { buildSeed } from '@/data/seed'
import { DB_VERSION, type DB } from '@/domain/db'
import type { ID, Role } from '@/domain/types'
import { API_MODE } from './mode'

/**
 * Local dataset every screen reads from.
 * - mock mode: the demo server's own database, persisted to localStorage.
 * - http mode: the signed-in user's role-scoped copy synced from the Django API
 *   (services/remote.ts), cached on the device for offline field work and wiped on sign-out.
 */
const DB_KEY = API_MODE === 'http' ? 'nap.cache' : 'nap.db'
const SESSION_KEY = API_MODE === 'http' ? 'nap.session.api' : 'nap.session'

/** Empty dataset (http mode before sign-in / before the first sync). */
export function emptyDB(): DB {
  return {
    version: DB_VERSION,
    seededOn: '',
    settings: {
      agencyName: 'NewsRound',
      agencyAddress: '',
      gstin: '',
      supportPhone: '',
      invoicePrefix: 'INV',
      receiptPrefix: 'RCP',
      billingDueDays: 10,
      adminMaxDiscountPct: 50,
      defaultAgentMaxDiscountPct: 10,
      agentPriceMaxMarkupPct: 10,
      lowStockDefault: 3,
      overdueAfterDays: 10,
    },
    admins: [],
    agents: [],
    executives: [],
    customers: [],
    locations: [],
    products: [],
    prices: [],
    subscriptions: [],
    subscriptionEvents: [],
    holidays: [],
    routes: [],
    handovers: [],
    deliveries: {},
    stock: {},
    discounts: [],
    invoices: [],
    payments: [],
    remittances: [],
    complaints: [],
    notifications: [],
    logs: [],
    masters: [],
    accountRequests: [],
    licences: [],
    broadcasts: [],
    resellers: [],
    licencePlans: [],
    handlingCharges: [],
    userRolls: [],
    staffUsers: [],
    credentials: {},
    processedKeys: {},
    counters: {},
  }
}

/**
 * A saved dataset can be stamped with the current version yet predate a newly added collection
 * (the version bumps before the seed catches up during development). Fill whatever is missing
 * from the default data instead of crashing on `undefined.filter`; the user's own changes stay.
 */
function fillMissing(saved: DB): DB {
  const base = (API_MODE === 'http' ? emptyDB() : buildSeed()) as unknown as Record<string, unknown>
  const out = saved as unknown as Record<string, unknown>
  for (const k of Object.keys(base)) if (out[k] === undefined) out[k] = base[k]
  const counters = saved.counters as Record<string, number>
  for (const [k, v] of Object.entries(base.counters as Record<string, number>)) if (counters[k] === undefined) counters[k] = v
  return saved
}

function loadDB(): DB {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (parsed.version === DB_VERSION) return fillMissing(parsed)
    }
  } catch {
    /* corrupted / unavailable storage — reseed */
  }
  return API_MODE === 'http' ? emptyDB() : buildSeed()
}

let saveTimer: ReturnType<typeof setTimeout> | undefined
let dirty: DB | null = null
function flush() {
  clearTimeout(saveTimer)
  if (!dirty) return
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(dirty))
  } catch {
    /* quota exceeded — keep in memory */
  }
  dirty = null
}
function persist(db: DB) {
  dirty = db
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, 250)
}
// Never lose a pending write when the tab is closed, reloaded or backgrounded.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
}

export const useDB = create<{ db: DB }>(() => ({ db: loadDB() }))
if (API_MODE === 'mock') persist(useDB.getState().db)

/** Replace the local dataset (http mode sync). Cached only while someone is signed in. */
export function replaceDB(db: DB, { cache }: { cache: boolean }) {
  useDB.setState({ db })
  if (cache) persist(db)
  else {
    clearTimeout(saveTimer)
    dirty = null
    try {
      localStorage.removeItem(DB_KEY)
    } catch {
      /* ignore */
    }
  }
}

export const getDB = () => useDB.getState().db

/** Apply a mutation to a cloned DB and publish it. */
export function commit<T>(mutate: (db: DB) => T): T {
  const next = structuredClone(getDB())
  const result = mutate(next)
  useDB.setState({ db: next })
  persist(next)
  return result
}

export function resetDemoData() {
  const fresh = buildSeed()
  // Keep MPINs so testers don't have to re-onboard after a reset.
  fresh.credentials = getDB().credentials
  useDB.setState({ db: fresh })
  persist(fresh)
}

// ---------------- Session ----------------
export interface Session {
  role: Role
  userId: ID
  /** Set when an agency staff user (not the owner) signed in: the session then works as that agency, limited by the user's roll. */
  staffId?: ID
  token: string
  /** JWT refresh token (http mode). */
  refresh?: string
  issuedAt: string
  /** Set while the super administrator is signed in as an agency ("Root login"). */
  returnTo?: Omit<Session, 'returnTo'>
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

export const useSession = create<{ session: Session | null }>(() => ({ session: loadSession() }))
export const getSession = () => useSession.getState().session

export function setSession(s: Session | null) {
  useSession.setState({ session: s })
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
