import { MonitorSmartphone } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Segmented } from '@/components/ui/form'
import { Avatar, Badge, PageHeader } from '@/components/ui/misc'
import { useData, useWarmup } from '@/hooks/app'
import { fmtDateTime } from '@/lib/dates'
import { formatMobile } from '@/lib/utils'

/** "2 days 3 hours" style gap since the last sign-in. */
function since(iso?: string) {
  if (!iso) return 'Never signed in'
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 2) return 'Just now'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  const parts = [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} hr`, !d && m && `${m} min`].filter(Boolean)
  return parts.slice(0, 2).join(' ')
}

export default function ControlRoom() {
  const db = useData()
  const ready = useWarmup()
  // Re-read the clock each minute so "online now" and the idle times stay honest on a page left open.
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const rows = React.useMemo(
    () =>
      db.licences
        .map((l) => ({ l, a: db.agents.find((x) => x.id === l.agentId)! }))
        .filter((r) => r.a)
        .map((r) => ({ ...r, mins: r.l.lastLoginAt ? (now - new Date(r.l.lastLoginAt).getTime()) / 60000 : Infinity })),
    [db, now],
  )
  const [params, setParams] = useSearchParams()
  const view: 'all' | 'online' | 'offline' = params.get('view') === 'online' || params.get('view') === 'offline' ? (params.get('view') as 'online' | 'offline') : 'all'
  const online = rows.filter((r) => r.mins < 30).length
  const counts = { all: rows.length, online, offline: rows.length - online }
  const shown = rows.filter((r) => view === 'all' || (view === 'online' ? r.mins < 30 : r.mins >= 30))
  type Row = (typeof rows)[number]

  const cols: Column<Row>[] = [
    {
      key: 'name',
      header: 'Account name',
      sort: (r) => r.a.agencyName,
      csv: (r) => r.a.agencyName,
      cell: (r) => (
        <div className="flex items-center gap-3">
          <span className="relative">
            <Avatar name={r.a.agencyName} size={34} />
            <span className={`absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card ${r.mins < 30 ? 'bg-success' : r.mins < 60 * 24 * 3 ? 'bg-warning' : 'bg-muted-foreground/40'}`} />
          </span>
          <span className="font-semibold">{r.a.agencyName}</span>
        </div>
      ),
    },
    { key: 'email', header: 'E-mail', sort: (r) => r.a.email, cell: (r) => <span className="text-[13px]">{r.a.email}</span>, hideOnMobile: true },
    { key: 'mobile', header: 'Mobile', sort: (r) => r.a.mobile, cell: (r) => <span className="tabular">{formatMobile(r.a.mobile)}</span>, csv: (r) => r.a.mobile },
    { key: 'user', header: 'Username', sort: (r) => r.a.email, cell: (r) => <span className="text-[13px]">{r.a.email}</span>, csv: (r) => r.a.email, hideOnMobile: true },
    { key: 'ip', header: 'IP Address', cell: (r) => <span className="break-all font-mono text-[12px] text-muted-foreground">{r.l.lastIp ?? '—'}</span>, csv: (r) => r.l.lastIp ?? '', hideOnMobile: true },
    { key: 'last', header: 'Last Login Time', sort: (r) => r.l.lastLoginAt ?? '', cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.l.lastLoginAt)}</span>, csv: (r) => r.l.lastLoginAt ?? '' },
    {
      key: 'idle',
      header: 'In Activity',
      sort: (r) => (Number.isFinite(r.mins) ? r.mins : 1e12),
      csv: (r) => since(r.l.lastLoginAt),
      cell: (r) => (r.mins < 30 ? <Badge tone="success" dot>Online now</Badge> : <span className="text-[13px] text-muted-foreground">{since(r.l.lastLoginAt)} ago</span>),
    },
  ]

  return (
    <>
      <PageHeader kicker="Licence console" title="Control Room" description={`${online} of ${rows.length} agency accounts are online right now. Last sign-in and idle time for every account.`} />
      <div className="-mx-1 mb-4 overflow-x-auto px-1 pb-1">
        <Segmented
          value={view}
          onChange={(v) => setParams(v === 'all' ? {} : { view: v }, { replace: true })}
          options={(['all', 'online', 'offline'] as const).map((v) => ({
            value: v,
            label: (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {v === 'all' ? 'All' : v === 'online' ? 'Online now' : 'Offline'}
                <span className={`tabular rounded-full px-1.5 text-[11px] font-bold ${v === view ? 'bg-brand-soft text-masthead' : 'bg-background/60 text-muted-foreground'}`}>{counts[v]}</span>
              </span>
            ),
          }))}
          className="flex-nowrap"
        />
      </div>
      <DataTable
        key={view}
        loading={!ready}
        rows={shown}
        columns={cols}
        rowKey={(r) => r.a.id}
        search={(r) => `${r.a.agencyName} ${r.a.email} ${r.a.mobile}`}
        initialSort={{ key: 'last', dir: 'desc' }}
        exportName={`control-room-${view}`}
        empty={{ icon: MonitorSmartphone, title: view === 'online' ? 'Nobody is online' : 'No accounts', description: view === 'online' ? 'Accounts that signed in during the last 30 minutes appear here.' : undefined }}
      />
    </>
  )
}
