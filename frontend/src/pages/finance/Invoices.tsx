import { FileCog, FileText, Wallet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { InvoiceTable } from '@/components/records'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect } from '@/components/ui/form'
import { DemoNote, PageHeader, StatCard } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { draftInvoice, invoiceRemaining, isOverdue } from '@/domain/billing'
import { useCan, useRun, useScope } from '@/hooks/app'
import { fmtMonth, monthEndISO, monthStartISO, todayISO } from '@/lib/dates'
import { addMonths, format } from 'date-fns'
import { formatINR, sum } from '@/lib/utils'
import { billing } from '@/services/api'
import { fromISO, toISO } from '@/lib/dates'

export default function Invoices() {
  const { db, actor, invoices, customers } = useScope()
  const canGen = useCan('invoice.generate')
  const [gen, setGen] = React.useState(false)
  const [month, setMonth] = React.useState('')
  const months = [...new Set(invoices.map((i) => i.periodStart))].sort().reverse()
  const rows = invoices.filter((i) => !month || i.periodStart === month)
  return (
    <>
      <PageHeader
        kicker="Finance"
        title={actor.role === 'customer' ? 'My bills' : 'Billing & invoices'}
        description="Invoices are generated from delivery schedules and the price in effect on each date. Previously issued line prices never change."
        actions={
          canGen && (
            <Button onClick={() => setGen(true)}>
              <FileCog /> Generate monthly bills
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Billed" value={formatINR(sum(rows.map((i) => i.currentBill)), true)} icon={FileText} hint={`${rows.length} invoices`} />
        <StatCard label="Outstanding" value={formatINR(sum(rows.map(invoiceRemaining)), true)} icon={Wallet} tone="danger" />
        <StatCard label="Overdue invoices" value={rows.filter((i) => isOverdue(i)).length} icon={FileText} tone="warning" />
      </div>
      <div className="mb-3 flex items-center gap-2">
        <NativeSelect value={month} onChange={(e) => setMonth(e.target.value)} className="h-10 w-48" aria-label="Billing month">
          <option value="">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(m)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <InvoiceTable invoices={rows} showCustomer={actor.role !== 'customer'} exportName="invoices" />
      {gen && <GenerateDialog onClose={() => setGen(false)} customerIds={customers.map((c) => c.id)} db={db} />}
    </>
  )
}

function GenerateDialog({ onClose, customerIds, db }: { onClose: () => void; customerIds: string[]; db: ReturnType<typeof useScope>['db'] }) {
  const { run, pending } = useRun()
  const options = [0, -1, -2].map((n) => toISO(addMonths(fromISO(monthStartISO(todayISO())), n)))
  const [period, setPeriod] = React.useState(options[1]!)
  const already = new Set(db.invoices.filter((i) => i.periodStart === period).map((i) => i.customerId))
  const pendingIds = customerIds.filter((id) => !already.has(id))
  const preview = pendingIds.map((id) => ({ id, d: draftInvoice(db, id, period, monthEndISO(period)) })).filter((x) => x.d.lines.length)
  const partial = period === monthStartISO(todayISO())
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title="Generate monthly bills" description="One invoice per customer per month. Re-running never duplicates.">
        <div className="space-y-4">
          <Field label="Billing month">
            <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)}>
              {options.map((m) => (
                <option key={m} value={m}>
                  {format(fromISO(m), 'MMMM yyyy')}
                  {m === monthStartISO(todayISO()) ? ' (current month)' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {partial && <DemoNote>You are billing the current month in advance — quantities use the full month's schedule.</DemoNote>}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-muted/60 p-3">
              <div className="font-display text-2xl font-semibold">{preview.length}</div>
              <div className="text-[12px] text-muted-foreground">New invoices</div>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <div className="font-display text-2xl font-semibold">{already.size}</div>
              <div className="text-[12px] text-muted-foreground">Already billed</div>
            </div>
            <div className="rounded-lg bg-muted/60 p-3">
              <div className="font-display text-2xl font-semibold">{formatINR(sum(preview.map((p) => p.d.currentBill)), true)}</div>
              <div className="text-[12px] text-muted-foreground">Total billing</div>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-muted">
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                  <th className="px-3 py-2 text-right">Discount</th>
                  <th className="px-3 py-2 text-right">Bill</th>
                  <th className="px-3 py-2 text-right">Prev. due</th>
                </tr>
              </thead>
              <tbody>
                {preview.map(({ id, d }) => (
                  <tr key={id} className="border-t border-border/60">
                    <td className="px-3 py-1.5">{db.customers.find((c) => c.id === id)?.name}</td>
                    <td className="tabular px-3 text-right">{formatINR(d.subtotal)}</td>
                    <td className="tabular px-3 text-right">{d.discount ? `−${formatINR(d.discount)}` : '—'}</td>
                    <td className="tabular px-3 text-right font-semibold">{formatINR(d.currentBill)}</td>
                    <td className="tabular px-3 text-right">{formatINR(d.previousBalance)}</td>
                  </tr>
                ))}
                {!preview.length && (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-muted-foreground">
                      Everyone is already billed for this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!preview.length}
            loading={pending}
            onClick={async () => {
              const r = await run(() => billing.generate(period, customerIds))
              if (r) {
                toast.success(`${r.created} invoices generated${r.skipped ? ` · ${r.skipped} already billed` : ''}. Customers notified.`)
                onClose()
              }
            }}
          >
            Generate {preview.length} invoices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
