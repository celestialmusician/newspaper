import { Eye, MoreVertical, Pencil, Plus, Power, Users } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CustomerDialog } from '@/components/CustomerDialog'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { NativeSelect } from '@/components/ui/form'
import { Avatar, PageHeader, StatusBadge } from '@/components/ui/misc'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, useConfirm } from '@/components/ui/overlay'
import { executiveOf, userName } from '@/domain/access'
import { customerOutstanding } from '@/domain/billing'
import { areaLabel } from '@/domain/locations'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import type { Customer } from '@/domain/types'
import { useCan, useRun, useScope, useWarmup } from '@/hooks/app'
import { formatINR, formatMobile } from '@/lib/utils'
import { customers as api } from '@/services/api'

export default function Customers() {
  const { db, actor, customers, routes } = useScope()
  const ready = useWarmup()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canWrite = useCan('customer.write')
  const confirm = useConfirm()
  const { run } = useRun()
  const [editing, setEditing] = React.useState<Customer | undefined>()
  const [open, setOpen] = React.useState(params.get('new') === '1')
  const [agent, setAgent] = React.useState('')
  const [route, setRoute] = React.useState('')
  const [status, setStatus] = React.useState('')
  const [dues, setDues] = React.useState(false)

  const rows = React.useMemo(
    () =>
      customers
        .map((c) => ({ c, due: customerOutstanding(db, c.id), subs: db.subscriptions.filter((s) => s.customerId === c.id && deriveSubscriptionStatus(s) === 'active').length, exec: executiveOf(db, c) }))
        .filter(({ c, due }) => (!agent || c.agentId === agent) && (!route || (route === 'none' ? !c.routeId : c.routeId === route)) && (!status || c.status === status) && (!dues || due > 0)),
    [customers, db, agent, route, status, dues],
  )

  const toggleStatus = async (c: Customer) => {
    const next = c.status === 'active' ? 'inactive' : 'active'
    const ok = await confirm({
      title: `${next === 'inactive' ? 'Deactivate' : 'Activate'} ${c.name}?`,
      description: next === 'inactive' ? 'The customer will not be able to sign in. Subscriptions, bills and history are kept.' : 'The customer can sign in again.',
      confirmLabel: next === 'inactive' ? 'Deactivate' : 'Activate',
      tone: next === 'inactive' ? 'destructive' : 'default',
    })
    if (ok) await run(() => api.update(c.id, { status: next }), `${c.name} ${next === 'active' ? 'activated' : 'deactivated'}`)
  }

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'name',
      header: 'Customer',
      label: 'Customer',
      sort: (r) => r.c.name,
      csv: (r) => r.c.name,
      cell: ({ c }) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.name} size={34} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{c.name}</div>
            <div className="text-[12px] text-muted-foreground">{c.code}</div>
          </div>
        </div>
      ),
    },
    { key: 'mobile', header: 'Mobile', sort: (r) => r.c.mobile, cell: ({ c }) => <span className="tabular whitespace-nowrap">{formatMobile(c.mobile)}</span> },
    { key: 'area', header: 'Area', sort: (r) => areaLabel(db, r.c.areaId), cell: ({ c }) => <span className="whitespace-nowrap">{areaLabel(db, c.areaId)}</span> },
    ...(actor.role === 'admin' ? [{ key: 'agent', header: 'Agent', sort: (r: (typeof rows)[number]) => userName(db, r.c.agentId), hideOnMobile: true, cell: ({ c }: (typeof rows)[number]) => userName(db, c.agentId) }] : []),
    {
      key: 'exec',
      header: 'Route / Executive',
      label: 'Executive',
      sort: (r) => r.exec?.name ?? '',
      csv: (r) => r.exec?.name ?? '',
      cell: ({ c, exec }) => (
        <div className="min-w-0">
          <div className="truncate">{exec?.name ?? <span className="text-warning">Unassigned</span>}</div>
          <div className="truncate text-[12px] text-muted-foreground">{db.routes.find((r) => r.id === c.routeId)?.code ?? '—'}</div>
        </div>
      ),
    },
    { key: 'subs', header: 'Active subs', align: 'right', sort: (r) => r.subs, cell: (r) => <span className="tabular">{r.subs}</span> },
    { key: 'due', header: 'Outstanding', align: 'right', sort: (r) => r.due, cell: (r) => <span className={`tabular font-semibold ${r.due > 0 ? 'text-destructive' : 'text-success'}`}>{formatINR(r.due)}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.c.status, cell: ({ c }) => <StatusBadge status={c.status} />, hideOnMobile: true },
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      cell: ({ c }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => navigate(`/customers/${c.id}`)}>
                <Eye /> View profile
              </DropdownMenuItem>
              {canWrite && (
                <>
                  <DropdownMenuItem onSelect={() => { setEditing(c); setOpen(true) }}>
                    <Pencil /> Edit details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive={c.status === 'active'} onSelect={() => void toggleStatus(c)}>
                    <Power /> {c.status === 'active' ? 'Deactivate' : 'Activate'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        kicker="People"
        title={actor.role === 'executive' ? 'My customers' : 'Customers'}
        description={actor.role === 'executive' ? 'Everyone on your routes — addresses, map pins, subscriptions and instructions.' : `${customers.length} subscribers${actor.role === 'agent' ? ' assigned to your agency' : ' across all agencies'}.`}
        actions={
          canWrite && (
            <Button onClick={() => { setEditing(undefined); setOpen(true) }}>
              <Plus /> Register customer
            </Button>
          )
        }
      />
      <DataTable
        loading={!ready}
        rows={rows}
        rowKey={(r) => r.c.id}
        columns={columns}
        search={({ c }) => `${c.name} ${c.code} ${c.mobile} ${c.houseName} ${areaLabel(db, c.areaId)}`}
        searchPlaceholder="Search name, mobile, code, house…"
        onRowClick={({ c }) => navigate(`/customers/${c.id}`)}
        initialSort={{ key: 'name', dir: 'asc' }}
        exportName="customers"
        mobileAside={({ due }) => <span className={`tabular text-[13px] font-bold ${due > 0 ? 'text-destructive' : 'text-success'}`}>{formatINR(due)}</span>}
        empty={{ icon: Users, title: 'No customers yet', description: 'Register your first subscriber to start deliveries and billing.' }}
        toolbar={
          <>
            {actor.role === 'admin' && (
              <NativeSelect value={agent} onChange={(e) => setAgent(e.target.value)} className="h-10 w-44 text-[13.5px]" aria-label="Filter by agent">
                <option value="">All agents</option>
                {db.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            <NativeSelect value={route} onChange={(e) => setRoute(e.target.value)} className="h-10 w-44 text-[13.5px]" aria-label="Filter by route">
              <option value="">All routes</option>
              <option value="none">No route</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} · {r.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-32 text-[13.5px]" aria-label="Filter by status">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </NativeSelect>
            <Button variant={dues ? 'default' : 'outline'} size="sm" onClick={() => setDues((d) => !d)}>
              With dues
            </Button>
          </>
        }
      />
      <CustomerDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o && params.get('new')) setParams({}, { replace: true })
        }}
        customer={editing}
      />
    </>
  )
}
