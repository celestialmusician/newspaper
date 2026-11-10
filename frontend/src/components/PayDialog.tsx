import { CheckCircle2, CreditCard, Landmark, Receipt, Smartphone, XCircle } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field, Input, Segmented } from '@/components/ui/form'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { DemoNote } from '@/components/ui/misc'
import { customerOutstanding } from '@/domain/billing'
import type { ID, PaymentMethod } from '@/domain/types'
import { errorMessage, useData } from '@/hooks/app'
import { downloadReceiptPDF } from '@/lib/pdf'
import { cn, formatINR, round2, uid } from '@/lib/utils'
import { payments } from '@/services/api'
import { isOnline } from '@/services/offline'
import { getDB } from '@/services/store'

const METHODS: { m: PaymentMethod; icon: React.ElementType; hint: string }[] = [
  { m: 'UPI', icon: Smartphone, hint: 'GPay, PhonePe, Paytm, BHIM' },
  { m: 'Debit Card', icon: CreditCard, hint: 'RuPay, Visa, Mastercard' },
  { m: 'Credit Card', icon: Landmark, hint: 'All major cards' },
]

/**
 * Customer "Pay Now" through a SIMULATED gateway. No card or UPI credentials are collected
 * or stored; the result is flagged simulated and its reference starts with SIM-.
 */
export function PayDialog({ customerId, open, onOpenChange }: { customerId: ID; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useData()
  const outstanding = customerOutstanding(db, customerId)
  const [mode, setMode] = React.useState<'full' | 'partial'>('full')
  const [amount, setAmount] = React.useState('')
  const [method, setMethod] = React.useState<PaymentMethod>('UPI')
  const [outcome, setOutcome] = React.useState<'success' | 'failure'>('success')
  const [state, setState] = React.useState<'form' | 'processing' | 'ok' | 'failed'>('form')
  const [error, setError] = React.useState('')
  const [paymentId, setPaymentId] = React.useState<string | null>(null)
  const key = React.useRef(uid('pay'))

  React.useEffect(() => {
    if (open) {
      setState('form')
      setMode('full')
      setAmount('')
      setError('')
      setPaymentId(null)
      key.current = uid('pay')
    }
  }, [open])

  const payAmount = mode === 'full' ? outstanding : round2(Number(amount) || 0)

  const pay = async () => {
    if (!isOnline()) return toast.error('Online payment needs an internet connection.')
    if (!(payAmount > 0)) return toast.error('Enter an amount to pay.')
    if (payAmount > outstanding + 0.004) return toast.error(`You can pay up to ${formatINR(outstanding)}.`)
    setState('processing')
    try {
      const r = await payments.payOnline({ customerId, amount: payAmount, method, idempotencyKey: key.current, outcome })
      setPaymentId(r.payment.id)
      setState('ok')
    } catch (e) {
      setError(errorMessage(e))
      setState('failed')
      key.current = uid('pay') // a declined attempt may be retried with a fresh key
    }
  }

  const p = paymentId ? db.payments.find((x) => x.id === paymentId) : undefined

  return (
    <Dialog open={open} onOpenChange={(o) => state !== 'processing' && onOpenChange(o)}>
      <DialogContent title="Pay your bill" description={`Outstanding balance ${formatINR(outstanding)}`} size="md">
        {state === 'form' && (
          <div className="space-y-5">
            <Segmented value={mode} onChange={(v) => setMode(v)} options={[{ value: 'full', label: `Full · ${formatINR(outstanding)}` }, { value: 'partial', label: 'Part payment' }]} />
            {mode === 'partial' && (
              <Field label="Amount (₹)" hint="Oldest bills are cleared first. The balance carries forward.">
                <Input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoFocus className="h-12 text-lg font-semibold" placeholder="0" />
              </Field>
            )}
            <div className="grid gap-2">
              {METHODS.map(({ m, icon: Icon, hint }) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={cn('flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition', method === m ? 'border-primary bg-primary/[0.03]' : 'border-border hover:border-primary/40')}
                >
                  <span className="grid size-10 place-items-center rounded-lg bg-muted">
                    <Icon className="size-5 text-primary" />
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">{m}</span>
                    <span className="text-[12.5px] text-muted-foreground">{hint}</span>
                  </span>
                  <span className={cn('size-5 rounded-full border-2', method === m ? 'border-[6px] border-primary' : 'border-input')} />
                </button>
              ))}
            </div>
            <DemoNote>
              Payments run on a <b>simulated gateway</b> — no money moves and no card / UPI details are collected. Receipts are marked “Demo gateway”.
              <div className="mt-2 flex items-center gap-2">
                Simulate result:
                <Segmented value={outcome} onChange={(v) => setOutcome(v)} options={[{ value: 'success', label: 'Success' }, { value: 'failure', label: 'Declined' }]} />
              </div>
            </DemoNote>
          </div>
        )}
        {state === 'processing' && (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="mb-4 size-12 animate-spin rounded-full border-4 border-muted border-t-masthead" />
            <div className="font-display text-xl font-semibold text-primary">Connecting to demo gateway…</div>
            <div className="text-sm text-muted-foreground">Please don't close this window.</div>
          </div>
        )}
        {state === 'ok' && p && (
          <div className="flex flex-col items-center py-6 text-center">
            <CheckCircle2 className="mb-3 size-14 text-success" />
            <div className="font-display text-2xl font-semibold text-primary">{formatINR(p.amount)} paid</div>
            <div className="mt-1 text-sm text-muted-foreground">
              Receipt {p.receiptNo} · {p.method} · ref {p.gatewayRef}
            </div>
            <div className="mt-1 text-sm">Remaining balance: <b>{formatINR(customerOutstanding(db, customerId))}</b></div>
            <Button variant="outline" className="mt-5" onClick={() => void downloadReceiptPDF(getDB(), p.id)}>
              <Receipt /> Download receipt
            </Button>
          </div>
        )}
        {state === 'failed' && (
          <div className="flex flex-col items-center py-6 text-center">
            <XCircle className="mb-3 size-14 text-destructive" />
            <div className="font-display text-2xl font-semibold text-destructive">Payment not completed</div>
            <div className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</div>
          </div>
        )}
        <DialogFooter>
          {state === 'form' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="accent" onClick={pay} disabled={!(payAmount > 0)}>
                Pay {formatINR(payAmount)}
              </Button>
            </>
          )}
          {state === 'failed' && (
            <Button onClick={() => setState('form')} className="w-full sm:w-auto">
              Try again
            </Button>
          )}
          {state === 'ok' && (
            <Button onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
