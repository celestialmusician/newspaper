import { ArrowLeft, CreditCard, Download, FileX, HandCoins, Printer, SlidersHorizontal } from 'lucide-react'
import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { BillDialog } from '@/components/BillDialog'
import { PayDialog } from '@/components/PayDialog'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Card, EmptyState, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { can, canSeeCustomer, userName } from '@/domain/access'
import { customerOutstanding, invoiceRemaining, isOverdue } from '@/domain/billing'
import { fullAddressLine } from '@/domain/locations'
import { useActor, useData, useRun } from '@/hooks/app'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { downloadInvoicePDF } from '@/lib/pdf'
import { formatINR, round2 } from '@/lib/utils'
import { billing } from '@/services/api'
import { getDB } from '@/services/store'

export default function InvoiceView() {
  const { id } = useParams()
  const db = useData()
  const actor = useActor()
  const [adjust, setAdjust] = React.useState(false)
  const [pay, setPay] = React.useState(false)
  const [collect, setCollect] = React.useState(false)
  const inv = db.invoices.find((i) => i.id === id)
  if (!inv || !canSeeCustomer(db, actor, inv.customerId)) return <EmptyState icon={FileX} title="Invoice not found" action={<Button asChild><Link to="/invoices">Back to invoices</Link></Button>} />
  const c = db.customers.find((x) => x.id === inv.customerId)!
  const agent = db.agents.find((a) => a.id === inv.agentId)
  const outstanding = customerOutstanding(db, c.id)
  const pays = db.payments.filter((p) => p.allocations.some((a) => a.invoiceId === inv.id))

  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link to="/invoices" className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Invoices
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Print
          </Button>
          <Button variant="outline" onClick={() => void downloadInvoicePDF(getDB(), inv.id)}>
            <Download /> PDF
          </Button>
          {can(db, actor, 'invoice.adjust') && (
            <Button variant="outline" onClick={() => setAdjust(true)}>
              <SlidersHorizontal /> Adjustment
            </Button>
          )}
          {actor.role === 'customer' && outstanding > 0 && (
            <Button variant="accent" onClick={() => setPay(true)}>
              <CreditCard /> Pay {formatINR(outstanding)}
            </Button>
          )}
          {can(db, actor, 'payment.collect') && outstanding > 0 && (
            <Button variant="success" onClick={() => setCollect(true)}>
              <HandCoins /> Collect
            </Button>
          )}
        </div>
      </div>

      <Card className="print-area mx-auto max-w-4xl overflow-hidden">
        <div className="hero-panel px-6 py-6 sm:px-10">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="font-display text-3xl font-semibold">{db.settings.agencyName}</div>
              <div className="mt-1 max-w-md text-[12.5px] text-white/65">
                {db.settings.agencyAddress} · GSTIN {db.settings.gstin} · {db.settings.supportPhone}
              </div>
            </div>
            <div className="sm:text-right">
              <div className="kicker text-white/55">Invoice</div>
              <div className="font-display text-2xl font-semibold">{inv.number}</div>
              <div className="mt-1">
                <StatusBadge status={isOverdue(inv) ? 'overdue' : inv.status} />
              </div>
            </div>
          </div>
        </div>
        <div className="h-1.5 bg-brand-gradient" />
        <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Billed to</div>
            <div className="mt-1 font-display text-xl font-semibold text-primary">{c.name}</div>
            <div className="text-[13.5px] text-muted-foreground">
              {c.code} · +91 {c.mobile}
              <br />
              {c.houseName}, {fullAddressLine(db, c.areaId)}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13.5px] sm:text-right">
            <dt className="text-muted-foreground">Billing period</dt>
            <dd className="font-semibold">
              {fmtDate(inv.periodStart)} – {fmtDate(inv.periodEnd)}
            </dd>
            <dt className="text-muted-foreground">Issued</dt>
            <dd className="font-semibold">{fmtDate(inv.issuedOn)}</dd>
            <dt className="text-muted-foreground">Due date</dt>
            <dd className="font-semibold">{fmtDate(inv.dueDate)}</dd>
            <dt className="text-muted-foreground">Agent</dt>
            <dd className="font-semibold">{agent?.name}</dd>
          </dl>
        </div>
        <div className="overflow-x-auto px-6 sm:px-10">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-y-2 border-primary text-left text-[11px] font-bold uppercase tracking-wider text-primary">
                <th className="py-2.5">Product</th>
                <th className="py-2.5 text-right">Deliveries</th>
                <th className="py-2.5 text-right">Qty</th>
                <th className="py-2.5 text-right">Unit price</th>
                <th className="py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, i) => (
                <tr key={i} className="border-b border-border/70">
                  <td className="py-3 font-semibold">{l.productName}</td>
                  <td className="tabular py-3 text-right">{l.deliveries}</td>
                  <td className="tabular py-3 text-right">{l.quantity}</td>
                  <td className="tabular py-3 text-right">{formatINR(l.unitPrice)}</td>
                  <td className="tabular py-3 text-right">{formatINR(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 gap-6 px-6 py-6 sm:grid-cols-2 sm:px-10">
          <div className="text-[12.5px] text-muted-foreground">
            Subscriptions are billed at a fixed rate — holidays and hartals do not reduce the bill. Unit prices are locked at the rate in effect on each delivery date.
            {pays.length > 0 && (
              <div className="mt-4">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider">Payments applied</div>
                {pays.map((p) => (
                  <div key={p.id}>
                    {p.receiptNo} · {fmtDateTime(p.at)} · {p.method}
                    {p.simulated ? ' (demo gateway)' : ''} · {formatINR(p.allocations.find((a) => a.invoiceId === inv.id)!.amount)}
                  </div>
                ))}
              </div>
            )}
          </div>
          <dl className="space-y-1.5 text-[14px]">
            <Row k="Subtotal" v={inv.subtotal} />
            {inv.discount > 0 && <Row k="Discount" v={-inv.discount} />}
            {inv.handlingCharge > 0 && <Row k="Handling charge" v={inv.handlingCharge} />}
            {inv.adjustments.map((a) => (
              <Row key={a.id} k={`${a.label} (approved by ${userName(db, a.approvedBy)})`} v={a.amount} />
            ))}
            <Row k="Current bill" v={inv.currentBill} strong />
            <Row k="Previous pending" v={inv.previousBalance} />
            <div className="flex justify-between border-t-2 border-primary pt-2 font-display text-xl font-semibold text-primary">
              <span>Total payable</span>
              <span className="tabular">{formatINR(round2(inv.currentBill + inv.previousBalance))}</span>
            </div>
            <Row k="Paid against this bill" v={inv.paid} />
            <Row k="Remaining on this bill" v={invoiceRemaining(inv)} strong />
            <div className="mt-2 rounded-lg bg-destructive/8 px-3 py-2 text-[13px] font-semibold text-destructive">Account balance today: {formatINR(outstanding)}</div>
          </dl>
        </div>
      </Card>

      {adjust && <AdjustDialog invoiceId={inv.id} onClose={() => setAdjust(false)} />}
      {actor.role === 'customer' && <PayDialog customerId={c.id} open={pay} onOpenChange={setPay} />}
      <BillDialog customerId={c.id} open={collect} onOpenChange={setCollect} />
    </>
  )
}

function Row({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : 'text-muted-foreground'}`}>
      <span>{k}</span>
      <span className="tabular">{formatINR(v)}</span>
    </div>
  )
}

function AdjustDialog({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const { run, pending } = useRun()
  const [label, setLabel] = React.useState('')
  const [amount, setAmount] = React.useState('')
  const [kind, setKind] = React.useState<'credit' | 'charge'>('credit')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Approved billing adjustment" description="For specifically approved cases (e.g. a long strike). Line items are never edited.">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button variant={kind === 'credit' ? 'default' : 'outline'} size="sm" onClick={() => setKind('credit')}>
              Credit (reduce)
            </Button>
            <Button variant={kind === 'charge' ? 'default' : 'outline'} size="sm" onClick={() => setKind('charge')}>
              Charge (add)
            </Button>
          </div>
          <Field label="Reason" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. 3-day hartal concession (approved)" />
          </Field>
          <Field label="Amount (₹)" required>
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={async () => (await run(() => billing.adjust(invoiceId, label, (kind === 'credit' ? -1 : 1) * Number(amount)), 'Adjustment applied — customer notified')) && onClose()}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
