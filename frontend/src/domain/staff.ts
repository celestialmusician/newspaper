import type { DB } from './db'
import type { Action, Actor } from './access'
import type { RollAction, StaffUser, UserRoll } from './types'

/**
 * Agency staff users. A staff user signs in with a username and password and works inside the
 * owner's agency (same data scope), limited by the pages and actions of their User Roll.
 * The agency owner (no staffId) is never limited.
 */

/** Pages only the agency owner can open: they would let staff widen their own access, or touch the owner's login and profile (mobile, MPIN). */
export const OWNER_ONLY = ['/user-roll', '/users', '/change-password', '/profile']

/** Pages every staff user can open. */
const ALWAYS = ['/notifications', '/help']

/** Screens reached from a menu page that have their own path. */
const ALIAS: Record<string, string> = { '/invoices': '/bill' }

export function staffOf(db: Pick<DB, 'staffUsers'>, actor: Pick<Actor, 'staffId'>): StaffUser | undefined {
  return actor.staffId ? db.staffUsers.find((u) => u.id === actor.staffId) : undefined
}

/** The roll of the signed-in staff user (undefined for the owner, or when the user or roll is gone or switched off). */
export function activeRoll(db: Pick<DB, 'staffUsers' | 'userRolls'>, actor: Pick<Actor, 'staffId'>): UserRoll | undefined {
  const u = staffOf(db, actor)
  if (!u || u.status !== 'active') return undefined
  const r = db.userRolls.find((x) => x.id === u.rollId)
  return r?.status === 'active' ? r : undefined
}

const under = (path: string, key: string) => (key === '/' ? path === '/' : path === key || path.startsWith(`${key}/`))

/** May this session open the page? Owners always; staff only pages their roll grants (any action counts as access). */
export function canOpen(db: Pick<DB, 'staffUsers' | 'userRolls'>, actor: Pick<Actor, 'staffId'>, path: string): boolean {
  if (!actor.staffId) return true
  if (OWNER_ONLY.some((p) => under(path, p))) return false
  const roll = activeRoll(db, actor)
  if (!roll) return false
  if (ALWAYS.some((p) => under(path, p))) return true
  const alias = Object.entries(ALIAS).find(([from]) => under(path, from))
  const target = alias ? path.replace(alias[0], alias[1]) : path
  return Object.entries(roll.perms).some(([key, verbs]) => verbs.length > 0 && under(target, key))
}

/** Which menu pages carry each service action (a staff user needs a write action on one of them). */
const ACTION_PAGES: Partial<Record<Action, string[]>> = {
  'product.write': ['/manage-products'],
  'price.write': ['/product-rates', '/rate-setting'],
  'executive.write': ['/delivery-boys'],
  'customer.write': ['/customers-master'],
  'customer.status': ['/customers-master'],
  'subscription.write': ['/manage-subscriptions', '/customers-master'],
  'location.write': ['/customers-master', '/manage-route'],
  'route.write': ['/manage-route'],
  'route.handover': ['/manage-route'],
  'delivery.mark': ['/delivery-slip', '/manage-route'],
  'stock.write': ['/delivery-slip'],
  'discount.write': ['/bill-adjustment', '/bill'],
  'invoice.generate': ['/bill'],
  'invoice.adjust': ['/bill-adjustment', '/bill'],
  'payment.collect': ['/payment-collection', '/bill'],
  'remittance.write': ['/payment-collection'],
  'master.write': ['/masters/subscription-types', '/masters/payment-modes'],
  'agency.settings': ['/agency-profile', '/subscription-info', '/bill-serials', '/handling-charge', '/rate-setting'],
  'reports.view': ['/reports'],
}

const WRITE: RollAction[] = ['add', 'edit']

/**
 * May a staff user do this? Actions with no page in the map are closed to staff.
 * `verb` narrows it: "delete" needs Delete on the page; everything else needs Save or Update.
 */
export function staffAllows(db: Pick<DB, 'staffUsers' | 'userRolls'>, actor: Pick<Actor, 'staffId'>, action: Action, verb?: RollAction): boolean {
  if (!actor.staffId) return true
  const roll = activeRoll(db, actor)
  const pages = ACTION_PAGES[action]
  if (!roll || !pages) return false
  const need: RollAction[] = action === 'reports.view' ? ['view', 'add', 'edit', 'delete'] : verb === 'delete' ? ['delete'] : verb ? [verb] : WRITE
  return pages.some((p) => Object.entries(roll.perms).some(([key, verbs]) => under(p, key) && verbs.some((v) => need.includes(v))))
}
