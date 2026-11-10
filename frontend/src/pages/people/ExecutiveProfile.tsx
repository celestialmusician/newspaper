import { ArrowLeft, ArrowRightLeft, CheckCircle2, HandCoins, Pencil, PhoneCall, Route as RouteIcon, Truck, Users } from 'lucide-react'
import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { HandoverDialog } from '@/components/HandoverDialog'
import { PaymentTable } from '@/components/records'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardHeader, EmptyState, StatCard, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { DataTable } from '@/components/ui/data-table'
import { can, userName } from '@/domain/access'
import type { Route } from '@/domain/types'
import { useActor, useData } from '@/hooks/app'
import { fmtDate, fmtDateTime, fmtTime } from '@/lib/dates'
import { formatINR, formatMobile, sum } from '@/lib/utils'
import { ExecutiveDialog, executivePerformance } from './Executives'

export default function ExecutiveProfile() {
  const { id } = useParams()
  const db = useData()
  const actor = useActor()
  const [edit, setEdit] = React.useState(false)
  const [handover, setHandover] = React.useState<Route | null>(null)
  const e = db.executives.find((x) => x.id === id)
  if (!e || (actor.role === 'agent' && e.agentId !== actor.userId)) return <EmptyState icon={Truck} title="Executive not found" />
  const routes = db.routes.filter((r) => r.executiveId === e.id)
  const perf = executivePerformance(db, e.id)
  const handovers = db.handovers.filter((h) => h.toExecutiveId === e.id || h.fromExecutiveId === e.id)
  const pays = db.payments.filter((p) => p.collectedBy === e.id)
  const recs = Object.values(db.deliveries)
    .filter((r) => r.executiveId === e.id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 300)
  const canHand = can(db, actor, 'route.handover')

  return (
    <>
      <Link to="/executives" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Delivery executives
      </Link>
      <Card className="paper-grain mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <Avatar name={e.name} size={64} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold text-primary">{e.name}</h1>
            <StatusBadge status={e.status} />
            {e.canCollectCash && <Badge tone="success">Cash collection</Badge>}
          </div>
          <div className="text-[14px] text-muted-foreground">
            {e.code} · {formatMobile(e.mobile)} · Agent {userName(db, e.agentId)} · Joined {fmtDate(e.joiningDate)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[13.5px]">
            <PhoneCall className="size-3.5 text-muted-foreground" />
            {e.altMobile ? (
              <a href={`tel:${e.altMobile}`} className="tabular font-semibold hover:underline">
                {formatMobile(e.altMobile)} <span className="font-normal text-muted-foreground">· {e.altMobileRelation}</span>
              </a>
            ) : (
              <span className="text-muted-foreground">No alternate number — add one from Edit</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {e.areaIds.map((a) => (
              <Badge key={a} tone="navy">
                {db.locations.find((l) => l.id === a)?.name}
              </Badge>
            ))}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEdit(true)}>
          <Pencil /> Edit
        </Button>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Assigned routes" value={routes.length} icon={RouteIcon} />
        <StatCard label="Assigned customers" value={sum(routes.map((r) => r.stops.length))} icon={Users} tone="info" />
        <StatCard label="30-day delivery rate" value={perf.total ? `${perf.rate.toFixed(1)}%` : '—'} icon={CheckCircle2} tone="success" hint={`${perf.missed} missed of ${perf.total}`} />
        <StatCard label="Cash collected" value={formatINR(sum(pays.map((p) => p.amount)), true)} icon={HandCoins} tone="accent" hint={`${pays.filter((p) => !p.verified).length} awaiting verification`} />
      </div>
      <Tabs defaultValue="routes" className="mt-6">
        <TabsList>
          <TabsTrigger value="routes">Routes</TabsTrigger>
          <TabsTrigger value="history">Delivery history</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
          <TabsTrigger value="handovers">Handovers</TabsTrigger>
        </TabsList>
        <TabsContent value="routes">
          {!routes.length ? (
            <EmptyState icon={RouteIcon} title="No routes" description="Assign or hand over a route from the Routes page." />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {routes.map((r) => (
                <Card key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/routes/${r.id}`} className="hover:text-primary">
                      <div className="font-display text-lg font-semibold">{r.name}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {r.code} · {r.stops.length} stops
                      </div>
                    </Link>
                    {canHand && (
                      <Button size="sm" variant="outline" onClick={() => setHandover(r)}>
                        <ArrowRightLeft /> Hand over
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="history">
          <DataTable
            rows={recs}
            rowKey={(r) => r.key}
            pageSize={25}
            dense
            search={(r) => `${userName(db, r.customerId)} ${db.products.find((p) => p.id === r.productId)?.name}`}
            exportName={`deliveries-${e.code}`}
            columns={[
              { key: 'date', header: 'Date', sort: (r) => r.date, cell: (r) => fmtDate(r.date) },
              { key: 'cust', header: 'Customer', sort: (r) => userName(db, r.customerId), cell: (r) => userName(db, r.customerId) },
              { key: 'prod', header: 'Product', cell: (r) => db.products.find((p) => p.id === r.productId)?.name },
              { key: 'st', header: 'Status', sort: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
              { key: 'at', header: 'Time', cell: (r) => fmtTime(r.actualAt) },
              { key: 'reason', header: 'Reason', cell: (r) => r.reason ?? '—' },
            ]}
          />
        </TabsContent>
        <TabsContent value="collections">
          <PaymentTable payments={pays} exportName={`collections-${e.code}`} />
        </TabsContent>
        <TabsContent value="handovers">
          <Card>
            <CardHeader title="Handover log" />
            <ul className="divide-y divide-border/60 px-5 pb-3">
              {handovers.map((h) => (
                <li key={h.id} className="py-3 text-[13.5px]">
                  <b>{db.routes.find((r) => r.id === h.routeId)?.name}</b>: {userName(db, h.fromExecutiveId)} → {userName(db, h.toExecutiveId)}
                  <div className="text-[12.5px] text-muted-foreground">
                    {fmtDateTime(h.at)} · by {userName(db, h.by)} {h.note && `· ${h.note}`}
                  </div>
                </li>
              ))}
              {!handovers.length && <li className="py-8 text-center text-sm text-muted-foreground">No handovers.</li>}
            </ul>
          </Card>
        </TabsContent>
      </Tabs>
      {edit && <ExecutiveDialog ex={e} onClose={() => setEdit(false)} />}
      {handover && <HandoverDialog route={handover} open onOpenChange={() => setHandover(null)} />}
    </>
  )
}
