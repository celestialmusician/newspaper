import { diffDays } from '@/lib/dates'
import type { Agent, Licence } from './types'

/**
 * The Super Administrator's account lists. The dashboard counters and the Accounts screen share these rules,
 * so a counter always equals the number of rows its screen shows.
 */
export type AccountView = 'active' | 'new' | 'deactive' | 'expiry' | 'renewal' | 'all'

export const ACCOUNT_VIEW_ORDER: AccountView[] = ['active', 'new', 'deactive', 'expiry', 'renewal', 'all']

export const ACCOUNT_VIEWS: Record<AccountView, { tab: string; title: string; description: string; emptyTitle: string; emptyText: string }> = {
  active: { tab: 'Active', title: 'Active Accounts', description: 'Agency accounts that can sign in today, with their licence dates.', emptyTitle: 'No active accounts', emptyText: 'Agencies appear here once they register.' },
  new: { tab: 'New', title: 'New Accounts', description: 'Agencies that joined in the last 7 days. They are active at once; tap a row to open its profile.', emptyTitle: 'No new accounts', emptyText: 'Agencies that register appear here.' },
  deactive: { tab: 'Deactive', title: 'Deactive Accounts', description: 'Locked accounts and agencies switched off. Nobody from them can sign in.', emptyTitle: 'No deactive accounts', emptyText: 'Every account can sign in.' },
  expiry: { tab: 'Expiring', title: 'Accounts Expiry', description: 'Licences that end within 30 days or have already ended, soonest first.', emptyTitle: 'Nothing expiring', emptyText: 'No licence ends in the next 30 days.' },
  renewal: { tab: 'Renewal', title: 'Renewal Requests', description: 'Agencies that asked to extend their licence. Renew to clear the request.', emptyTitle: 'No renewal requests', emptyText: 'Requests from agencies appear here.' },
  all: { tab: 'All', title: 'All Accounts', description: 'Every agency account, whatever its state.', emptyTitle: 'No accounts', emptyText: 'Agencies appear here once they register.' },
}

export const isAccountView = (v: string | null): v is AccountView => !!v && v in ACCOUNT_VIEWS

export function inAccountView(view: AccountView, l: Licence, a: Agent, today: string): boolean {
  const left = diffDays(l.licenceEnd, today)
  const blocked = l.locked || a.status !== 'active'
  switch (view) {
    case 'active':
      return !blocked && left >= 0
    case 'new':
      return diffDays(today, l.registeredOn) <= 7
    case 'deactive':
      return blocked
    case 'expiry':
      return !blocked && left <= 30
    case 'renewal':
      return !!l.renewalRequested
    default:
      return true
  }
}
