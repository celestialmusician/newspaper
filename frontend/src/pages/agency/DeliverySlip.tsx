import { ClipboardList, Printer, Search } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/misc'
import { occurrences } from '@/domain/schedule'
import { useActor, useData } from '@/hooks/app'
import { addDaysISO, todayISO } from '@/lib/dates'
import { formatNum } from '@/lib/utils'
import { QueryDesk } from '../console/shared'

/** Delivery Slip: copies of each title to hand out for a period, narrowed by agent, delivery boy, area or route. */
export default function DeliverySlip() {
  const db = useData()
  const actor = useActor()
  const today = todayISO()
  const [f, setF] = React.useState({ from: addDaysISO(today, 1), to: addDaysISO(today, 1), wise: '', boy: '', area: '', route: '' })
  const [applied, setApplied] = React.useState<typeof f | null>(null)

  const me = db.agents.find((a) => a.id === actor.userId)!
  const routes = db.routes.filter((r) => r.agentId === me.id)
  const boys = db.executives.filter((e) => e.agentId === me.id)
  const areas = db.locations.filter((l) => l.level === 'area' && me.areaIds.includes(l.id))

  const rows = React.useMemo(() => {
    if (!applied) return []
    const boyRoutes = new Set(routes.filter((r) => r.executiveId === applied.boy).map((r) => r.id))
    const customers = db.customers.filter(
      (c) =>
        c.agentId === me.id &&
        (!applied.wise || (applied.wise === 'sub' ? !!c.subAgent : !c.subAgent)) &&
        (!applied.area || c.areaId === applied.area) &&
        (!applied.route || c.routeId === applied.route) &&
        (!applied.boy || (c.routeId && boyRoutes.has(c.routeId))),
    )
    const ids = new Set(customers.map((c) => c.id))
    const occ = occurrences(db, db.subscriptions.filter((s) => ids.has(s.customerId)), applied.from, applied.to).filter((o) => ['scheduled', 'delivered', 'pending', 'missed'].includes(o.status))
    const byProduct = new Map<string, number>()
    for (const o of occ) byProduct.set(o.productId, (byProduct.get(o.productId) ?? 0) + o.quantity)
    return [...byProduct.entries()]
      .map(([id, qty]) => ({ id, name: db.products.find((p) => p.id === id)?.name ?? '—', qty }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r, i) => ({ ...r, n: i + 1 }))
  }, [applied, db, me.id, routes])
  type Row = (typeof rows)[number]
  const total = rows.reduce((s, r) => s + r.qty, 0)

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    { key: 'name', header: 'Product Name', sort: (r) => r.name, cell: (r) => <span className="font-semibold">{r.name}</span>, csv: (r) => r.name, hideOnMobile: true },
    { key: 'qty', header: 'Quantity', align: 'right', sort: (r) => r.qty, cell: (r) => <span className="tabular font-semibold">{formatNum(r.qty)}</span>, csv: (r) => r.qty },
  ]
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  return (
    <>
      <PageHeader kicker="Transactions" title="Delivery Slip" description="Copies of every title to collect from the press for the period." />
      <QueryDesk
        filters={
          <>
          <form
            className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(6,minmax(0,1fr))_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              setApplied(f)
            }}
          >
            <Field label="From Date">
              <Input type="date" value={f.from} max={f.to} onChange={(e) => set('from', e.target.value)} />
            </Field>
            <Field label="To Date">
              <Input type="date" value={f.to} min={f.from} onChange={(e) => set('to', e.target.value)} />
            </Field>
            <Field label="Agent / Sub Agent Wise">
              <NativeSelect value={f.wise} onChange={(e) => set('wise', e.target.value)}>
                <option value="">All</option>
                <option value="agent">Agent</option>
                <option value="sub">Sub Agent</option>
              </NativeSelect>
            </Field>
            <Field label="Delivery Boys">
              <NativeSelect value={f.boy} onChange={(e) => set('boy', e.target.value)}>
                <option value="">Select Delivery Boys</option>
                {boys.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Area Wise">
              <NativeSelect value={f.area} onChange={(e) => set('area', e.target.value)}>
                <option value="">Select Area</option>
                {areas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Route Wise">
              <NativeSelect value={f.route} onChange={(e) => set('route', e.target.value)}>
                <option value="">Select Route</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit">
                <Search /> Show
              </Button>
              <Button type="button" variant="outline" disabled={!rows.length} onClick={() => window.print()}>
                <Printer /> Print
              </Button>
            </div>
          </form>
          </>
        }
        summary={<>Results{applied && rows.length ? ` · ${formatNum(total)} copies` : ''}</>}
      >
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.name}</span>} exportName="delivery-slip" pageSize={25} empty={{ icon: ClipboardList, title: applied ? 'No deliveries in this selection' : 'Choose the period, then Show' }} />
      </QueryDesk>
    </>
  )
}
