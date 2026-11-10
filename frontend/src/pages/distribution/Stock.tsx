import { AlertTriangle, CheckCircle2, Package, Pencil, Plus, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { KpiStrip, LineChart, sharePct } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, DemoNote, EmptyState, PageHeader, StatCard } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { DataTable } from '@/components/ui/data-table'
import { demandByProduct } from '@/domain/schedule'
import { available, entriesOn, lowStock, previousRemaining, remaining } from '@/domain/stock'
import type { ID, StockEntry } from '@/domain/types'
import { useCan, useRun, useScope } from '@/hooks/app'
import { addDaysISO, eachDay, fmtDate, fmtShort, todayISO } from '@/lib/dates'
import { formatNum, sum } from '@/lib/utils'
import { stock as api } from '@/services/api'
import { todayStats } from '@/pages/dashboard/shared'

export default function Stock() {
  const scope = useScope()
  if (scope.actor.role === 'executive') return <ExecutiveLoad />
  return <AgencyStock />
}

function ExecutiveLoad() {
  const { db, subscriptions } = useScope()
  const t = todayStats(db, subscriptions)
  const rows = [...new Set(t.occ.map((o) => o.productId))].map((pid) => {
    const os = t.occ.filter((o) => o.productId === pid)
    return { p: db.products.find((x) => x.id === pid)!, total: sum(os.map((o) => o.quantity)), delivered: sum(os.filter((o) => o.status === 'delivered').map((o) => o.quantity)), missed: sum(os.filter((o) => o.status === 'missed').map((o) => o.quantity)) }
  })
  return (
    <>
      <PageHeader kicker="Stock" title="My load for today" description="Copies to collect from the agency point and carry on your round." />
      {!rows.length ? (
        <EmptyState icon={Package} title="No deliveries today" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <Card key={r.p.id} className="relative overflow-hidden p-5">
              <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: r.p.color }} />
              <div className="font-display text-xl font-semibold text-primary">{r.p.name}</div>
              <div className="mt-3 flex items-end justify-between">
                <span className="tabular font-display text-5xl font-semibold">{r.total}</span>
                <span className="text-right text-[13px] text-muted-foreground">
                  {r.delivered} delivered
                  <br />
                  {r.total - r.delivered - r.missed} to go · {r.missed} missed
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function AgencyStock() {
  const { db, actor, agents } = useScope()
  const canWrite = useCan('stock.write')
  const { run } = useRun()
  const [date, setDate] = React.useState(todayISO())
  const [agentId, setAgentId] = React.useState(actor.role === 'agent' ? actor.userId : agents[0]?.id ?? '')
  const [dialog, setDialog] = React.useState<{ productId: ID; entry?: StockEntry } | null>(null)
  const [historyProduct, setHistoryProduct] = React.useState('')

  const custIds = new Set(db.customers.filter((c) => c.agentId === agentId).map((c) => c.id))
  const demand = demandByProduct(db, db.subscriptions.filter((s) => custIds.has(s.customerId)), date)
  const entries = entriesOn(db, date, agentId)
  const alerts = lowStock(db, date, agentId)
  const productIds = [...new Set([...demand.keys(), ...entries.map((e) => e.productId)])]
  const rows = productIds.map((pid) => ({ p: db.products.find((x) => x.id === pid)!, e: entries.find((e) => e.productId === pid), need: demand.get(pid) ?? 0 })).sort((a, b) => a.p.name.localeCompare(b.p.name))
  const hp = historyProduct || rows[0]?.p.id
  const history = eachDay(addDaysISO(date, -13), date).map((d) => {
    const e = db.stock[`${d}|${hp}|${agentId}`]
    return { day: fmtShort(d), Received: e ? available(e) : 0, Distributed: e?.distributed ?? 0, Remaining: e ? remaining(e) : 0 }
  })

  return (
    <>
      <PageHeader
        kicker="Stock & inventory"
        title="Daily stock ledger"
        description="One ledger row per product, agent and day — distributed copies come from delivery records, so nothing is deducted twice."
        actions={
          <>
            {actor.role === 'admin' && (
              <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-10 w-52" aria-label="Agent">
                {db.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.agencyName}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="h-10 w-40" />
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Copies needed" value={formatNum(sum([...demand.values()]))} icon={Package} hint={`${demand.size} products scheduled`} />
        <StatCard label="Received + opening" value={formatNum(sum(entries.map(available)))} icon={Plus} tone="info" />
        <StatCard label="Distributed" value={formatNum(sum(entries.map((e) => e.distributed)))} icon={CheckCircle2} tone="success" />
        <StatCard label="Low stock alerts" value={alerts.length} icon={AlertTriangle} tone={alerts.length ? 'danger' : 'success'} hint={alerts.map((a) => `${a.productName}${a.shortBy ? ` short ${a.shortBy}` : ''}`).join(', ') || 'None'} />
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 text-left">Product</th>
                <th className="px-3 py-2.5 text-right">Needed</th>
                <th className="px-3 py-2.5 text-right">Opening</th>
                <th className="px-3 py-2.5 text-right">Received</th>
                <th className="px-3 py-2.5 text-right">Distributed</th>
                <th className="px-3 py-2.5 text-right">Returned</th>
                <th className="px-3 py-2.5 text-right">Damaged</th>
                <th className="px-3 py-2.5 text-right">Remaining</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, e, need }) => {
                const alert = alerts.find((a) => a.entry.productId === p.id)
                return (
                  <tr key={p.id} className="border-b border-border/50">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-semibold">
                        <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
                        {p.name}
                      </span>
                    </td>
                    <td className="tabular px-3 text-right font-semibold">{need}</td>
                    <td className="tabular px-3 text-right">{e?.opening ?? '—'}</td>
                    <td className="tabular px-3 text-right">{e?.received ?? '—'}</td>
                    <td className="tabular px-3 text-right">{e?.distributed ?? '—'}</td>
                    <td className="tabular px-3 text-right">{e?.returned ?? '—'}</td>
                    <td className="tabular px-3 text-right">{e?.damaged ?? '—'}</td>
                    <td className="tabular px-3 text-right font-bold">{e ? remaining(e) : '—'}</td>
                    <td className="px-3">
                      {!e ? <Badge tone="warning">No entry</Badge> : alert ? <Badge tone="danger">{alert.shortBy ? `Short by ${alert.shortBy}` : 'Low'}</Badge> : <Badge tone="success">OK</Badge>}
                      {e?.reconciled && (
                        <Badge tone="navy" className="ml-1">
                          <ShieldCheck className="size-3" /> Reconciled
                        </Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 text-right">
                      {canWrite && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => setDialog({ productId: p.id, entry: e })}>
                            {e ? <Pencil /> : <Plus />} {e ? 'Edit' : 'Add'}
                          </Button>
                          {e && !e.reconciled && (
                            <Button variant="ghost" size="sm" onClick={() => void run(() => api.reconcile(e.key), `${p.name} reconciled for ${fmtDate(date)}`)}>
                              Reconcile
                            </Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-muted-foreground">
                    No products scheduled for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <DemoNote className="mt-3">Remaining = opening + received − distributed + returned − damaged. Distributed updates automatically as executives mark deliveries.</DemoNote>

      {rows.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card>
            <CardHeader
              title="Stock history"
              description="Last 14 days"
              action={
                <NativeSelect value={hp} onChange={(e) => setHistoryProduct(e.target.value)} className="h-9 w-48 text-[13px]" aria-label="Product">
                  {rows.map((r) => (
                    <option key={r.p.id} value={r.p.id}>
                      {r.p.name}
                    </option>
                  ))}
                </NativeSelect>
              }
            />
            <CardBody className="space-y-4">
              {(() => {
                const received = sum(history.map((h) => h.Received))
                const distributed = sum(history.map((h) => h.Distributed))
                return (
                  <KpiStrip
                    items={[
                      { label: 'Received', value: formatNum(received), hint: '14 days' },
                      { label: 'Distributed', value: formatNum(distributed), hint: '14 days' },
                      { label: 'Sell-through', value: sharePct(distributed, received), hint: 'of copies received' },
                      { label: 'Remaining', value: formatNum(history.at(-1)?.Remaining ?? 0), hint: 'on the selected day', tone: (history.at(-1)?.Remaining ?? 0) > 0 ? 'warning' : undefined },
                    ]}
                  />
                )
              })()}
              <LineChart data={history} x="day" height={200} series={[{ key: 'Received', name: 'Received' }, { key: 'Distributed', name: 'Distributed' }]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Ledger rows" description={db.products.find((p) => p.id === hp)?.name} />
            <DataTable
              className="border-0 shadow-none"
              rows={Object.values(db.stock).filter((e) => e.productId === hp && e.agentId === agentId).sort((a, b) => (a.date < b.date ? 1 : -1))}
              rowKey={(e) => e.key}
              dense
              pageSize={7}
              exportName="stock-ledger"
              columns={[
                { key: 'd', header: 'Date', sort: (e) => e.date, cell: (e) => fmtShort(e.date) },
                { key: 'in', header: 'In', align: 'right', sort: (e) => available(e), cell: (e) => available(e) },
                { key: 'out', header: 'Out', align: 'right', sort: (e) => e.distributed, cell: (e) => e.distributed },
                { key: 'rem', header: 'Left', align: 'right', sort: (e) => remaining(e), cell: (e) => <b>{remaining(e)}</b> },
              ]}
            />
          </Card>
        </div>
      )}
      {dialog && <StockDialog date={date} agentId={agentId} productId={dialog.productId} entry={dialog.entry} need={demand.get(dialog.productId) ?? 0} onClose={() => setDialog(null)} />}
    </>
  )
}

function StockDialog({ date, agentId, productId, entry, need, onClose }: { date: string; agentId: ID; productId: ID; entry?: StockEntry; need: number; onClose: () => void }) {
  const { db } = useScope()
  const { run, pending } = useRun()
  const p = db.products.find((x) => x.id === productId)!
  const carry = p.type === 'Newspaper' ? 0 : previousRemaining(db, date, productId, agentId)
  const [v, setV] = React.useState({ opening: entry?.opening ?? carry, received: entry?.received ?? need, returned: entry?.returned ?? 0, damaged: entry?.damaged ?? 0 })
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: Math.max(0, Math.floor(Number(x) || 0)) }))
  const distributed = entry?.distributed ?? 0
  const rem = v.opening + v.received - distributed + v.returned - v.damaged
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title={`${entry ? 'Update' : 'Record'} stock`} description={`${p.name} · ${fmtDate(date)}`}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opening stock" hint={p.type === 'Newspaper' ? "Yesterday's papers don't carry over" : `Carried: ${carry}`}>
            <Input type="number" min={0} value={v.opening} onChange={(e) => set('opening', e.target.value)} />
          </Field>
          <Field label="Received today" hint={`Needed: ${need}`}>
            <Input type="number" min={0} value={v.received} onChange={(e) => set('received', e.target.value)} />
          </Field>
          <Field label="Returned">
            <Input type="number" min={0} value={v.returned} onChange={(e) => set('returned', e.target.value)} />
          </Field>
          <Field label="Damaged">
            <Input type="number" min={0} value={v.damaged} onChange={(e) => set('damaged', e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-muted/60 p-3 text-[13.5px]">
          <div>
            Distributed (auto): <b>{distributed}</b>
          </div>
          <div>
            Remaining: <b className={rem < p.lowStockThreshold ? 'text-destructive' : ''}>{rem}</b>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={async () => (await run(() => api.upsert({ date, productId, agentId, ...v }), 'Stock saved')) && onClose()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
