import { format } from 'date-fns'
import { Activity } from 'lucide-react'
import { Link } from 'react-router-dom'
import { userName } from '@/domain/access'
import { invoiceRemaining, isOverdue } from '@/domain/billing'
import type { DB } from '@/domain/db'
import { occurrences } from '@/domain/schedule'
import type { ActivityLog, ID, Invoice, Payment, Subscription } from '@/domain/types'
import { addDaysISO, eachDay, fmtShort, fromISO, monthStartISO, relativeTime, todayISO } from '@/lib/dates'
import { formatINR, sum } from '@/lib/utils'
import { Avatar, Card, CardHeader, EmptyState } from '@/components/ui/misc'
import { useData } from '@/hooks/app'

export function todayStats(db: DB, subs: Subscription[]) {
  const t = todayISO()
  const occ = occurrences(db, subs, t, t).filter((o) => o.status !== 'paused' && o.status !== 'holiday')
  return {
    total: occ.length,
    copies: sum(occ.map((o) => o.quantity)),
    delivered: occ.filter((o) => o.status === 'delivered').length,
    missed: occ.filter((o) => o.status === 'missed').length,
    pending: occ.filter((o) => o.status === 'pending').length,
    occ,
  }
}

export function deliveryTrend(db: DB, subs: Subscription[], days = 14) {
  const t = todayISO()
  const occ = occurrences(db, subs, addDaysISO(t, -(days - 1)), t)
  return eachDay(addDaysISO(t, -(days - 1)), t).map((d) => {
    const os = occ.filter((o) => o.date === d)
    return { day: fmtShort(d), Delivered: os.filter((o) => o.status === 'delivered').length, Missed: os.filter((o) => o.status === 'missed').length, Pending: os.filter((o) => o.status === 'pending').length }
  })
}

export function billedVsCollected(invoices: Invoice[], payments: Payment[]) {
  const months = [...new Set([...invoices.map((i) => i.periodStart), monthStartISO(todayISO())])].sort().slice(-4)
  return months.map((m) => ({
    month: format(fromISO(m), 'MMM yyyy'),
    Billed: sum(invoices.filter((i) => i.periodStart === m).map((i) => i.currentBill)),
    Collected: sum(payments.filter((p) => monthStartISO(p.date) === m).map((p) => p.amount)),
  }))
}

export function collectionsTrend(payments: Payment[], days = 30) {
  const t = todayISO()
  return eachDay(addDaysISO(t, -(days - 1)), t).map((d) => ({ day: fmtShort(d), Collected: sum(payments.filter((p) => p.date === d).map((p) => p.amount)) }))
}

export function outstandingBy(invoices: Invoice[]) {
  return {
    total: sum(invoices.map(invoiceRemaining)),
    overdue: invoices.filter((i) => isOverdue(i)),
    overdueAmount: sum(invoices.filter((i) => isOverdue(i)).map(invoiceRemaining)),
  }
}

export function RecentActivity({ logs, limit = 8 }: { logs: ActivityLog[]; limit?: number }) {
  return (
    <Card>
      <CardHeader title="Recent activity" icon={Activity} action={<Link to="/logs" className="text-[13px] font-semibold text-primary hover:underline">View all</Link>} />
      <ActivityList logs={logs.slice(0, limit)} />
    </Card>
  )
}

export function ActivityList({ logs }: { logs: ActivityLog[] }) {
  if (!logs.length) return <EmptyState icon={Activity} title="No activity yet" />
  return (
    <ul className="mt-2 divide-y divide-border/60 px-5 pb-3">
      {logs.map((l) => (
        <ActivityRow key={l.id} l={l} />
      ))}
    </ul>
  )
}

function ActivityRow({ l }: { l: ActivityLog }) {
  const db = useData()
  const name = userName(db, l.actorId)
  return (
    <li className="-mx-2 flex gap-3 rounded-lg px-2 py-2.5 transition-colors duration-200 hover:bg-accent/60">
      <Avatar name={name} size={30} />
      <div className="min-w-0 flex-1 text-[13.5px]">
        <div>
          <b className="font-semibold">{name}</b> <span className="text-muted-foreground">{humanAction(l.action)}</span> <b className="font-semibold">{l.entity}</b>
        </div>
        {l.detail && <div className="truncate text-[12.5px] text-muted-foreground">{l.detail}</div>}
      </div>
      <span className="shrink-0 text-[11.5px] text-muted-foreground">{relativeTime(l.at)}</span>
    </li>
  )
}

const ACTIONS: Record<string, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  archive: 'archived',
  handover: 'handed over',
  generate: 'generated',
  record: 'recorded payment from',
  register: 'registered',
  change: 'changed',
  schedule: 'scheduled price for',
  sequence: 're-ordered',
  reconcile: 'reconciled',
  adjust: 'adjusted',
  revoke: 'revoked discount for',
  round: 'started round on',
  verify: 'verified',
  active: 'activated',
  inactive: 'deactivated',
  reject: 'rejected',
  lock: 'locked',
  unlock: 'unlocked',
  renew: 'renewed',
  root_login: 'opened as admin',
  send: 'sent notice to',
}
export const humanAction = (a: string) => {
  const [entity, verb] = a.split('.')
  return `${ACTIONS[verb ?? ''] ?? verb} ${entity === 'payment' && verb === 'record' ? '' : entity}`.trim()
}

export function OverdueList({ invoices, limit = 6 }: { invoices: Invoice[]; limit?: number }) {
  const db = useData()
  const rows = invoices
    .slice()
    .sort((a, b) => invoiceRemaining(b) - invoiceRemaining(a))
    .slice(0, limit)
  if (!rows.length) return <p className="px-5 py-8 text-center text-sm text-muted-foreground">No overdue payments. 🎉</p>
  return (
    <ul className="divide-y divide-border/60 px-5 pb-2">
      {rows.map((i) => {
        const c = db.customers.find((x) => x.id === i.customerId)!
        return (
          <li key={i.id}>
            <Link to={`/customers/${c.id}?tab=pending`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-[background-color,transform] duration-300 ease-out-expo hover:translate-x-0.5 hover:bg-accent/60">
              <Avatar name={c.name} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold">{c.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {i.number} · due {fmtShort(i.dueDate)}
                </div>
              </div>
              <span className="tabular text-[14px] font-bold text-destructive">{formatINR(invoiceRemaining(i))}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

export const idsOf = (xs: { id: ID }[]) => new Set(xs.map((x) => x.id))
