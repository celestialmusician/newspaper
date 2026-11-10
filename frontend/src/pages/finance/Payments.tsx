import { CreditCard, IndianRupee, Smartphone, Wallet } from 'lucide-react'
import * as React from 'react'
import { PayDialog } from '@/components/PayDialog'
import { PaymentTable } from '@/components/records'
import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/form'
import { PageHeader, StatCard } from '@/components/ui/misc'
import { customerOutstanding } from '@/domain/billing'
import { ONLINE_METHODS, type PaymentMethod } from '@/domain/types'
import { useScope } from '@/hooks/app'
import { addDaysISO, monthStartISO, todayISO } from '@/lib/dates'
import { formatINR, sum } from '@/lib/utils'

export default function Payments() {
  const { db, actor, payments } = useScope()
  const [pay, setPay] = React.useState(false)
  const [method, setMethod] = React.useState<'' | PaymentMethod>('')
  const [from, setFrom] = React.useState(actor.role === 'customer' ? '' : addDaysISO(todayISO(), -45))
  const rows = payments.filter((p) => (!method || p.method === method) && (!from || p.date >= from))
  const isCustomer = actor.role === 'customer'
  const outstanding = isCustomer ? customerOutstanding(db, actor.userId) : 0
  return (
    <>
      <PageHeader
        kicker="Finance"
        title={isCustomer ? 'Payments & receipts' : 'Payments'}
        description={isCustomer ? 'Pay online, see every payment and download receipts.' : 'Every recorded payment with allocation to invoices. Executive cash collections need verification.'}
        actions={
          isCustomer &&
          outstanding > 0 && (
            <Button variant="accent" size="lg" onClick={() => setPay(true)}>
              <CreditCard /> Pay {formatINR(outstanding)}
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {isCustomer && <StatCard label="Outstanding balance" value={formatINR(outstanding)} icon={Wallet} tone={outstanding ? 'danger' : 'success'} onClick={() => outstanding && setPay(true)} />}
        <StatCard label="Total in view" value={formatINR(sum(rows.map((p) => p.amount)), true)} icon={IndianRupee} tone="success" hint={`${rows.length} payments`} />
        <StatCard label="This month" value={formatINR(sum(payments.filter((p) => p.date >= monthStartISO(todayISO())).map((p) => p.amount)), true)} icon={IndianRupee} />
        <StatCard label="Online (demo gateway)" value={formatINR(sum(rows.filter((p) => ONLINE_METHODS.includes(p.method)).map((p) => p.amount)), true)} icon={Smartphone} tone="accent" />
        {!isCustomer && <StatCard label="Awaiting verification" value={rows.filter((p) => !p.verified).length} icon={Wallet} tone="warning" />}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className="h-10 w-56" aria-label="Method">
          <option value="">All methods</option>
          {(['UPI', 'Debit Card', 'Credit Card', 'Cash', 'Agent Collection', 'Delivery Executive Collection'] as PaymentMethod[]).map((m) => (
            <option key={m}>{m}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-40" aria-label="Period">
          <option value={addDaysISO(todayISO(), -7)}>Last 7 days</option>
          <option value={addDaysISO(todayISO(), -45)}>Last 45 days</option>
          <option value={addDaysISO(todayISO(), -120)}>Last 120 days</option>
          <option value="">All time</option>
        </NativeSelect>
      </div>
      <PaymentTable payments={rows} showCustomer={!isCustomer} exportName="payments" />
      {isCustomer && <PayDialog customerId={actor.userId} open={pay} onOpenChange={setPay} />}
    </>
  )
}
