import { CalendarDays, CreditCard, FileText, PauseCircle, Plus, RefreshCcw, Repeat, Truck, Wallet } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DeliveryCalendar } from '@/components/DeliveryCalendar'
import { PayDialog } from '@/components/PayDialog'
import { DashboardHero } from '@/components/fx/Hero'
import { Button } from '@/components/ui/button'
import { Badge, Card, CardHeader, PageSkeleton, StatCard, StatusBadge } from '@/components/ui/misc'
import { customerOutstanding } from '@/domain/billing'
import { deriveSubscriptionStatus, nextDeliveries, occurrences } from '@/domain/schedule'
import { FREQUENCY_META } from '@/domain/types'
import { useScope, useWarmup } from '@/hooks/app'
import { addDaysISO, diffDays, fmtDate, fmtShort, fmtWeekday, todayISO } from '@/lib/dates'
import { formatINR } from '@/lib/utils'
import { greeting } from './AdminDashboard'

export default function CustomerDashboard() {
  const { db, actor, subscriptions, invoices, payments } = useScope()
  const ready = useWarmup()
  const navigate = useNavigate()
  const me = db.customers.find((c) => c.id === actor.userId)!
  const [payOpen, setPayOpen] = React.useState(false)
  const outstanding = customerOutstanding(db, me.id)
  const latest = invoices.slice().sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))[0]
  const active = subscriptions.filter((s) => deriveSubscriptionStatus(s) === 'active')
  const upcoming = React.useMemo(() => nextDeliveries(db, subscriptions, 7), [db, subscriptions])
  const recent = React.useMemo(() => occurrences(db, subscriptions, addDaysISO(todayISO(), -7), todayISO()).filter((o) => o.status === 'delivered' || o.status === 'missed').reverse().slice(0, 6), [db, subscriptions])
  const renewals = subscriptions.filter((s) => s.endDate && !s.cancelledOn && diffDays(s.endDate, todayISO()) <= 30)

  if (!ready) return <PageSkeleton />
  const upcomingByDay = upcoming.reduce<Record<string, typeof upcoming>>((acc, o) => ((acc[o.date] ||= []).push(o), acc), {})

  return (
    <>
      <DashboardHero
        kicker={`Subscriber · ${me.code}`}
        title={<>Good {greeting()}, <span className="text-gradient">{me.name.split(' ')[0]}</span></>}
        description="Your newspapers, delivery schedule and bills — all in one place."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/subscriptions?new=1">
                <Plus /> Add subscription
              </Link>
            </Button>
            {outstanding > 0 && (
              <Button variant="accent" onClick={() => setPayOpen(true)}>
                <CreditCard /> Pay {formatINR(outstanding)}
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} label="Active subscriptions" value={active.length} icon={Repeat} onClick={() => navigate('/subscriptions')} hint={subscriptions.some((s) => deriveSubscriptionStatus(s) === 'paused') ? 'Some paused' : undefined} />
        <StatCard index={1} label="Current bill" value={latest ? formatINR(latest.currentBill) : '—'} icon={FileText} tone="info" hint={latest ? `${fmtShort(latest.periodStart)} – ${fmtShort(latest.periodEnd)}` : undefined} onClick={() => latest && navigate(`/invoices/${latest.id}`)} />
        <StatCard index={2} label="Outstanding balance" value={formatINR(outstanding)} icon={Wallet} tone={outstanding ? 'danger' : 'success'} hint={outstanding ? `Due ${latest ? fmtDate(latest.dueDate) : ''}` : 'All paid — thank you!'} onClick={() => setPayOpen(true)} />
        <StatCard index={3} label="Next delivery" value={upcoming[0] ? fmtShort(upcoming[0].date) : '—'} icon={Truck} tone="success" hint={upcoming[0] ? db.products.find((p) => p.id === upcoming[0]!.productId)?.name : 'Nothing scheduled'} />
      </div>

      {renewals.length > 0 && (
        <Card className="mt-4 flex flex-col gap-3 border-warning/40 bg-warning/[0.06] p-4 sm:flex-row sm:items-center">
          <RefreshCcw className="size-5 text-warning" />
          <div className="flex-1 text-[14px]">
            <b>Renewal due:</b> {renewals.map((s) => `${db.products.find((p) => p.id === s.productId)?.name} (ends ${fmtDate(s.endDate)})`).join(', ')}
          </div>
          <Button size="sm" asChild>
            <Link to="/subscriptions">Renew now</Link>
          </Button>
        </Card>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming deliveries" icon={CalendarDays} description="Next 7 days" action={<Link to="/calendar" className="text-[13px] font-semibold text-primary">Full calendar</Link>} />
          <ul className="divide-y divide-border/60 px-5 pb-3">
            {Object.entries(upcomingByDay).slice(0, 7).map(([d, os]) => (
              <li key={d} className="flex items-start gap-4 py-3">
                <div className="w-14 shrink-0 text-center">
                  <div className="text-[11px] font-bold uppercase text-muted-foreground">{fmtWeekday(d).slice(0, 3)}</div>
                  <div className="font-display text-2xl font-semibold leading-none text-primary">{d.slice(8)}</div>
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5 pt-1">
                  {os.map((o) => {
                    const p = db.products.find((x) => x.id === o.productId)!
                    return (
                      <span key={o.key} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[13px] font-medium">
                        <span className="size-2 rounded-full" style={{ background: p.color }} /> {p.name}
                        {o.quantity > 1 && <b>×{o.quantity}</b>}
                      </span>
                    )
                  })}
                </div>
              </li>
            ))}
            {!upcoming.length && <li className="py-8 text-center text-sm text-muted-foreground">No deliveries in the next 7 days.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="My subscriptions" action={<Link to="/subscriptions" className="text-[13px] font-semibold text-primary">Manage</Link>} />
          <ul className="divide-y divide-border/60 px-5 pb-3">
            {subscriptions.filter((s) => deriveSubscriptionStatus(s) !== 'cancelled').map((s) => {
              const p = db.products.find((x) => x.id === s.productId)!
              const st = deriveSubscriptionStatus(s)
              return (
                <li key={s.id} className="flex items-center gap-3 py-2.5">
                  <span className="h-9 w-1.5 rounded-full" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold">{p.name}</span>
                    <span className="text-[12px] text-muted-foreground">{FREQUENCY_META[s.frequency].label}{s.quantity > 1 ? ` · ×${s.quantity}` : ''}</span>
                  </span>
                  {st === 'paused' ? <Badge tone="warning"><PauseCircle className="size-3" /> Paused</Badge> : <StatusBadge status={st} />}
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent deliveries" action={<Link to="/deliveries" className="text-[13px] font-semibold text-primary">History</Link>} />
          <ul className="divide-y divide-border/60 px-5 pb-3">
            {recent.map((o) => (
              <li key={o.key} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                <span>
                  <b>{db.products.find((p) => p.id === o.productId)?.name}</b> · {fmtDate(o.date)}
                </span>
                <StatusBadge status={o.status} />
              </li>
            ))}
            {!recent.length && <li className="py-6 text-center text-sm text-muted-foreground">No recent deliveries.</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Payment history" action={<Link to="/payments" className="text-[13px] font-semibold text-primary">All receipts</Link>} />
          <ul className="divide-y divide-border/60 px-5 pb-3">
            {payments.slice().reverse().slice(0, 6).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                <span>
                  <b className="tabular">{formatINR(p.amount)}</b> · {p.method}
                  <span className="block text-[12px] text-muted-foreground">
                    {fmtDate(p.date)} · {p.receiptNo}
                  </span>
                </span>
                {p.simulated && <Badge tone="accent">Demo gateway</Badge>}
              </li>
            ))}
            {!payments.length && <li className="py-6 text-center text-sm text-muted-foreground">No payments yet.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <DeliveryCalendar subscriptions={subscriptions} showCustomer={false} />
      </Card>
      <PayDialog customerId={me.id} open={payOpen} onOpenChange={setPayOpen} />
    </>
  )
}
