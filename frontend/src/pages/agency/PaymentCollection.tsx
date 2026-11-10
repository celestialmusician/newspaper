import { HandCoins, Receipt, Search } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect } from '@/components/ui/form'
import { Badge, PageHeader } from '@/components/ui/misc'
import { DataTable, type Column } from '@/components/ui/data-table'
import { invoiceRemaining } from '@/domain/billing'
import type { Invoice, PaymentMethod } from '@/domain/types'
import { errorMessage, useActor, useData } from '@/hooks/app'
import { fmtDate } from '@/lib/dates'
import { downloadReceiptPDF } from '@/lib/pdf'
import { formatINR, sum, uid } from '@/lib/utils'
import { payments as api } from '@/services/api'
import { QueryDesk } from '../console/shared'

type Kind = '' | 'route' | 'boy' | 'customer' | 'sub'
const METHODS: PaymentMethod[] = ['Cash', 'Agent Collection', 'Delivery Executive Collection']

/** Payment Collection Entry: find bills by route, delivery boy, customer or sub-agent, tick them and record the money. */
export default function PaymentCollection() {
  const db = useData()
  const actor = useActor()
  const [kind, setKind] = React.useState<Kind>('')
  const [target, setTarget] = React.useState('')
  const [applied, setApplied] = React.useState<{ kind: Kind; target: string } | null>(null)
  const [picked, setPicked] = React.useState<Set<string>>(new Set())
  const [method, setMethod] = React.useState<PaymentMethod>('Cash')
  const [busy, setBusy] = React.useState(false)

  const routes = db.routes.filter((r) => r.agentId === actor.userId)
  const boys = db.executives.filter((e) => e.agentId === actor.userId)
  const customers = db.customers.filter((c) => c.agentId === actor.userId)

  const rows = React.useMemo(() => {
    if (!applied) return []
    const boyRoutes = new Set(routes.filter((r) => r.executiveId === applied.target).map((r) => r.id))
    const match = (cid: string) => {
      const c = customers.find((x) => x.id === cid)
      if (!c) return false
      if (applied.kind === 'route') return !applied.target || c.routeId === applied.target
      if (applied.kind === 'boy') return !applied.target || (!!c.routeId && boyRoutes.has(c.routeId))
      if (applied.kind === 'customer') return !applied.target || c.id === applied.target
      return !!c.subAgent && (!applied.target || c.id === applied.target)
    }
    return db.invoices
      .filter((i) => i.agentId === actor.userId && match(i.customerId))
      .map((i, n) => {
        const pay = db.payments.filter((p) => p.allocations.some((a) => a.invoiceId === i.id)).sort((a, b) => b.at.localeCompare(a.at))[0]
        return { i, n: n + 1, customer: customers.find((c) => c.id === i.customerId)?.name ?? '', balance: invoiceRemaining(i), pay }
      })
      .sort((a, b) => (a.i.issuedOn < b.i.issuedOn ? 1 : -1))
      .map((r, n) => ({ ...r, n: n + 1 }))
  }, [applied, db, actor.userId, routes, customers])
  type Row = (typeof rows)[number]

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const selected = rows.filter((r) => picked.has(r.i.id) && r.balance > 0)
  const total = sum(selected.map((r) => r.balance))

  const collect = async () => {
    setBusy(true)
    const byCustomer = new Map<string, Invoice[]>()
    for (const r of selected) byCustomer.set(r.i.customerId, [...(byCustomer.get(r.i.customerId) ?? []), r.i])
    let ok = 0
    for (const [customerId, list] of byCustomer) {
      try {
        await api.collect({ customerId, amount: sum(list.map(invoiceRemaining)), method, idempotencyKey: uid('pay'), note: 'Payment Collection Entry' })
        ok++
      } catch (e) {
        toast.error(errorMessage(e))
      }
    }
    setBusy(false)
    if (ok) {
      toast.success(`${formatINR(total)} recorded for ${ok} customer${ok > 1 ? 's' : ''}`)
      setPicked(new Set())
    }
  }

  const cols: Column<Row>[] = [
    { key: 'pick', header: '', cell: (r) => <input type="checkbox" className="size-[18px] accent-[var(--brand)]" disabled={r.balance <= 0} checked={picked.has(r.i.id)} onChange={() => toggle(r.i.id)} aria-label={`Select ${r.i.number}`} />, className: 'w-10' },
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14', hideOnMobile: true },
    { key: 'no', header: 'Bill No', sort: (r) => r.i.number, cell: (r) => <span className="font-mono text-[13px]">{r.i.number}</span>, csv: (r) => r.i.number },
    { key: 'date', header: 'Bill Date', sort: (r) => r.i.issuedOn, cell: (r) => fmtDate(r.i.issuedOn), csv: (r) => r.i.issuedOn, hideOnMobile: true },
    { key: 'cust', header: 'Customer Name', sort: (r) => r.customer, cell: (r) => <span className="font-semibold">{r.customer}</span>, csv: (r) => r.customer },
    { key: 'pay', header: 'Payable Amount', align: 'right', sort: (r) => r.i.currentBill, cell: (r) => <span className="tabular">{formatINR(r.i.currentBill)}</span>, csv: (r) => r.i.currentBill },
    { key: 'paid', header: 'Paid Amount', align: 'right', sort: (r) => r.i.paid, cell: (r) => <span className="tabular text-success">{formatINR(r.i.paid)}</span>, csv: (r) => r.i.paid },
    { key: 'bal', header: 'Balance Amount', align: 'right', sort: (r) => r.balance, cell: (r) => <span className={r.balance ? 'tabular font-semibold text-destructive' : 'tabular'}>{formatINR(r.balance)}</span>, csv: (r) => r.balance },
    { key: 'by', header: 'Collected By', cell: (r) => (r.pay ? db.executives.find((e) => e.id === r.pay!.collectedBy)?.name ?? db.agents.find((a) => a.id === r.pay!.collectedBy)?.name ?? 'Customer' : '—'), csv: (r) => r.pay?.collectedBy ?? '', hideOnMobile: true },
    { key: 'cd', header: 'Collected Date', sort: (r) => r.pay?.date ?? '', cell: (r) => (r.pay ? fmtDate(r.pay.date) : '—'), csv: (r) => r.pay?.date ?? '', hideOnMobile: true },
    { key: 'rc', header: 'Go To Receipt', cell: (r) => (r.pay ? <Button size="sm" variant="outline" onClick={() => void downloadReceiptPDF(db, r.pay!.id)}><Receipt /> {r.pay.receiptNo}</Button> : <span className="text-muted-foreground">—</span>) },
  ]

  const targets =
    kind === 'route'
      ? routes.map((r) => ({ id: r.id, label: `${r.name} (${r.code})` }))
      : kind === 'boy'
        ? boys.map((b) => ({ id: b.id, label: b.name }))
        : kind === 'customer'
          ? customers.map((c) => ({ id: c.id, label: `${c.name} · ${c.mobile}` }))
          : kind === 'sub'
            ? customers.filter((c) => c.subAgent).map((c) => ({ id: c.id, label: c.name }))
            : []
  const labelFor = { route: 'Route', boy: 'Delivery Boy', customer: 'Customer', sub: 'SubAgent' } as const

  return (
    <>
      <PageHeader kicker="Transactions" title="Payment Collection Entry" description="Search the bills, tick the ones paid and record the collection." />
      <QueryDesk
        filters={
          <>
          <form
            className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,16rem))_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              if (!kind) return toast.error('Select the type first.')
              setApplied({ kind, target })
              setPicked(new Set())
            }}
          >
            <Field label="Select Type" required>
              <NativeSelect
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind)
                  setTarget('')
                }}
              >
                <option value="">Select Type</option>
                <option value="route">Route</option>
                <option value="boy">Delivery Boy</option>
                <option value="customer">Customer</option>
                <option value="sub">SubAgent</option>
              </NativeSelect>
            </Field>
            {kind && (
              <Field label={labelFor[kind]} required>
                <NativeSelect value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">All</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Button type="submit" className="w-fit">
              <Search /> Search
            </Button>
          </form>
          </>
        }
        summary={<>Payment Verification List</>}
      >
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => r.i.id}
          pageSize={25}
          exportName="payment-collection"
          mobileTitle={(r) => <span className="font-semibold">{r.customer}</span>}
          empty={{ icon: HandCoins, title: applied ? 'No bills for this selection' : 'Choose a type and Search' }}
          toolbar={
            selected.length ? (
              <>
                <Badge tone="navy">
                  {selected.length} selected · {formatINR(total)}
                </Badge>
                <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="h-10 w-48" aria-label="Payment method">
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </NativeSelect>
                <Button size="sm" loading={busy} onClick={() => void collect()}>
                  <HandCoins /> Record collection
                </Button>
              </>
            ) : undefined
          }
        />
      </QueryDesk>
    </>
  )
}
