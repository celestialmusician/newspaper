import { CheckCircle2, Phone, Receipt } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { canVisit } from '@/app/nav'
import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { Badge, KeyValue, Money, StatusBadge } from '@/components/ui/misc'
import { can, executiveOf } from '@/domain/access'
import { customerOutstanding, invoiceRemaining } from '@/domain/billing'
import { areaLabel } from '@/domain/locations'
import type { ID, PaymentMethod } from '@/domain/types'
import { errorMessage, useActor, useData } from '@/hooks/app'
import { fmtDate } from '@/lib/dates'
import { formatINR, formatMobile, round2, uid } from '@/lib/utils'
import { collectPayment } from '@/services/offline'
import { getDB } from '@/services/store'
import { downloadReceiptPDF } from '@/lib/pdf'

/** Detailed bill for a customer + authorised cash collection (works offline). */
export function BillDialog({ customerId, open, onOpenChange }: { customerId: ID | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useData()
  const actor = useActor()
  const c = db.customers.find((x) => x.id === customerId)
  const invoices = c ? db.invoices.filter((i) => i.customerId === c.id).sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)) : []
  const latest = invoices[0]
  const outstanding = c ? customerOutstanding(db, c.id) : 0
  const canCollect = can(db, actor, 'payment.collect')
  const methods: PaymentMethod[] = actor.role === 'executive' ? ['Delivery Executive Collection'] : actor.role === 'agent' ? ['Agent Collection', 'Cash'] : ['Cash', 'Agent Collection', 'Delivery Executive Collection']

  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState<PaymentMethod>(methods[0]!)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [done, setDone] = React.useState<null | { queued: boolean; amount: number; receipt?: string; paymentId?: string }>(null)
  const keyRef = React.useRef(uid('pay'))

  React.useEffect(() => {
    if (open) {
      setAmount(outstanding ? String(outstanding) : '')
      setNote('')
      setDone(null)
      keyRef.current = uid('pay') // one idempotency key per collection attempt
    }
  }, [open, customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!c) return null
  const exec = executiveOf(db, c)

  const submit = async () => {
    const amt = round2(Number(amount))
    if (!(amt > 0)) return toast.error('Enter the amount received.')
    if (amt > outstanding + 0.004) return toast.error(`Amount is more than the outstanding ${formatINR(outstanding)}.`)
    setBusy(true)
    try {
      const r = await collectPayment({ customerId: c.id, amount: amt, method, idempotencyKey: keyRef.current, note: note || undefined }, `Cash ${formatINR(amt)} · ${c.name}`)
      if (r === 'queued') {
        toast.info('Saved offline. Receipt will be issued when the phone reconnects.')
        setDone({ queued: true, amount: amt })
      } else {
        const fresh = getDB().payments.find((x) => x.idempotencyKey === keyRef.current)
        toast.success(`${formatINR(amt)} recorded · ${fresh?.receiptNo}`)
        setDone({ queued: false, amount: amt, receipt: fresh?.receiptNo, paymentId: fresh?.id })
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={c.name} description={`${c.code} · ${c.houseName}, ${areaLabel(db, c.areaId)}`} size="lg">
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={`tel:${c.mobile}`}>
                <Phone /> {formatMobile(c.mobile)}
              </a>
            </Button>
            {exec && <Badge tone="navy">Executive: {exec.name}</Badge>}
            <Badge tone={outstanding > 0 ? 'danger' : 'success'}>Outstanding {formatINR(outstanding)}</Badge>
          </div>

          {latest ? (
            <div className="rounded-xl border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Latest invoice</div>
                  <div className="font-display text-lg font-semibold text-primary">{latest.number}</div>
                </div>
                <StatusBadge status={latest.status} />
              </div>
              <div className="p-4">
                <KeyValue cols={3} items={[["Billing period", `${fmtDate(latest.periodStart)} – ${fmtDate(latest.periodEnd)}`], ['Issued', fmtDate(latest.issuedOn)], ['Due date', fmtDate(latest.dueDate)]]} />
                <table className="mt-4 w-full text-[13.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2">Product</th>
                      <th className="py-2 text-right">Qty</th>
                      <th className="py-2 text-right">Rate</th>
                      <th className="py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.lines.map((l, i) => (
                      <tr key={i} className="border-b border-border/50">
                        <td className="py-2">{l.productName}</td>
                        <td className="tabular py-2 text-right">{l.quantity}</td>
                        <td className="tabular py-2 text-right">{formatINR(l.unitPrice)}</td>
                        <td className="tabular py-2 text-right">{formatINR(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="ml-auto mt-3 max-w-xs space-y-1 text-[13.5px]">
                  <Row k="Subtotal" v={latest.subtotal} />
                  {latest.discount > 0 && <Row k="Discount" v={-latest.discount} />}
                  {latest.handlingCharge > 0 && <Row k="Handling charge" v={latest.handlingCharge} />}
                  {latest.adjustments.map((a) => (
                    <Row key={a.id} k={a.label} v={a.amount} />
                  ))}
                  <Row k="Current bill" v={latest.currentBill} strong />
                  <Row k="Previous balance" v={latest.previousBalance} />
                  <Row k="Paid against this bill" v={-latest.paid} />
                  <div className="flex justify-between border-t border-border pt-2 text-[15px] font-bold">
                    <span>Remaining balance (account)</span>
                    <span className="tabular text-destructive">{formatINR(outstanding)}</span>
                  </div>
                </dl>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No invoices yet for this customer.</p>
          )}

          {invoices.length > 1 && (
            <div className="text-[13px] text-muted-foreground">
              Earlier invoices:{' '}
              {invoices.slice(1).map((i) => (
                <span key={i.id} className="mr-2">
                  {i.number} — <StatusBadge status={i.status} label={invoiceRemaining(i) ? `${formatINR(invoiceRemaining(i))} due` : 'Paid'} />
                </span>
              ))}
            </div>
          )}

          {canCollect && outstanding > 0 && !done && (
            <div className="rounded-xl border border-success/30 bg-success/[0.04] p-4">
              <div className="mb-3 font-semibold text-success">Record cash collection</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Amount received (₹)" required hint="Older dues are cleared first.">
                  <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" className="h-12 text-lg font-semibold" />
                </Field>
                <Field label="Collected as">
                  <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                    {methods.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[outstanding, latest ? latest.currentBill : 0, 100, 200]
                  .filter((v, i, a) => v > 0 && v <= outstanding && a.indexOf(v) === i)
                  .map((v) => (
                    <button key={v} type="button" onClick={() => setAmount(String(v))} className="rounded-full border border-border bg-card px-3 py-1 text-[12.5px] font-semibold hover:border-primary">
                      {formatINR(v)}
                    </button>
                  ))}
              </div>
              <Field label="Note" className="mt-3">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. paid by son" />
              </Field>
            </div>
          )}

          {done && (
            <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/[0.06] p-4">
              <CheckCircle2 className="mt-0.5 size-5 text-success" />
              <div className="flex-1 text-[14px]">
                <div className="font-semibold text-success">{done.queued ? 'Saved on this device' : 'Payment recorded'}</div>
                <div className="text-muted-foreground">
                  {formatINR(done.amount)} {done.queued ? 'will sync automatically when you are back online. No duplicate will be created.' : `· Receipt ${done.receipt}`}
                </div>
              </div>
              {done.paymentId && (
                <Button variant="outline" size="sm" onClick={() => downloadReceiptPDF(getDB(), done.paymentId!)}>
                  <Receipt /> Receipt
                </Button>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          {canVisit(actor.role, `/customers/${c.id}`) && (
            <Button variant="ghost" asChild>
              <Link to={`/customers/${c.id}?tab=billing`}>Open full profile</Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canCollect && outstanding > 0 && !done && (
            <Button variant="success" onClick={submit} loading={busy}>
              Record {amount ? formatINR(Number(amount) || 0) : ''} collection
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Row({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : 'text-muted-foreground'}`}>
      <span>{k}</span>
      <Money value={v} className={strong ? '' : 'font-medium'} />
    </div>
  )
}
