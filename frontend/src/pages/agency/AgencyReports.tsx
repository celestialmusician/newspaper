import { FileBarChart } from 'lucide-react'
import * as React from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { Badge, PageHeader, StatusBadge } from '@/components/ui/misc'
import { customerOutstanding, invoiceRemaining } from '@/domain/billing'
import { areaLabel } from '@/domain/locations'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import { FREQUENCY_META } from '@/domain/types'
import { resolvePrice } from '@/domain/pricing'
import { useActor, useData } from '@/hooks/app'
import { fmtDate, fmtDateTime, monthStartISO, todayISO } from '@/lib/dates'
import { formatINR, formatMobile, sum } from '@/lib/utils'
import { subTypeOf } from '../console/ManageProducts'
import { QueryDesk } from '../console/shared'

interface Filters {
  from: string
  to: string
  route: string
  boy: string
}

const TITLES: Record<string, { title: string; description: string }> = {
  'customer-data': { title: 'Customer Data Listing', description: 'Every customer with contact, route and account details.' },
  'customer-subscription': { title: 'Customer Wise Subscription', description: 'What each customer takes, from when and until when.' },
  'payment-due': { title: 'Payment Due', description: 'Customers with unpaid bills, oldest first.' },
  'payment-collected': { title: 'Payment Collected', description: 'Receipts recorded in the period.' },
  'bill-details': { title: 'Bill Details', description: 'Bills raised in the period with discounts, handling charges and balances.' },
  'product-list': { title: 'Product List', description: 'Titles you can subscribe customers to, with current rates.' },
  'transfer-delivery': { title: 'Transfer Delivery Boy', description: 'Routes handed from one delivery boy to another.' },
  'customer-report': { title: 'Customer Report', description: 'Billed, paid and due for every customer.' },
  sales: { title: 'Sales Report', description: 'Subscriptions started in the period and what the titles earned.' },
}

function ReportTable<T>({ name, rows, columns, search, rowKey, title }: { name: string; rows: T[]; columns: Column<T>[]; search?: (r: T) => string; rowKey: (r: T) => string; title?: (r: T) => React.ReactNode }) {
  return <DataTable rows={rows} columns={columns} rowKey={rowKey} search={search} exportName={name} pageSize={25} mobileTitle={title} empty={{ icon: FileBarChart, title: 'Nothing to report for this selection' }} />
}

