import { Activity, Search } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/misc'
import type { ActivityLog as Log } from '@/domain/types'
import { useData, useWarmup } from '@/hooks/app'
import { addDaysISO, fmtDateTime, todayISO } from '@/lib/dates'
import { humanAction } from '@/pages/dashboard/shared'
import { QueryDesk } from '../console/shared'

/** BACK - LOG: what each agency account did, filtered by date range and agency. */
export default function ActivityLog() {
  const db = useData()
  const ready = useWarmup()
  const today = todayISO()
  const [from, setFrom] = React.useState(addDaysISO(today, -60))
  const [to, setTo] = React.useState(today)
  const [agency, setAgency] = React.useState('')
  // The Search button applies the filters, like the legacy screen.
  const [applied, setApplied] = React.useState({ from, to, agency })

  /** The agency an entry belongs to: its agent, one of its executives, or the record it was about. */
  const agencyOf = (l: Log) => {
    if (l.actorRole === 'agent') return db.agents.find((a) => a.id === l.actorId)
    if (l.actorRole === 'executive') return db.agents.find((a) => a.id === db.executives.find((e) => e.id === l.actorId)?.agentId)
    if (l.actorRole === 'customer') return db.agents.find((a) => a.id === db.customers.find((c) => c.id === l.actorId)?.agentId)
    return db.agents.find((a) => a.id === l.entityId)
  }
  const usernameOf = (l: Log) => db.admins.find((x) => x.id === l.actorId)?.email ?? db.agents.find((x) => x.id === l.actorId)?.email ?? db.executives.find((x) => x.id === l.actorId)?.mobile ?? db.customers.find((x) => x.id === l.actorId)?.mobile ?? '—'

  const rows = db.logs
    .filter((l) => l.at.slice(0, 10) >= applied.from && l.at.slice(0, 10) <= applied.to && (!applied.agency || agencyOf(l)?.id === applied.agency))
    .map((l, i) => ({ l, n: i + 1, account: agencyOf(l)?.agencyName ?? 'Super Administrator', username: usernameOf(l) }))
  type Row = (typeof rows)[number]

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    { key: 'acc', header: 'Account Name', sort: (r) => r.account, cell: (r) => <span className="font-semibold">{r.account}</span>, csv: (r) => r.account, hideOnMobile: true },
    { key: 'user', header: 'Username', sort: (r) => r.username, cell: (r) => <span className="text-[13px]">{r.username}</span>, csv: (r) => r.username },
    {
      key: 'q',
      header: 'Activity',
      csv: (r) => `${humanAction(r.l.action)} ${r.l.entity} ${r.l.detail ?? ''}`,
      cell: (r) => (
        <div className="max-w-[30rem] text-[13px]">
          <span className="font-semibold">{humanAction(r.l.action)}</span> {r.l.entity}
          {r.l.detail && <div className="text-muted-foreground">{r.l.detail}</div>}
        </div>
      ),
    },
    { key: 'at', header: 'Created Date', sort: (r) => r.l.at, csv: (r) => r.l.at, cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.l.at)}</span> },
  ]

  return (
    <>
      <PageHeader kicker="Back Log" title="Back Log" description="Manage Back Log — every create, update, lock, rate change and billing run, with who did it and when." />
      <QueryDesk
        filters={
          <>
          <form
            className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              setApplied({ from, to, agency })
            }}
          >
            <Field label="From Date">
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To Date">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Select Agency">
              <NativeSelect value={agency} onChange={(e) => setAgency(e.target.value)}>
                <option value="">Select Agency</option>
                {db.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.agencyName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" className="w-fit">
              <Search /> Search
            </Button>
          </form>
          </>
        }
        summary={<>Results</>}
      >
        <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.l.id} pageSize={25} initialSort={{ key: 'at', dir: 'desc' }} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.account}</span>} search={(r) => `${r.account} ${r.username} ${r.l.action} ${r.l.entity} ${r.l.detail ?? ''}`} exportName="back-log" empty={{ icon: Activity, title: 'No activity in this range' }} />
      </QueryDesk>
    </>
  )
}
