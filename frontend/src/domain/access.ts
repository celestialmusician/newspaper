import type { DB } from './db'
import { staffAllows } from './staff'
import type { Agent, Customer, Executive, ID, RollAction, Role, Route } from './types'

/**
 * Role-based access control. The same rules are enforced in the service layer
 * (mutations) and used by screens to scope lists — and mirrored in backend/accounts/permissions.py.
 */

export type Action =
  | 'product.write'
  | 'price.write'
  | 'agent.write'
  | 'executive.write'
  | 'customer.write'
  | 'customer.status'
  | 'subscription.write'
  | 'holiday.write'
  | 'location.write'
  | 'route.write'
  | 'route.handover'
  | 'delivery.mark'
  | 'stock.write'
  | 'discount.write'
  | 'invoice.generate'
  | 'invoice.adjust'
  | 'payment.collect'
  | 'payment.online'
  | 'remittance.write'
  | 'settings.write'
  | 'licence.manage'
  | 'agency.settings'
  | 'master.write'
  | 'logs.view'
  | 'complaint.create'
  | 'complaint.respond'
  | 'reports.view'

const MATRIX: Record<Role, Action[] | '*'> = {
  admin: '*',
  agent: [
    'customer.write',
    'customer.status',
    'subscription.write',
    'location.write',
    'route.write',
    'route.handover',
    'executive.write',
    'delivery.mark',
    'stock.write',
    'discount.write',
    'invoice.generate',
    'payment.collect',
    'complaint.respond',
    'reports.view',
    'product.write',
    'price.write',
    'master.write',
    'agency.settings',
  ],
  executive: ['delivery.mark', 'payment.collect'],
  customer: ['subscription.write', 'payment.online', 'complaint.create'],
}

export interface Actor {
  role: Role
  userId: ID
  /** Agency staff user (signed in with username + password): acts as the agency, limited by their User Roll. */
  staffId?: ID
}

/** `verb` is only used for staff users: "delete" needs the roll's Delete right, anything else Save or Update. */
export function can(db: DB, actor: Actor | null, action: Action, verb?: RollAction): boolean {
  if (!actor) return false
  const allowed = MATRIX[actor.role]
  if (allowed !== '*' && !allowed.includes(action)) return false
  if (actor.staffId && !staffAllows(db, actor, action, verb)) return false
  if (actor.role === 'agent' && (action === 'route.write' || action === 'route.handover')) {
    return !!db.agents.find((a) => a.id === actor.userId)?.canManageRoutes
  }
  if (actor.role === 'executive' && action === 'payment.collect') {
    return !!db.executives.find((e) => e.id === actor.userId)?.canCollectCash
  }
  return true
}

// ---------------- Scoping ----------------

export function routesFor(db: DB, actor: Actor): Route[] {
  switch (actor.role) {
    case 'admin':
      return db.routes
    case 'agent':
      return db.routes.filter((r) => r.agentId === actor.userId)
    case 'executive':
      return db.routes.filter((r) => r.executiveId === actor.userId)
    case 'customer':
      return []
  }
}

export function customersFor(db: DB, actor: Actor): Customer[] {
  switch (actor.role) {
    case 'admin':
      return db.customers
    case 'agent':
      return db.customers.filter((c) => c.agentId === actor.userId)
    case 'executive': {
      const ids = new Set(routesFor(db, actor).map((r) => r.id))
      return db.customers.filter((c) => c.routeId && ids.has(c.routeId))
    }
    case 'customer':
      return db.customers.filter((c) => c.id === actor.userId)
  }
}

export function executivesFor(db: DB, actor: Actor): Executive[] {
  if (actor.role === 'admin') return db.executives
  if (actor.role === 'agent') return db.executives.filter((e) => e.agentId === actor.userId)
  if (actor.role === 'executive') return db.executives.filter((e) => e.id === actor.userId)
  return []
}

export function agentsFor(db: DB, actor: Actor): Agent[] {
  if (actor.role === 'admin') return db.agents
  if (actor.role === 'agent') return db.agents.filter((a) => a.id === actor.userId)
  return []
}

export function canSeeCustomer(db: DB, actor: Actor, customerId: ID) {
  return customersFor(db, actor).some((c) => c.id === customerId)
}

export function executiveOf(db: DB, customer: Pick<Customer, 'routeId'>): Executive | undefined {
  const route = db.routes.find((r) => r.id === customer.routeId)
  return route?.executiveId ? db.executives.find((e) => e.id === route.executiveId) : undefined
}

export function userName(db: DB, id: ID | null | undefined): string {
  if (!id) return '—'
  return (
    db.admins.find((x) => x.id === id)?.name ??
    db.agents.find((x) => x.id === id)?.name ??
    db.executives.find((x) => x.id === id)?.name ??
    db.customers.find((x) => x.id === id)?.name ??
    'System'
  )
}

export function findUser(db: DB, role: Role, mobile: string): { id: ID; name: string; status: string } | undefined {
  const list = role === 'admin' ? db.admins : role === 'agent' ? db.agents : role === 'executive' ? db.executives : db.customers
  return list.find((u) => u.mobile === mobile)
}
