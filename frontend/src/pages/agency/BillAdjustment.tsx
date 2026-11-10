import { BadgePercent } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { KeyValue, PageHeader } from '@/components/ui/misc'
import { areaLabel } from '@/domain/locations'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { fmtDateTime, todayISO } from '@/lib/dates'
import { formatINR, round2 } from '@/lib/utils'
import { billing } from '@/services/api'
import { FormCard, FormTable, RowActions } from '../console/shared'

const PREFIX = 'Bill adjustment'

/** Manage Bill Adjustment: correct one title's amount and the handling charge on a customer's bill for a month. */
export default function BillAdjustment() {
  const db = useData()
  const ready = useWarmup()
  const actor = useActor()
  const { run, pending } = useRun()
  const [customerId, setCustomerId] = React.useState('')
  const [productId, setProductId] = React.useState('')
  const [month, setMonth] = React.useState(todayISO().slice(0, 7))
  const [hCharge, setHCharge] = React.useState(0)
  const [net, setNet] = React.useState(0)
  const [error, setError] = React.useState('')

  const mine = db.customers.filter((c) => c.agentId === actor.userId)
  const customer = mine.find((c) => c.id === customerId)
  const invoice = db.invoices.find((i) => i.customerId === customerId && i.periodStart.slice(0, 7) === month)
  const lines = invoice?.lines.filter((l) => !productId || l.productId === productId) ?? []
  const current = round2(lines.reduce((s, l) => s + l.amount, 0))
  const products = [...new Map((invoice?.lines ?? []).map((l) => [l.productId, l.productName])).entries()]

  // Show what the bill says today so the figures can be adjusted.
  React.useEffect(() => {
    setError('')
    if (invoice) {
      setHCharge(invoice.handlingCharge)
      setNet(current)
    }
  }, [invoice?.id, productId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setError('')
    if (!customer) return setError('Select the customer.')
    if (!productId) return setError('Select the product.')
    if (!invoice) return setError('No bill exists for this customer and month. Generate the bill first.')
    if (!(net >= 0) || !(hCharge >= 0)) return setError('Amounts cannot be negative.')
    const delta = round2(net - current + (hCharge - invoice.handlingCharge))
    if (!delta) return setError('Nothing changed — the amounts match the bill.')
    const name = products.find(([id]) => id === productId)?.[1] ?? ''
    const ok = await run(() => billing.adjust(invoice.id, `${PREFIX} · ${name} · H charge ${formatINR(hCharge)} · net ${formatINR(net)}`, delta), `Bill adjusted by ${formatINR(delta)}`)
    if (ok) {
      setProductId('')
      toast.message('The adjustment is part of the bill history and cannot be deleted. Add a reversing one to correct it.')
    }
    return !!ok
  }

  const rows = db.invoices
    .filter((i) => i.agentId === actor.userId)
    .flatMap((i) => i.adjustments.filter((a) => a.label.startsWith(PREFIX)).map((a) => ({ i, a })))
    .map((r, n) => ({ ...r, n: n + 1, name: db.customers.find((c) => c.id === r.i.customerId)?.name ?? '' }))
  type Row = (typeof rows)[number]
  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    { key: 'name', header: 'Customer Name', sort: (r) => r.name, cell: (r) => <span><span className="block font-semibold">{r.name}</span><span className="text-[12px] text-muted-foreground">{r.a.label.replace(`${PREFIX} · `, '')}</span></span>, csv: (r) => `${r.name} ${r.a.label}` },
    { key: 'month', header: 'Month&Year', sort: (r) => r.i.periodStart, cell: (r) => r.i.periodStart.slice(0, 7), csv: (r) => r.i.periodStart.slice(0, 7) },
    { key: 'at', header: 'Date&Time', sort: (r) => r.a.at, cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.a.at)}</span>, csv: (r) => r.a.at },
    { key: 'act', header: '', cell: () => <RowActions lockedReason="Adjustments are part of the bill history — add a reversing one instead" /> },
  ]

  return (
    <>
      <PageHeader kicker="Transactions" title="Manage Bill Adjustment" description="Adjust a title's amount or the handling charge on a generated bill." />
      <FormTable
        noun="bill adjustment"
        form={
          <FormCard title="Bill Adjustment Form" onSubmit={save} pending={pending} submitLabel="Save">
            <Field label="Customer Name / Mobile / Route" required>
              <NativeSelect
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value)
                  setProductId('')
                }}
              >
                <option value="">Select Customer</option>
                {mine.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.mobile} · {db.routes.find((r) => r.id === c.routeId)?.name ?? 'No route'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Year / Date" required>
              <Input type="month" value={month} max={todayISO().slice(0, 7)} onChange={(e) => { setMonth(e.target.value); setProductId('') }} />
            </Field>
            <Field label="Product Name" required hint={customer && !invoice ? 'No bill for this month.' : undefined}>
              <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select Product</option>
                {products.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="H Charge">
                <Input type="number" min={0} value={hCharge} onChange={(e) => setHCharge(Number(e.target.value))} />
              </Field>
              <Field label="Net Amount">
                <Input type="number" min={0} value={net} onChange={(e) => setNet(Number(e.target.value))} />
              </Field>
            </div>
            <div className="rounded-2xl border border-dashed border-border bg-muted/40 p-4">
              <p className="kicker mb-2 text-muted-foreground">Customer Details</p>
            <KeyValue
              cols={2}
              items={[
                ['Customer Name', customer?.name ?? ''],
                ['Area', customer ? areaLabel(db, customer.areaId) : ''],
                ['Bill', invoice ? invoice.number : ''],
                ['Bill amount', invoice ? formatINR(invoice.currentBill) : ''],
              ]}
            />
            </div>
            {error && <p className="text-[13px] font-medium text-destructive">{error}</p>}
          </FormCard>
        }
      >
        <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.a.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.name}</span>} search={(r) => `${r.name} ${r.a.label}`} exportName="bill-adjustments" empty={{ icon: BadgePercent, title: 'No adjustments yet' }} />
      </FormTable>
    </>
  )
}
