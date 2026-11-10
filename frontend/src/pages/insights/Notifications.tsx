import { Bell, BellRing, Boxes, CalendarClock, CheckCheck, CreditCard, FileText, MessageSquareWarning, Repeat, Route, Search, Settings2, Tag, Truck, UserPlus } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { enablePush } from '@/app/pwa'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, Segmented } from '@/components/ui/form'
import { Card, EmptyState, PageHeader } from '@/components/ui/misc'
import type { NotificationKind } from '@/domain/types'
import { useActor, useMyNotifications } from '@/hooks/app'
import { addDaysISO, fmtDateTime, relativeTime, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { notifications as api } from '@/services/api'
import { QueryDesk } from '../console/shared'

const ICON: Record<NotificationKind, React.ElementType> = {
  invoice: FileText,
  payment_due: BellRing,
  payment_success: CreditCard,
  renewal: Repeat,
  expiry: CalendarClock,
  delivery: Truck,
  complaint: MessageSquareWarning,
  registration: UserPlus,
  subscription: Repeat,
  stock: Boxes,
  price: Tag,
  route: Route,
  system: Settings2,
}

/** The agency's Notifications screen (legacy Reports › Notifications): From / To dates and a Sl No · Notifications · Date · Posted by table. */
function AgencyNotifications() {
  const notes = useMyNotifications()
  const navigate = useNavigate()
  const today = todayISO()
  const [from, setFrom] = React.useState(addDaysISO(today, -60))
  const [to, setTo] = React.useState(today)
  const [applied, setApplied] = React.useState({ from, to })
  const rows = notes
    .filter((n) => n.at.slice(0, 10) >= applied.from && n.at.slice(0, 10) <= applied.to)
    .map((n, i) => ({ n, i: i + 1, by: n.kind === 'system' ? 'Super Administrator' : 'NewsRound' }))
  type Row = (typeof rows)[number]
  const cols: Column<Row>[] = [
    { key: 'i', header: 'Sl No', sort: (r) => r.i, cell: (r) => <span className="tabular text-muted-foreground">{r.i}</span>, className: 'w-14' },
    {
      key: 'text',
      header: 'Notifications',
      csv: (r) => `${r.n.title} — ${r.n.body}`,
      cell: (r) => (
        <button
          className="max-w-[34rem] text-left"
          onClick={() => {
            void api.markRead([r.n.id])
            if (r.n.link) navigate(r.n.link)
          }}
        >
          <span className="flex items-center gap-2 font-semibold">
            {r.n.title}
            {!r.n.read && <span className="size-2 rounded-full bg-masthead" />}
          </span>
          <span className="block text-[13px] text-muted-foreground">{r.n.body}</span>
        </button>
      ),
    },
    { key: 'date', header: 'Date', sort: (r) => r.n.at, csv: (r) => r.n.at, cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.n.at)}</span> },
    { key: 'by', header: 'Posted by', sort: (r) => r.by, csv: (r) => r.by, cell: (r) => r.by, hideOnMobile: true },
  ]
  return (
    <>
      <PageHeader kicker="Reports" title="Notifications" description="Everything the system and the super administrator posted for your agency." />
      <QueryDesk
        filters={
          <>
          <form
            className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,14rem))_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              setApplied({ from, to })
            }}
          >
            <Field label="From Date">
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To Date">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button type="submit" className="w-fit">
              <Search /> Search
            </Button>
          </form>
          </>
        }
      >
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.n.id} pageSize={25} mobileTitle={(r) => <span className="font-semibold">{r.i}. {r.n.title}</span>} search={(r) => `${r.n.title} ${r.n.body}`} exportName="notifications" initialSort={{ key: 'date', dir: 'desc' }} empty={{ icon: Bell, title: 'No notifications in this range' }} />
      </QueryDesk>
    </>
  )
}

export default function Notifications() {
  const actor = useActor()
  return actor.role === 'agent' ? <AgencyNotifications /> : <NotificationCentre />
}

function NotificationCentre() {
  const notes = useMyNotifications()
  const navigate = useNavigate()
  const [filter, setFilter] = React.useState<'all' | 'unread'>('unread')
  const rows = notes.filter((n) => filter === 'all' || !n.read)
  const unread = notes.filter((n) => !n.read)
  return (
    <>
      <PageHeader
        kicker="Notification centre"
        title="Notifications"
        description="Bills, payments, delivery updates, route changes and alerts for your role."
        actions={
          <>
            <Button
              variant="outline"
              onClick={async () => {
                const r = await enablePush()
                if (r === 'granted') toast.success('Push notifications enabled on this device')
                else if (r === 'unsupported') toast.error('This browser does not support push notifications')
                else toast.info('Permission not granted — you can enable it from browser settings')
              }}
            >
              <Bell /> Enable push
            </Button>
            {unread.length > 0 && (
              <Button onClick={() => void api.markRead(unread.map((n) => n.id))}>
                <CheckCheck /> Mark all read
              </Button>
            )}
          </>
        }
      />
      <Segmented className="mb-4" value={filter} onChange={setFilter} options={[{ value: 'unread', label: `Unread ${unread.length}` }, { value: 'all', label: `All ${notes.length}` }]} />
      {!rows.length ? (
        <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here." />
      ) : (
        <div className="space-y-2">
          {rows.map((n) => {
            const Icon = ICON[n.kind] ?? Bell
            return (
              <Card key={n.id} className={cn('flex gap-4 p-4 transition hover:shadow-pop', !n.read && 'border-masthead/30')}>
                <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', n.read ? 'bg-muted text-muted-foreground' : 'bg-masthead/10 text-masthead')}>
                  <Icon className="size-5" />
                </span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    void api.markRead([n.id])
                    if (n.link) navigate(n.link)
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{n.title}</span>
                    {!n.read && <span className="size-2 rounded-full bg-masthead" />}
                  </div>
                  <div className="text-[14px] text-muted-foreground">{n.body}</div>
                  <div className="mt-1 text-[12px] text-muted-foreground" title={fmtDateTime(n.at)}>
                    {relativeTime(n.at)}
                  </div>
                </button>
                {!n.read && (
                  <Button variant="ghost" size="sm" onClick={() => void api.markRead([n.id])}>
                    Mark read
                  </Button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
