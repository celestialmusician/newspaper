import { FileDown } from 'lucide-react'
import * as React from 'react'
import { KpiStrip, LineChart, sharePct } from '@/components/charts'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Input, NativeSelect } from '@/components/ui/form'
import { Card, CardBody, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { userName } from '@/domain/access'
import { customerOutstanding, invoiceRemaining } from '@/domain/billing'
import { chainByLevel } from '@/domain/locations'
import { resolvePrice } from '@/domain/pricing'
import { occurrences } from '@/domain/schedule'
import { available, remaining } from '@/domain/stock'
import { useScope } from '@/hooks/app'
import { addDaysISO, eachDay, fmtDate, fmtMonth, fmtShort, todayISO } from '@/lib/dates'
import { formatINR, formatNum, groupBy, round2, sum } from '@/lib/utils'

const REPORTS = [
  ['daily', 'Daily sales'],
  ['monthly', 'Monthly sales'],
  ['product', 'Product-wise revenue'],
  ['agent', 'Agent-wise revenue'],
  ['outstanding', 'Customer outstanding'],
  ['collection', 'Payment collection'],
  ['profit', 'Profit analysis'],
  ['stock', 'Stock summary'],
  ['delivery', 'Delivery performance'],
  ['slip', 'Delivery slip'],
] as const

export default function Reports() {
  const { db, actor, agents } = useScope()
  const [from, setFrom] = React.useState(addDaysISO(todayISO(), -29))
  const [to, setTo] = React.useState(todayISO())
  const [agentId, setAgentId] = React.useState(actor.role === 'agent' ? actor.userId : '')
  const [tab, setTab] = React.useState<string>('daily')

  const custs = db.customers.filter((c) => !agentId || c.agentId === agentId)
  const custIds = new Set(custs.map((c) => c.id))
  const subs = db.subscriptions.filter((s) => custIds.has(s.customerId))
  const invoices = db.invoices.filter((i) => custIds.has(i.customerId))
  const pays = db.payments.filter((p) => custIds.has(p.customerId) && p.date >= from && p.date <= to)
  const occ = React.useMemo(() => occurrences(db, subs, from, to), [db, subs, from, to])

  return (
    <>
      <PageHeader
        kicker="Insights"
        title="Reports"
        description="Every report respects your access — agents see only their agency. Export any table to CSV (opens in Excel)."
        actions={
          <>
            {actor.role === 'admin' && (
              <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-10 w-48" aria-label="Agent">
                <option value="">All agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-10 w-40" aria-label="From" />
            <Input type="date" value={to} min={from} max={todayISO()} onChange={(e) => setTo(e.target.value)} className="h-10 w-40" aria-label="To" />
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {REPORTS.map(([k, l]) => (
            <TabsTrigger key={k} value={k}>
              {l}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="daily">
          <DailySales occ={occ} from={from} to={to} />
        </TabsContent>
        <TabsContent value="monthly">
          <Report
            chart={(rows) => {
              const billed = sum(rows.map((r) => r.billed))
              const collected = sum(rows.map((r) => r.collected))
              return (
                <>
                  <KpiStrip
                    items={[
                      { label: 'Billed', value: formatINR(billed, true), hint: `${rows.length} months` },
                      { label: 'Collected', value: formatINR(collected, true) },
                      { label: 'Outstanding', value: formatINR(sum(rows.map((r) => r.due)), true), tone: 'critical' },
                      { label: 'Collection rate', value: sharePct(collected, billed) },
                    ]}
                  />
                  {rows.length > 1 && <LineChart className="mt-4" data={rows.slice().reverse().map((r) => ({ month: fmtMonth(r.m), Billed: r.billed, Collected: r.collected }))} x="month" money series={[{ key: 'Billed', name: 'Billed' }, { key: 'Collected', name: 'Collected' }]} />}
                </>
              )
            }}
            rows={Object.entries(groupBy(invoices, (i) => i.periodStart))
              .map(([m, inv]) => ({ m, n: inv.length, billed: sum(inv.map((i) => i.currentBill)), discount: sum(inv.map((i) => i.discount)), collected: sum(inv.map((i) => i.paid)), due: sum(inv.map(invoiceRemaining)) }))
              .sort((a, b) => (a.m < b.m ? 1 : -1))}
            rowKey={(r) => r.m}
            name="monthly-sales"
            columns={[
              { key: 'm', header: 'Month', sort: (r) => r.m, cell: (r) => <b>{fmtMonth(r.m)}</b>, csv: (r) => fmtMonth(r.m) },
              { key: 'n', header: 'Invoices', align: 'right', sort: (r) => r.n, cell: (r) => r.n },
              { key: 'b', header: 'Billed', align: 'right', sort: (r) => r.billed, cell: (r) => formatINR(r.billed) },
              { key: 'd', header: 'Discounts', align: 'right', sort: (r) => r.discount, cell: (r) => formatINR(r.discount) },
              { key: 'c', header: 'Collected', align: 'right', sort: (r) => r.collected, cell: (r) => formatINR(r.collected) },
              { key: 'o', header: 'Outstanding', align: 'right', sort: (r) => r.due, cell: (r) => <b className="text-destructive">{formatINR(r.due)}</b> },
            ]}
          />
        </TabsContent>
        <TabsContent value="product">
          {(() => {
            const lines = invoices.flatMap((i) => i.lines)
            const rows = Object.entries(groupBy(lines, (l) => l.productId)).map(([pid, ls]) => ({ pid, name: db.products.find((p) => p.id === pid)?.name ?? '', copies: sum(ls.map((l) => l.quantity)), revenue: sum(ls.map((l) => l.amount)) })).sort((a, b) => b.revenue - a.revenue)
            const revenue = sum(rows.map((r) => r.revenue))
            return <Report chart={() => (
              <KpiStrip
                items={[
                  { label: 'Revenue', value: formatINR(revenue, true), hint: `${rows.length} titles` },
                  { label: 'Copies billed', value: formatNum(sum(rows.map((r) => r.copies))) },
                  { label: 'Top title', value: rows[0]?.name ?? '—', hint: rows[0] ? `${sharePct(rows[0].revenue, revenue)} of revenue` : undefined },
                  { label: 'Revenue per copy', value: formatINR(revenue / Math.max(1, sum(rows.map((r) => r.copies)))) },
                ]}
              />
            )} rows={rows} rowKey={(r) => r.pid} name="product-revenue" columns={[
              { key: 'n', header: 'Product', sort: (r) => r.name, cell: (r) => <b>{r.name}</b>, csv: (r) => r.name },
              { key: 'c', header: 'Copies billed', align: 'right', sort: (r) => r.copies, cell: (r) => formatNum(r.copies) },
              { key: 'r', header: 'Revenue', align: 'right', sort: (r) => r.revenue, cell: (r) => formatINR(r.revenue) },
            ]} />
          })()}
        </TabsContent>
        <TabsContent value="agent">
          {(() => {
            const rows = agents.filter((a) => !agentId || a.id === agentId).map((a) => {
              const inv = invoices.filter((i) => i.agentId === a.id)
              return { a, n: new Set(inv.map((i) => i.customerId)).size, billed: sum(inv.map((i) => i.currentBill)), collected: sum(db.payments.filter((p) => p.agentId === a.id).map((p) => p.amount)), due: sum(inv.map(invoiceRemaining)) }
            })
            return <Report chart={(r) => {
              const billed = sum(r.map((x) => x.billed))
              const collected = sum(r.map((x) => x.collected))
              const best = r.filter((x) => x.billed > 0).sort((a, b) => b.collected / b.billed - a.collected / a.billed)[0]
              return (
                <KpiStrip
                  items={[
                    { label: 'Billed', value: formatINR(billed, true), hint: `${r.length} agents` },
                    { label: 'Collected', value: formatINR(collected, true), hint: `${sharePct(collected, billed)} of billing` },
                    { label: 'Outstanding', value: formatINR(sum(r.map((x) => x.due)), true), tone: 'critical' },
                    { label: 'Best collection', value: best?.a.name ?? '—', hint: best ? sharePct(best.collected, best.billed) : undefined },
                  ]}
                />
              )
            }} rows={rows} rowKey={(r) => r.a.id} name="agent-revenue" columns={[
              { key: 'a', header: 'Agent', sort: (r) => r.a.name, cell: (r) => <b>{r.a.name}</b>, csv: (r) => r.a.name },
              { key: 'n', header: 'Billed customers', align: 'right', sort: (r) => r.n, cell: (r) => r.n },
              { key: 'b', header: 'Billed', align: 'right', sort: (r) => r.billed, cell: (r) => formatINR(r.billed) },
              { key: 'c', header: 'Collected', align: 'right', sort: (r) => r.collected, cell: (r) => formatINR(r.collected) },
              { key: 'd', header: 'Outstanding', align: 'right', sort: (r) => r.due, cell: (r) => <b className="text-destructive">{formatINR(r.due)}</b> },
            ]} />
          })()}
        </TabsContent>
        <TabsContent value="outstanding">
          <Report
            rows={custs.map((c) => ({ c, due: customerOutstanding(db, c.id), area: chainByLevel(db, c.areaId).area?.name ?? '' })).filter((r) => r.due > 0)}
            rowKey={(r) => r.c.id}
            name="customer-outstanding"
            columns={[
              { key: 'c', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <b>{r.c.name}</b>, csv: (r) => r.c.name },
              { key: 'code', header: 'Code', sort: (r) => r.c.code, cell: (r) => r.c.code },
              { key: 'm', header: 'Mobile', sort: (r) => r.c.mobile, cell: (r) => r.c.mobile },
              { key: 'ar', header: 'Area', sort: (r) => r.area, cell: (r) => r.area },
              { key: 'ag', header: 'Agent', sort: (r) => userName(db, r.c.agentId), cell: (r) => userName(db, r.c.agentId) },
              { key: 'd', header: 'Outstanding', align: 'right', sort: (r) => r.due, cell: (r) => <b className="text-destructive">{formatINR(r.due)}</b> },
            ]}
          />
        </TabsContent>
        <TabsContent value="collection">
          <Report
            chart={() => {
              const total = sum(pays.map((p) => p.amount))
              const days = eachDay(from, to)
              const methods = Object.entries(groupBy(pays, (p) => p.method)).map(([m, ps]) => ({ m, v: sum(ps.map((p) => p.amount)) })).sort((a, b) => b.v - a.v)
              return (
                <>
                  <KpiStrip
                    items={[
                      { label: 'Collected', value: formatINR(total, true), hint: `${pays.length} receipts` },
                      { label: 'Daily average', value: formatINR(total / Math.max(1, days.length), true), hint: `${days.length} days` },
                      { label: 'Average receipt', value: formatINR(total / Math.max(1, pays.length), true) },
                      { label: 'Top method', value: methods[0]?.m ?? '—', hint: methods[0] ? `${sharePct(methods[0].v, total)} · ${formatINR(methods[0].v, true)}` : undefined },
                    ]}
                  />
                  <LineChart className="mt-4" data={days.map((d) => ({ day: fmtShort(d), Collected: sum(pays.filter((p) => p.date === d).map((p) => p.amount)) }))} x="day" money series={[{ key: 'Collected', name: 'Collected' }]} />
                </>
              )
            }}
            rows={pays}
            rowKey={(p) => p.id}
            name="payment-collection"
            columns={[
              { key: 'd', header: 'Date', sort: (p) => p.at, cell: (p) => fmtDate(p.date) },
              { key: 'r', header: 'Receipt', sort: (p) => p.receiptNo, cell: (p) => p.receiptNo },
              { key: 'c', header: 'Customer', sort: (p) => userName(db, p.customerId), cell: (p) => userName(db, p.customerId) },
              { key: 'm', header: 'Method', sort: (p) => p.method, cell: (p) => `${p.method}${p.simulated ? ' (demo)' : ''}` },
              { key: 'b', header: 'Collected by', sort: (p) => userName(db, p.collectedBy), cell: (p) => userName(db, p.collectedBy) },
              { key: 'a', header: 'Amount', align: 'right', sort: (p) => p.amount, cell: (p) => <b>{formatINR(p.amount)}</b> },
            ]}
          />
        </TabsContent>
        <TabsContent value="profit">
          {(() => {
            const lines = invoices.filter((i) => i.periodEnd >= from && i.periodStart <= to).flatMap((i) => i.lines)
            const rows = Object.entries(groupBy(lines, (l) => l.productId)).map(([pid, ls]) => {
              const purchase = sum(ls.map((l) => l.quantity * l.purchasePrice))
              const agentV = sum(ls.map((l) => l.quantity * l.agentPrice))
              const cust = sum(ls.map((l) => l.amount))
              return { pid, name: db.products.find((p) => p.id === pid)?.name ?? '', purchase, agentV, cust, agency: round2(agentV - purchase), agentM: round2(cust - agentV) }
            })
            return <Report chart={(r) => {
              const cust = sum(r.map((x) => x.cust))
              const agentM = sum(r.map((x) => x.agentM))
              const agency = sum(r.map((x) => x.agency))
              return (
                <KpiStrip
                  items={[
                    { label: 'Customer value', value: formatINR(cust, true), hint: `${r.length} titles` },
                    { label: 'Agent margin', value: formatINR(agentM, true), hint: `${sharePct(agentM, cust)} of sales`, tone: 'good' },
                    // Purchase prices and the agency margin are the main agency's figures (same rule as the table).
                    ...(actor.role === 'admin' ? [{ label: 'Agency margin', value: formatINR(agency, true), hint: `${sharePct(agency, cust)} of sales`, tone: 'good' as const }] : []),
                    { label: 'Agent value', value: formatINR(sum(r.map((x) => x.agentV)), true) },
                  ]}
                />
              )
            }} rows={rows} rowKey={(r) => r.pid} name="profit-analysis" columns={[
              { key: 'n', header: 'Product', sort: (r) => r.name, cell: (r) => <b>{r.name}</b>, csv: (r) => r.name },
              ...(actor.role === 'admin' ? [{ key: 'p', header: 'Purchase value', align: 'right' as const, sort: (r: (typeof rows)[number]) => r.purchase, cell: (r: (typeof rows)[number]) => formatINR(r.purchase) }] : []),
              { key: 'a', header: 'Agent value', align: 'right', sort: (r) => r.agentV, cell: (r) => formatINR(r.agentV) },
              { key: 'c', header: 'Customer value', align: 'right', sort: (r) => r.cust, cell: (r) => formatINR(r.cust) },
              ...(actor.role === 'admin' ? [{ key: 'am', header: 'Agency margin', align: 'right' as const, sort: (r: (typeof rows)[number]) => r.agency, cell: (r: (typeof rows)[number]) => <span className="text-success">{formatINR(r.agency)}</span> }] : []),
              { key: 'gm', header: 'Agent margin', align: 'right', sort: (r) => r.agentM, cell: (r) => <span className="text-info">{formatINR(r.agentM)}</span> },
            ]} />
          })()}
        </TabsContent>
        <TabsContent value="stock">
          {(() => {
            const entries = Object.values(db.stock).filter((e) => e.date >= from && e.date <= to && (!agentId || e.agentId === agentId) && agents.some((a) => a.id === e.agentId))
            const rows = Object.entries(groupBy(entries, (e) => `${e.productId}|${e.agentId}`)).map(([k, es]) => {
              const [pid, aid] = k.split('|')
              const last = es.sort((a, b) => (a.date < b.date ? 1 : -1))[0]!
              return { k, product: db.products.find((p) => p.id === pid)?.name ?? '', agent: userName(db, aid), received: sum(es.map(available)), distributed: sum(es.map((e) => e.distributed)), returned: sum(es.map((e) => e.returned)), damaged: sum(es.map((e) => e.damaged)), closing: remaining(last), areas: db.agents.find((a) => a.id === aid)?.areaIds.map((id) => db.locations.find((l) => l.id === id)?.name).join(', ') ?? '' }
            })
            return <Report rows={rows} rowKey={(r) => r.k} name="stock-summary" columns={[
              { key: 'p', header: 'Product', sort: (r) => r.product, cell: (r) => <b>{r.product}</b>, csv: (r) => r.product },
              { key: 'a', header: 'Agent', sort: (r) => r.agent, cell: (r) => r.agent },
              { key: 'ar', header: 'Distribution area', cell: (r) => <span className="text-[12.5px] text-muted-foreground">{r.areas}</span>, csv: (r) => r.areas },
              { key: 'r', header: 'Received', align: 'right', sort: (r) => r.received, cell: (r) => formatNum(r.received) },
              { key: 'd', header: 'Distributed', align: 'right', sort: (r) => r.distributed, cell: (r) => formatNum(r.distributed) },
              { key: 're', header: 'Returned', align: 'right', sort: (r) => r.returned, cell: (r) => r.returned },
              { key: 'dm', header: 'Damaged', align: 'right', sort: (r) => r.damaged, cell: (r) => r.damaged },
              { key: 'c', header: 'Closing', align: 'right', sort: (r) => r.closing, cell: (r) => <b>{r.closing}</b> },
            ]} />
          })()}
        </TabsContent>
        <TabsContent value="delivery">
          {(() => {
            const routes = db.routes.filter((r) => !agentId || r.agentId === agentId).filter((r) => agents.some((a) => a.id === r.agentId))
            const rows = routes.map((r) => {
              const ids = new Set(r.stops.map((s) => s.customerId))
              const os = occ.filter((o) => ids.has(o.customerId) && o.status !== 'holiday' && o.status !== 'paused' && o.date < todayISO())
              const d = os.filter((o) => o.status === 'delivered').length
              const m = os.filter((o) => o.status === 'missed').length
              return { r, total: os.length, d, m, p: os.length - d - m, rate: os.length ? (d / os.length) * 100 : 0 }
            })
            return <Report chart={(rs) => {
              const total = sum(rs.map((x) => x.total))
              const d = sum(rs.map((x) => x.d))
              const m = sum(rs.map((x) => x.m))
              return (
                <KpiStrip
                  items={[
                    { label: 'Scheduled', value: formatNum(total), hint: `${rs.length} routes` },
                    { label: 'Delivered', value: formatNum(d), hint: `${sharePct(d, total)} success`, tone: 'good' },
                    { label: 'Missed', value: formatNum(m), hint: sharePct(m, total), tone: m ? 'critical' : undefined },
                    { label: 'Unmarked', value: formatNum(total - d - m), hint: sharePct(total - d - m, total), tone: total - d - m ? 'warning' : undefined },
                  ]}
                />
              )
            }} rows={rows} rowKey={(x) => x.r.id} name="delivery-performance" columns={[
              { key: 'r', header: 'Route', sort: (x) => x.r.name, cell: (x) => <b>{x.r.code} · {x.r.name}</b>, csv: (x) => x.r.name },
              { key: 'e', header: 'Executive', sort: (x) => userName(db, x.r.executiveId), cell: (x) => userName(db, x.r.executiveId) },
              { key: 't', header: 'Scheduled', align: 'right', sort: (x) => x.total, cell: (x) => x.total },
              { key: 'd', header: 'Delivered', align: 'right', sort: (x) => x.d, cell: (x) => x.d },
              { key: 'm', header: 'Missed', align: 'right', sort: (x) => x.m, cell: (x) => x.m },
              { key: 'rate', header: 'Success rate', align: 'right', sort: (x) => x.rate, cell: (x) => <b>{x.rate.toFixed(1)}%</b> },
            ]} />
          })()}
        </TabsContent>
        <TabsContent value="slip">
          <DeliverySlip occ={occ} />
        </TabsContent>
      </Tabs>
    </>
  )
}

function Report<T>({ rows, columns, rowKey, name, chart }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; name: string; chart?: (rows: T[]) => React.ReactNode }) {
  return (
    <div className="space-y-4">
      {chart && rows.length > 0 && (
        <Card>
          <CardBody>{chart(rows)}</CardBody>
        </Card>
      )}
      <DataTable rows={rows} columns={columns} rowKey={rowKey} exportName={name} pageSize={25} />
    </div>
  )
}

function DailySales({ occ, from, to }: { occ: ReturnType<typeof occurrences>; from: string; to: string }) {
  const { db } = useScope()
  const delivered = occ.filter((o) => o.status === 'delivered')
  const rows = eachDay(from, to)
    .reverse()
    .map((d) => {
      const os = delivered.filter((o) => o.date === d)
      const value = sum(os.map((o) => o.quantity * (resolvePrice(db, o.productId, d, db.customers.find((c) => c.id === o.customerId)?.agentId)?.customerPrice ?? 0)))
      return { d, copies: sum(os.map((o) => o.quantity)), customers: new Set(os.map((o) => o.customerId)).size, value }
    })
  return (
    <Report
      chart={(r) => {
        const total = sum(r.map((x) => x.value))
        const best = r.slice().sort((a, b) => b.value - a.value)[0]
        return (
          <>
            <KpiStrip
              items={[
                { label: 'Sales value', value: formatINR(total, true), hint: `${r.length} days` },
                { label: 'Copies delivered', value: formatNum(sum(r.map((x) => x.copies))) },
                { label: 'Daily average', value: formatINR(total / Math.max(1, r.length), true) },
                { label: 'Best day', value: best && best.value > 0 ? fmtShort(best.d) : '—', hint: best && best.value > 0 ? formatINR(best.value, true) : undefined },
              ]}
            />
            <LineChart className="mt-4" data={r.slice().reverse().map((x) => ({ day: fmtShort(x.d), Sales: x.value }))} x="day" money series={[{ key: 'Sales', name: 'Delivered value' }]} />
          </>
        )
      }}
      rows={rows}
      rowKey={(r) => r.d}
      name="daily-sales"
      columns={[
        { key: 'd', header: 'Date', sort: (r) => r.d, cell: (r) => <b>{fmtDate(r.d)}</b>, csv: (r) => r.d },
        { key: 'c', header: 'Copies delivered', align: 'right', sort: (r) => r.copies, cell: (r) => formatNum(r.copies) },
        { key: 'cu', header: 'Customers', align: 'right', sort: (r) => r.customers, cell: (r) => r.customers },
        { key: 'v', header: 'Sales value', align: 'right', sort: (r) => r.value, cell: (r) => formatINR(r.value) },
      ]}
    />
  )
}

/** Delivery slip — quantity per product, filterable by agent / executive / area / route (as in the legacy system). */
function DeliverySlip({ occ }: { occ: ReturnType<typeof occurrences> }) {
  const { db, routes, executives } = useScope()
  const [routeId, setRouteId] = React.useState('')
  const [execId, setExecId] = React.useState('')
  const [areaId, setAreaId] = React.useState('')
  const filtered = occ.filter((o) => {
    if (o.status === 'holiday' || o.status === 'paused') return false
    const c = db.customers.find((x) => x.id === o.customerId)!
    const r = db.routes.find((x) => x.id === c.routeId)
    return (!routeId || c.routeId === routeId) && (!execId || r?.executiveId === execId) && (!areaId || c.areaId === areaId)
  })
  const rows = Object.entries(groupBy(filtered, (o) => o.productId)).map(([pid, os]) => ({ pid, name: db.products.find((p) => p.id === pid)?.name ?? '', qty: sum(os.map((o) => o.quantity)) }))
  const areas = [...new Set(db.customers.map((c) => c.areaId))].map((id) => db.locations.find((l) => l.id === id)!).filter(Boolean)
  const printSlip = async () => {
    const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF()
    doc.setFontSize(14)
    doc.text(`${db.settings.agencyName} — Delivery slip`, 14, 16)
    doc.setFontSize(9)
    doc.text([`Route: ${routes.find((r) => r.id === routeId)?.name ?? 'All'}   Executive: ${userName(db, execId || null)}   Area: ${areas.find((a) => a.id === areaId)?.name ?? 'All'}`], 14, 23)
    at.default(doc, { startY: 28, head: [['#', 'Product', 'Quantity']], body: [...rows.map((r, i) => [i + 1, r.name, r.qty]), ['', 'Total', sum(rows.map((r) => r.qty))]] })
    doc.save('delivery-slip.pdf')
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <NativeSelect value={routeId} onChange={(e) => setRouteId(e.target.value)} className="h-10 w-52" aria-label="Route">
          <option value="">All routes</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={execId} onChange={(e) => setExecId(e.target.value)} className="h-10 w-48" aria-label="Delivery executive">
          <option value="">All executives</option>
          {executives.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={areaId} onChange={(e) => setAreaId(e.target.value)} className="h-10 w-44" aria-label="Area">
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <Button variant="outline" onClick={printSlip} disabled={!rows.length}>
          <FileDown /> PDF
        </Button>
      </div>
      <DataTable
        rows={rows}
        rowKey={(r) => r.pid}
        exportName="delivery-slip"
        columns={[
          { key: 'n', header: 'Product name', sort: (r) => r.name, cell: (r) => <b>{r.name}</b>, csv: (r) => r.name },
          { key: 'q', header: 'Quantity', align: 'right', sort: (r) => r.qty, cell: (r) => formatNum(r.qty) },
        ]}
      />
      <div className="text-right font-display text-xl font-semibold text-primary">Total: {formatNum(sum(rows.map((r) => r.qty)))} copies</div>
    </div>
  )
}
