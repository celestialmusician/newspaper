import { ArrowRight, CheckCircle2, ClipboardCheck, Clock, MapPinned, Package, Users, XCircle } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BillDialog } from '@/components/BillDialog'
import { RouteMap, type MapStop } from '@/components/Maps'
import { DashboardHero } from '@/components/fx/Hero'
import { Button } from '@/components/ui/button'
import { Avatar, Card, CardBody, CardHeader, EmptyState, PageHeader, PageSkeleton, Progress, StatCard } from '@/components/ui/misc'
import { customerOutstanding } from '@/domain/billing'
import { useScope, useWarmup } from '@/hooks/app'
import { formatINR } from '@/lib/utils'
import { greeting } from './AdminDashboard'
import { todayStats } from './shared'

export default function ExecutiveDashboard() {
  const { db, actor, customers, subscriptions, routes } = useScope()
  const ready = useWarmup()
  const navigate = useNavigate()
  const me = db.executives.find((e) => e.id === actor.userId)!
  const [billFor, setBillFor] = React.useState<string | null>(null)

  const today = React.useMemo(() => todayStats(db, subscriptions), [db, subscriptions])
  const load = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const o of today.occ) m.set(o.productId, (m.get(o.productId) ?? 0) + o.quantity)
    return [...m.entries()].map(([pid, q]) => ({ p: db.products.find((x) => x.id === pid)!, q })).sort((a, b) => b.q - a.q)
  }, [today, db.products])
  const dues = customers.map((c) => ({ c, due: customerOutstanding(db, c.id) })).filter((x) => x.due > 0).sort((a, b) => b.due - a.due)

  if (!ready) return <PageSkeleton />
  if (!routes.length)
    return (
      <>
        <PageHeader kicker="Delivery Executive" title={<>Good {greeting()}, <span className="text-gradient">{me.name.split(' ')[0]}</span></>} />
        <EmptyState icon={MapPinned} title="No route assigned yet" description="Your agent will assign a delivery route. Once assigned, customers, addresses, map pins and instructions appear here automatically." />
      </>
    )

  const stops: MapStop[] = routes.flatMap((r) =>
    r.stops.map((s, i) => {
      const c = db.customers.find((x) => x.id === s.customerId)!
      const os = today.occ.filter((o) => o.customerId === c.id)
      const tone = !os.length ? 'navy' : os.every((o) => o.status === 'delivered') ? 'done' : os.some((o) => o.status === 'missed') ? 'missed' : 'pending'
      return { id: c.id, lat: c.lat, lng: c.lng, label: `${i + 1}. ${c.name}`, sub: c.houseName, seq: i + 1, tone }
    }),
  )
  const pct = today.total ? (today.delivered / today.total) * 100 : 0

  return (
    <>
      <DashboardHero kicker={`Delivery Executive · ${me.code}`} title={<>Good {greeting()}, <span className="text-gradient">{me.name.split(' ')[0]}</span></>} description={routes.map((r) => `${r.code} · ${r.name}`).join('  |  ')}>
        <div className="hero-panel rounded-lg p-4 shadow-[0_12px_28px_-12px_var(--glow)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
            <div className="min-w-0 flex-1">
              <div className="kicker text-white/55">Today's route</div>
              <div className="truncate font-display text-xl font-semibold">{routes[0]!.name}</div>
              <div className="mt-3 flex items-center gap-3">
                <Progress value={pct} tone="masthead" className="h-2.5 flex-1 bg-white/15 ring-white/10 [&>div]:bg-white" />
                <span className="tabular text-sm font-semibold">
                  {today.delivered}/{today.total}
                </span>
              </div>
            </div>
            <Button size="xl" variant="accent" className="w-full xl:w-auto hover:shadow-[0_12px_28px_-12px_var(--glow)]" onClick={() => navigate('/deliveries/today')}>
              <ClipboardCheck /> {today.pending ? `Continue round · ${today.pending} left` : 'Open checklist'} <ArrowRight />
            </Button>
          </div>
        </div>
      </DashboardHero>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} label="Customers" value={customers.length} icon={Users} onClick={() => navigate('/customers')} />
        <StatCard index={1} label="Pending" value={today.pending} icon={Clock} tone="warning" onClick={() => navigate('/deliveries/today')} />
        <StatCard index={2} label="Completed" value={today.delivered} icon={CheckCircle2} tone="success" />
        <StatCard index={3} label="Missed" value={today.missed} icon={XCircle} tone="danger" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Route map" description="Stops in delivery order" action={<Link to="/routes" className="text-[13px] font-semibold text-primary">Full route</Link>} />
          <CardBody>
            <RouteMap stops={stops} height={360} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Assigned products" icon={Package} description="Copies to carry today" />
          <ul className="divide-y divide-border/60 px-5 pb-3">
            {load.map(({ p, q }) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="h-8 w-1.5 rounded-full" style={{ background: p.color }} />
                <span className="flex-1">
                  <span className="block text-[14px] font-semibold">{p.name}</span>
                  <span className="text-[12px] text-muted-foreground">{p.language} · {p.type}</span>
                </span>
                <span className="tabular font-display text-2xl font-semibold text-primary">{q}</span>
              </li>
            ))}
            {!load.length && <li className="py-6 text-center text-sm text-muted-foreground">No deliveries today.</li>}
          </ul>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Payment collection list" description="Customers on your route with pending bills — tap to open the bill" />
        <ul className="grid grid-cols-1 gap-px overflow-hidden px-5 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          {dues.map(({ c, due }) => (
            <li key={c.id}>
              <button onClick={() => setBillFor(c.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-accent">
                <Avatar name={c.name} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{c.houseName}</span>
                </span>
                <span className="tabular text-[15px] font-bold text-destructive">{formatINR(due)}</span>
              </button>
            </li>
          ))}
          {!dues.length && <li className="py-6 text-sm text-muted-foreground">No pending payments on your route.</li>}
        </ul>
      </Card>
      <BillDialog customerId={billFor} open={!!billFor} onOpenChange={(o) => !o && setBillFor(null)} />
    </>
  )
}
