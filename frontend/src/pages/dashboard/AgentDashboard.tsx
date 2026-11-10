import { addMonths, format } from 'date-fns'
import { Activity, CalendarClock, Newspaper, PauseCircle, Repeat, Search, UserMinus, UserPlus, Users } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { KpiStrip, LineChart, sharePct } from '@/components/charts'
import { DashboardHero } from '@/components/fx/Hero'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Avatar, Badge, Card, CardBody, CardHeader, PageSkeleton, StatCard } from '@/components/ui/misc'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import { useActor, useData, useWarmup } from '@/hooks/app'
import { addDaysISO, fromISO, monthEndISO, monthStartISO, toISO, todayISO } from '@/lib/dates'
import { formatINR, formatNum, sum } from '@/lib/utils'

export function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}

/** Agency Console: six subscriber counters for a date range, the cash flow and who is active today. */
export default function AgentDashboard() {
  const db = useData()
  const ready = useWarmup()
  const actor = useActor()
  const navigate = useNavigate()
  const today = todayISO()
  const me = db.agents.find((a) => a.id === actor.userId)!
  const [from, setFrom] = React.useState(monthStartISO(today))
  const [to, setTo] = React.useState(today)
  const [range, setRange] = React.useState({ from, to })

  const m = React.useMemo(() => {
    const mine = new Set(db.customers.filter((c) => c.agentId === me.id).map((c) => c.id))
    const subs = db.subscriptions.filter((s) => mine.has(s.customerId))
    const inRange = (d?: string | null) => !!d && d >= range.from && d <= range.to
    const status = (s: (typeof subs)[number]) => deriveSubscriptionStatus(s)
    return {
      newSubscribers: db.customers.filter((c) => c.agentId === me.id && inRange(c.registeredOn)).length,
      activeSubscribers: new Set(subs.filter((s) => status(s) === 'active').map((s) => s.customerId)).size,
      unSubscribers: new Set(subs.filter((s) => inRange(s.cancelledOn)).map((s) => s.customerId)).size,
      expired: new Set(subs.filter((s) => !s.cancelledOn && s.endDate && s.endDate < today && inRange(s.endDate)).map((s) => s.customerId)).size,
      newSubscriptions: subs.filter((s) => inRange(s.createdOn)).length,
      paused: subs.filter((s) => s.pauses.some((p) => p.from <= range.to && (p.to === null || p.to >= range.from))).length,
    }
  }, [db, me.id, range, today])

  const cash = React.useMemo(
    () =>
      Array.from({ length: 6 }, (_, i) => {
        const start = toISO(addMonths(fromISO(monthStartISO(today)), i - 5))
        const end = monthEndISO(start)
        const bills = db.invoices.filter((x) => x.agentId === me.id && x.periodStart >= start && x.periodStart <= end)
        const billed = sum(bills.map((x) => x.currentBill))
        const collected = sum(db.payments.filter((p) => p.agentId === me.id && p.date >= start && p.date <= end).map((p) => p.amount))
        return { month: format(fromISO(start), 'MMM yy'), Billed: billed, Collected: collected }
      }),
    [db, me.id, today],
  )

  /** Delivery boys and staff users who were active in the last 24 hours. */
  const active = React.useMemo(() => {
    const since = addDaysISO(today, -1)
    const boys = db.executives.filter((e) => e.agentId === me.id)
    const rows = boys.map((e) => {
      const last = Object.values(db.deliveries).filter((d) => d.executiveId === e.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      return { id: e.id, name: e.name, role: 'Delivery boy', last: last?.updatedAt ?? '' }
    })
    return rows.filter((r) => r.last && r.last.slice(0, 10) >= since).sort((a, b) => b.last.localeCompare(a.last))
  }, [db, me.id, today])

  if (!ready) return <PageSkeleton />
  return (
    <>
      <DashboardHero
        kicker={`Agency · ${me.code}`}
        title={
          <>
            Agency <span className="text-gradient">Console</span>
          </>
        }
        description={`${me.agencyName} — subscribers, subscriptions and cash flow.`}
      />

      <Card className="mb-4">
        <CardBody>
          <form
            className="grid grid-cols-2 items-end gap-3 lg:grid-cols-[repeat(2,minmax(0,12rem))_auto]"
            onSubmit={(e) => {
              e.preventDefault()
              setRange({ from, to })
            }}
          >
            <Field label="From Date">
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To Date">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Button type="submit" className="col-span-2 w-full lg:col-span-1 lg:w-fit">
              <Search /> Show
            </Button>
          </form>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard index={0} label="No of New Subscribers" value={formatNum(m.newSubscribers)} icon={UserPlus} tone="warning" onClick={() => navigate('/customers-master')} />
        <StatCard index={1} label="No of Active Subscribers" value={formatNum(m.activeSubscribers)} icon={Users} tone="danger" onClick={() => navigate('/reports/customer-data')} />
        <StatCard index={2} label="No of Un-Subscribers" value={formatNum(m.unSubscribers)} icon={UserMinus} tone="success" onClick={() => navigate('/manage-subscriptions')} />
        <StatCard index={3} label="No of Subscriber Expired" value={formatNum(m.expired)} icon={CalendarClock} tone="navy" onClick={() => navigate('/manage-subscriptions')} />
        <StatCard index={4} label="No of New Subscriptions/Products" value={formatNum(m.newSubscriptions)} icon={Repeat} tone="success" onClick={() => navigate('/reports/sales')} />
        <StatCard index={5} label="No of Pause / Leave" value={formatNum(m.paused)} icon={PauseCircle} tone="info" onClick={() => navigate('/manage-subscriptions')} />
      </div>


      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Cash Flow" icon={Newspaper} description="Last six months" />
          <CardBody className="space-y-4">
            {(() => {
              const billed = sum(cash.map((c) => c.Billed))
              const collected = sum(cash.map((c) => c.Collected))
              return (
                <KpiStrip
                  items={[
                    { label: 'Billed Amount', value: formatINR(billed, true) },
                    { label: 'Collected Amount', value: formatINR(collected, true) },
                    { label: 'Balance Amount', value: formatINR(Math.max(0, billed - collected), true), tone: billed > collected ? 'critical' : undefined },
                    { label: 'Collection rate', value: sharePct(collected, billed) },
                  ]}
                />
              )
            })()}
            {/* The gap between the two lines is the month's balance. */}
            <LineChart
              data={cash}
              x="month"
              money
              height={200}
              series={[
                { key: 'Billed', name: 'Billed Amount' },
                { key: 'Collected', name: 'Collected Amount' },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Active Users" icon={Activity} description="Delivery boys active in the last 24 hours" />
          <ul className="divide-y divide-border/60 px-5 pb-4 pt-2">
            {active.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-2.5">
                <Avatar name={u.name} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{u.name}</span>
                  <span className="text-[12px] text-muted-foreground">{u.role}</span>
                </span>
                <Badge tone="success" dot>
                  Active
                </Badge>
              </li>
            ))}
            {!active.length && <li className="py-8 text-center text-sm text-muted-foreground">Nobody has been active in the last 24 hours.</li>}
          </ul>
        </Card>
      </div>
    </>
  )
}