/** Reports of the agent menu. Every report shares the same filter bar and an exportable list. */
export default function AgencyReports() {
  const { name = '' } = useParams()
  const db = useData()
  const actor = useActor()
  const today = todayISO()
  const [f, setF] = React.useState<Filters>({ from: monthStartISO(today), to: today, route: '', boy: '' })
  const meta = TITLES[name]
  if (!meta) return <Navigate to="/reports/customer-data" replace />

  const routes = db.routes.filter((r) => r.agentId === actor.userId)
  const boys = db.executives.filter((e) => e.agentId === actor.userId)
  const boyRoutes = new Set(routes.filter((r) => !f.boy || r.executiveId === f.boy).map((r) => r.id))
  const customers = db.customers.filter((c) => c.agentId === actor.userId && (!f.route || c.routeId === f.route) && (!f.boy || (!!c.routeId && boyRoutes.has(c.routeId))))
  const ids = new Set(customers.map((c) => c.id))
  const routeName = (id: string | null) => routes.find((r) => r.id === id)?.name ?? '—'
  const boyName = (routeId: string | null) => boys.find((b) => b.id === routes.find((r) => r.id === routeId)?.executiveId)?.name ?? '—'
  const dated = ['payment-collected', 'bill-details', 'sales'].includes(name)
  const byPeople = !['product-list', 'transfer-delivery'].includes(name)
  const set = (k: keyof Filters, v: string) => setF((x) => ({ ...x, [k]: v }))

  let body: React.ReactNode = null
  switch (name) {
    case 'customer-data': {
      const rows = customers.map((c, i) => ({ c, n: i + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.c.id}
          title={(r) => <span className="font-semibold">{r.n}. {r.c.name}</span>}
          search={(r) => `${r.c.name} ${r.c.mobile} ${r.c.code} ${r.c.serialNo ?? ''}`}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14' },
            { key: 'name', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <span className="font-semibold">{r.c.name}</span>, csv: (r) => r.c.name, hideOnMobile: true },
            { key: 'code', header: 'Code', sort: (r) => r.c.code, cell: (r) => r.c.code },
            { key: 'serial', header: 'Serial No', sort: (r) => r.c.serialNo ?? '', cell: (r) => r.c.serialNo || '—', csv: (r) => r.c.serialNo ?? '' },
            { key: 'mobile', header: 'Mobile', cell: (r) => formatMobile(r.c.mobile), csv: (r) => r.c.mobile },
            { key: 'wa', header: 'WhatsApp', cell: (r) => (r.c.whatsapp ? formatMobile(r.c.whatsapp) : '—'), csv: (r) => r.c.whatsapp ?? '', hideOnMobile: true },
            { key: 'area', header: 'Area', cell: (r) => areaLabel(db, r.c.areaId), csv: (r) => areaLabel(db, r.c.areaId), hideOnMobile: true },
            { key: 'route', header: 'Route', sort: (r) => routeName(r.c.routeId), cell: (r) => routeName(r.c.routeId), csv: (r) => routeName(r.c.routeId) },
            { key: 'boy', header: 'Delivery Boy', cell: (r) => boyName(r.c.routeId), csv: (r) => boyName(r.c.routeId), hideOnMobile: true },
            { key: 'dep', header: 'Deposit', align: 'right', sort: (r) => r.c.securityDeposit, cell: (r) => formatINR(r.c.securityDeposit), csv: (r) => r.c.securityDeposit, hideOnMobile: true },
            { key: 'st', header: 'Status', sort: (r) => r.c.status, cell: (r) => <StatusBadge status={r.c.status} />, csv: (r) => r.c.status },
          ]}
        />
      )
      break
    }
    case 'customer-subscription': {
      const rows = db.subscriptions
        .filter((s) => ids.has(s.customerId))
        .map((s) => ({ s, c: db.customers.find((c) => c.id === s.customerId)!, p: db.products.find((p) => p.id === s.productId), st: deriveSubscriptionStatus(s) }))
        .sort((a, b) => a.c.name.localeCompare(b.c.name))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.s.id}
          title={(r) => <span className="font-semibold">{r.c.name}</span>}
          search={(r) => `${r.c.name} ${r.p?.name ?? ''}`}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'c', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <span className="font-semibold">{r.c.name}</span>, csv: (r) => r.c.name, hideOnMobile: true },
            { key: 'p', header: 'Product', sort: (r) => r.p?.name ?? '', cell: (r) => r.p?.name, csv: (r) => r.p?.name ?? '' },
            { key: 'f', header: 'Frequency', cell: (r) => (r.s.dayQuantities ? 'Individual Day' : FREQUENCY_META[r.s.frequency].label), csv: (r) => r.s.frequency },
            { key: 'q', header: 'Qty', align: 'right', sort: (r) => r.s.quantity, cell: (r) => r.s.quantity, csv: (r) => r.s.quantity },
            { key: 'from', header: 'Start', sort: (r) => r.s.startDate, cell: (r) => fmtDate(r.s.startDate), csv: (r) => r.s.startDate },
            { key: 'to', header: 'End', cell: (r) => fmtDate(r.s.cancelledOn ?? r.s.endDate), csv: (r) => r.s.cancelledOn ?? r.s.endDate ?? '', hideOnMobile: true },
            { key: 'st', header: 'Status', sort: (r) => r.st, cell: (r) => <StatusBadge status={r.st} />, csv: (r) => r.st },
          ]}
        />
      )
      break
    }
    case 'payment-due': {
      const rows = customers
        .map((c) => {
          const open = db.invoices.filter((i) => i.customerId === c.id && invoiceRemaining(i) > 0)
          return { c, open: open.length, oldest: open.map((i) => i.dueDate).sort()[0], due: customerOutstanding(db, c.id) }
        })
        .filter((r) => r.due > 0)
        .sort((a, b) => (a.oldest ?? '').localeCompare(b.oldest ?? ''))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.c.id}
          title={(r) => <span className="font-semibold">{r.c.name}</span>}
          search={(r) => `${r.c.name} ${r.c.mobile}`}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'c', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <span className="font-semibold">{r.c.name}</span>, csv: (r) => r.c.name, hideOnMobile: true },
            { key: 'm', header: 'Mobile', cell: (r) => formatMobile(r.c.mobile), csv: (r) => r.c.mobile },
            { key: 'r', header: 'Route', cell: (r) => routeName(r.c.routeId), csv: (r) => routeName(r.c.routeId), hideOnMobile: true },
            { key: 'b', header: 'Open bills', align: 'right', sort: (r) => r.open, cell: (r) => r.open, csv: (r) => r.open },
            { key: 'o', header: 'Oldest due date', sort: (r) => r.oldest ?? '', cell: (r) => fmtDate(r.oldest), csv: (r) => r.oldest ?? '' },
            { key: 'd', header: 'Due Amount', align: 'right', sort: (r) => r.due, cell: (r) => <span className="tabular font-semibold text-destructive">{formatINR(r.due)}</span>, csv: (r) => r.due },
          ]}
        />
      )
      break
    }
    case 'payment-collected': {
      const rows = db.payments
        .filter((p) => ids.has(p.customerId) && p.date >= f.from && p.date <= f.to)
        .map((p) => ({ p, c: db.customers.find((c) => c.id === p.customerId)!, by: db.executives.find((e) => e.id === p.collectedBy)?.name ?? db.agents.find((a) => a.id === p.collectedBy)?.name ?? 'Customer' }))
        .sort((a, b) => b.p.at.localeCompare(a.p.at))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <>
          <ReportTable
  name={name}
            rows={rows}
            rowKey={(r) => r.p.id}
            title={(r) => <span className="font-semibold">{r.c.name}</span>}
            search={(r) => `${r.c.name} ${r.p.receiptNo}`}
            columns={[
              { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
              { key: 'rc', header: 'Receipt No', sort: (r) => r.p.receiptNo, cell: (r) => <span className="font-mono text-[13px]">{r.p.receiptNo}</span>, csv: (r) => r.p.receiptNo },
              { key: 'd', header: 'Date', sort: (r) => r.p.at, cell: (r) => fmtDate(r.p.date), csv: (r) => r.p.date },
              { key: 'c', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <span className="font-semibold">{r.c.name}</span>, csv: (r) => r.c.name, hideOnMobile: true },
              { key: 'm', header: 'Method', cell: (r) => r.p.method, csv: (r) => r.p.method, hideOnMobile: true },
              { key: 'by', header: 'Collected By', cell: (r) => r.by, csv: (r) => r.by, hideOnMobile: true },
              { key: 'a', header: 'Amount', align: 'right', sort: (r) => r.p.amount, cell: (r) => <span className="tabular font-semibold">{formatINR(r.p.amount)}</span>, csv: (r) => r.p.amount },
            ]}
          />
          <p className="mt-2 px-1 text-[13.5px] text-muted-foreground">
            Total collected: <b className="text-foreground">{formatINR(sum(rows.map((r) => r.p.amount)))}</b> in {rows.length} receipts
          </p>
        </>
      )
      break
    }
    case 'bill-details': {
      const rows = db.invoices
        .filter((i) => ids.has(i.customerId) && i.periodStart >= f.from && i.periodStart <= f.to)
        .map((i) => ({ i, c: db.customers.find((c) => c.id === i.customerId)!, bal: invoiceRemaining(i) }))
        .sort((a, b) => a.i.number.localeCompare(b.i.number))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.i.id}
          title={(r) => <span className="font-semibold">{r.i.number}</span>}
          search={(r) => `${r.c.name} ${r.i.number}`}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'no', header: 'Bill No', sort: (r) => r.i.number, cell: (r) => <span className="font-mono text-[13px]">{r.i.number}</span>, csv: (r) => r.i.number, hideOnMobile: true },
            { key: 'c', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <span className="font-semibold">{r.c.name}</span>, csv: (r) => r.c.name },
            { key: 'p', header: 'Period', cell: (r) => r.i.periodStart.slice(0, 7), csv: (r) => r.i.periodStart.slice(0, 7), hideOnMobile: true },
            { key: 's', header: 'Subtotal', align: 'right', sort: (r) => r.i.subtotal, cell: (r) => formatINR(r.i.subtotal), csv: (r) => r.i.subtotal, hideOnMobile: true },
            { key: 'dc', header: 'Discount', align: 'right', cell: (r) => formatINR(r.i.discount), csv: (r) => r.i.discount, hideOnMobile: true },
            { key: 'h', header: 'H Charge', align: 'right', cell: (r) => formatINR(r.i.handlingCharge), csv: (r) => r.i.handlingCharge, hideOnMobile: true },
            { key: 'b', header: 'Bill Amount', align: 'right', sort: (r) => r.i.currentBill, cell: (r) => <span className="tabular font-semibold">{formatINR(r.i.currentBill)}</span>, csv: (r) => r.i.currentBill },
            { key: 'bal', header: 'Balance', align: 'right', sort: (r) => r.bal, cell: (r) => formatINR(r.bal), csv: (r) => r.bal },
            { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.i.status} />, csv: (r) => r.i.status },
          ]}
        />
      )
      break
    }
    case 'product-list': {
      const rows = db.products
        .filter((p) => !p.ownerId || p.ownerId === actor.userId)
        .map((p) => ({ p, price: resolvePrice(db, p.id, today, p.ownerId ? null : actor.userId) }))
        .sort((a, b) => a.p.name.localeCompare(b.p.name))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.p.id}
          title={(r) => <span className="font-semibold">{r.p.name}</span>}
          search={(r) => `${r.p.name} ${r.p.billCode ?? r.p.code} ${r.p.company ?? ''}`}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'p', header: 'Product', sort: (r) => r.p.name, cell: (r) => <span className="font-semibold">{r.p.name}</span>, csv: (r) => r.p.name, hideOnMobile: true },
            { key: 'b', header: 'Bill Code', cell: (r) => r.p.billCode ?? r.p.code, csv: (r) => r.p.billCode ?? r.p.code },
            { key: 'co', header: 'Company', cell: (r) => r.p.company ?? r.p.publisher, csv: (r) => r.p.company ?? r.p.publisher, hideOnMobile: true },
            { key: 'l', header: 'Language', cell: (r) => r.p.language, csv: (r) => r.p.language, hideOnMobile: true },
            { key: 's', header: 'Subscription Type', cell: (r) => subTypeOf(r.p), csv: (r) => subTypeOf(r.p) },
            { key: 'pu', header: 'Purchase', align: 'right', cell: (r) => (r.price ? formatINR(r.price.purchasePrice) : '—'), csv: (r) => r.price?.purchasePrice ?? '', hideOnMobile: true },
            { key: 'sa', header: 'Sale Rate', align: 'right', sort: (r) => r.price?.customerPrice ?? 0, cell: (r) => (r.price ? formatINR(r.price.customerPrice) : <Badge tone="warning">No rate</Badge>), csv: (r) => r.price?.customerPrice ?? '' },
            { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.p.status} />, csv: (r) => r.p.status },
          ]}
        />
      )
      break
    }
    case 'transfer-delivery': {
      const mine = new Set(routes.map((r) => r.id))
      const rows = db.handovers
        .filter((h) => mine.has(h.routeId))
        .map((h) => ({ h, route: routes.find((r) => r.id === h.routeId)?.name ?? '', from: db.executives.find((e) => e.id === h.fromExecutiveId)?.name ?? 'Unassigned', to: db.executives.find((e) => e.id === h.toExecutiveId)?.name ?? '' }))
        .sort((a, b) => b.h.at.localeCompare(a.h.at))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.h.id}
          title={(r) => <span className="font-semibold">{r.route}</span>}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'r', header: 'Route', sort: (r) => r.route, cell: (r) => <span className="font-semibold">{r.route}</span>, csv: (r) => r.route, hideOnMobile: true },
            { key: 'f', header: 'From', cell: (r) => r.from, csv: (r) => r.from },
            { key: 't', header: 'To', cell: (r) => r.to, csv: (r) => r.to },
            { key: 'at', header: 'Date', sort: (r) => r.h.at, cell: (r) => fmtDateTime(r.h.at), csv: (r) => r.h.at },
            { key: 'nt', header: 'Note', cell: (r) => <span className="text-[13px] text-muted-foreground">{r.h.note ?? '—'}</span>, csv: (r) => r.h.note ?? '', hideOnMobile: true },
          ]}
        />
      )
      break
    }
    case 'customer-report': {
      const rows = customers
        .map((c) => {
          const invs = db.invoices.filter((i) => i.customerId === c.id)
          const pays = db.payments.filter((p) => p.customerId === c.id)
          return { c, subs: db.subscriptions.filter((s) => s.customerId === c.id && deriveSubscriptionStatus(s) === 'active').length, billed: sum(invs.map((i) => i.currentBill)), paid: sum(pays.map((p) => p.amount)), due: customerOutstanding(db, c.id), last: pays.map((p) => p.date).sort().at(-1) }
        })
        .sort((a, b) => a.c.name.localeCompare(b.c.name))
        .map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.c.id}
          title={(r) => <span className="font-semibold">{r.c.name}</span>}
          search={(r) => `${r.c.name} ${r.c.mobile}`}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'c', header: 'Customer', sort: (r) => r.c.name, cell: (r) => <span className="font-semibold">{r.c.name}</span>, csv: (r) => r.c.name, hideOnMobile: true },
            { key: 'su', header: 'Active subscriptions', align: 'right', sort: (r) => r.subs, cell: (r) => r.subs, csv: (r) => r.subs },
            { key: 'bi', header: 'Billed', align: 'right', sort: (r) => r.billed, cell: (r) => formatINR(r.billed), csv: (r) => r.billed },
            { key: 'pa', header: 'Paid', align: 'right', sort: (r) => r.paid, cell: (r) => formatINR(r.paid), csv: (r) => r.paid },
            { key: 'du', header: 'Due', align: 'right', sort: (r) => r.due, cell: (r) => <span className={r.due ? 'tabular font-semibold text-destructive' : 'tabular'}>{formatINR(r.due)}</span>, csv: (r) => r.due },
            { key: 'la', header: 'Last payment', sort: (r) => r.last ?? '', cell: (r) => fmtDate(r.last), csv: (r) => r.last ?? '', hideOnMobile: true },
          ]}
        />
      )
      break
    }
    case 'sales': {
      const subs = db.subscriptions.filter((s) => ids.has(s.customerId))
      const invs = db.invoices.filter((i) => ids.has(i.customerId) && i.periodStart >= f.from && i.periodStart <= f.to)
      const map = new Map<string, { name: string; subs: number; copies: number; amount: number }>()
      for (const s of subs.filter((x) => x.createdOn >= f.from && x.createdOn <= f.to)) {
        const name = db.products.find((p) => p.id === s.productId)?.name ?? '—'
        const e = map.get(s.productId) ?? { name, subs: 0, copies: 0, amount: 0 }
        e.subs++
        map.set(s.productId, e)
      }
      for (const l of invs.flatMap((i) => i.lines)) {
        const e = map.get(l.productId) ?? { name: l.productName, subs: 0, copies: 0, amount: 0 }
        e.copies += l.quantity
        e.amount += l.amount
        map.set(l.productId, e)
      }
      const rows = [...map.entries()].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.amount - a.amount).map((r, n) => ({ ...r, n: n + 1 }))
      body = (
        <ReportTable
  name={name}
          rows={rows}
          rowKey={(r) => r.id}
          title={(r) => <span className="font-semibold">{r.name}</span>}
          columns={[
            { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14', hideOnMobile: true },
            { key: 'p', header: 'Product', sort: (r) => r.name, cell: (r) => <span className="font-semibold">{r.name}</span>, csv: (r) => r.name, hideOnMobile: true },
            { key: 's', header: 'New subscriptions', align: 'right', sort: (r) => r.subs, cell: (r) => r.subs, csv: (r) => r.subs },
            { key: 'c', header: 'Copies billed', align: 'right', sort: (r) => r.copies, cell: (r) => r.copies, csv: (r) => r.copies },
            { key: 'a', header: 'Sales amount', align: 'right', sort: (r) => r.amount, cell: (r) => <span className="tabular font-semibold">{formatINR(r.amount)}</span>, csv: (r) => r.amount },
          ]}
        />
      )
      break
    }
  }

  return (
    <>
      <PageHeader kicker="Reports" title={meta.title} description={meta.description} />
      <QueryDesk
        filters={
          <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {dated && (
              <>
                <Field label="From Date">
                  <Input type="date" value={f.from} max={f.to} onChange={(e) => set('from', e.target.value)} />
                </Field>
                <Field label="To Date">
                  <Input type="date" value={f.to} min={f.from} onChange={(e) => set('to', e.target.value)} />
                </Field>
              </>
            )}
            {byPeople && (
              <>
                <Field label="Route">
                  <NativeSelect value={f.route} onChange={(e) => set('route', e.target.value)}>
                    <option value="">All routes</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Delivery Boy">
                  <NativeSelect value={f.boy} onChange={(e) => set('boy', e.target.value)}>
                    <option value="">All delivery boys</option>
                    {boys.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </>
            )}
            {!dated && !byPeople && <p className="text-[13.5px] text-muted-foreground">This report needs no filters.</p>}
          </div>
          </>
        }
      >
        {body}
      </QueryDesk>
    </>
  )
}
