import { ArrowLeft, HandCoins, IndianRupee, Landmark, Pencil, Route as RouteIcon, Truck, Users } from 'lucide-react'
import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { PaymentTable } from '@/components/records'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, KeyValue, StatCard, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { agentSettlement, customerOutstanding } from '@/domain/billing'
import { useData } from '@/hooks/app'
import { fmtDate } from '@/lib/dates'
import { formatINR, formatMobile } from '@/lib/utils'
import { AgentDialog } from './Agents'

export default function AgentProfile() {
  const { id } = useParams()
  const db = useData()
  const [edit, setEdit] = React.useState(false)
  const a = db.agents.find((x) => x.id === id)
  if (!a) return <EmptyState icon={Landmark} title="Agent not found" />
  const s = agentSettlement(db, a.id)
  const customers = db.customers.filter((c) => c.agentId === a.id)
  const execs = db.executives.filter((e) => e.agentId === a.id)
  const routes = db.routes.filter((r) => r.agentId === a.id)
  return (
    <>
      <Link to="/agents" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Agents
      </Link>
      <Card className="paper-grain mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
        <Avatar name={a.name} size={64} />
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold text-primary">{a.name}</h1>
            <StatusBadge status={a.status} />
          </div>
          <div className="text-[14px] text-muted-foreground">
            {a.code} · {a.agencyName} · {formatMobile(a.mobile)}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {a.areaIds.map((id) => (
              <Badge key={id} tone="navy">
                {db.locations.find((l) => l.id === id)?.name}
              </Badge>
            ))}
          </div>
        </div>
        <Button variant="outline" onClick={() => setEdit(true)}>
          <Pencil /> Edit agent
        </Button>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Customers" value={customers.length} icon={Users} />
        <StatCard label="Executives / routes" value={`${execs.length} / ${routes.length}`} icon={Truck} tone="info" />
        <StatCard label="Customer dues" value={formatINR(s.customerOutstanding, true)} icon={HandCoins} tone="danger" />
        <StatCard label="Balance owed to agency" value={formatINR(s.outstandingAgentBalance, true)} icon={IndianRupee} tone="accent" hint={`Remitted ${formatINR(s.remitted, true)}`} />
      </div>
      <Tabs defaultValue="customers" className="mt-6">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="team">Executives & routes</TabsTrigger>
          <TabsTrigger value="money">Settlement</TabsTrigger>
          <TabsTrigger value="payments">Collections</TabsTrigger>
        </TabsList>
        <TabsContent value="customers">
          <Card>
            <ul className="divide-y divide-border/60">
              {customers.map((c) => (
                <li key={c.id}>
                  <Link to={`/customers/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-accent/50">
                    <Avatar name={c.name} size={32} />
                    <span className="flex-1">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="text-[12.5px] text-muted-foreground">
                        {c.code} · {c.houseName}
                      </span>
                    </span>
                    <span className="tabular font-semibold text-destructive">{formatINR(customerOutstanding(db, c.id))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>
        <TabsContent value="team">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {routes.map((r) => (
              <Link key={r.id} to={`/routes/${r.id}`}>
                <Card className="p-4 transition hover:shadow-pop">
                  <div className="flex items-center gap-2">
                    <RouteIcon className="size-4 text-masthead" />
                    <b>{r.name}</b>
                    <Badge tone="navy">{r.code}</Badge>
                  </div>
                  <div className="mt-1 text-[13px] text-muted-foreground">
                    {r.stops.length} stops · {db.executives.find((e) => e.id === r.executiveId)?.name ?? 'Unassigned'}
                  </div>
                </Card>
              </Link>
            ))}
            {execs.filter((e) => !routes.some((r) => r.executiveId === e.id)).map((e) => (
              <Link key={e.id} to={`/executives/${e.id}`}>
                <Card className="border-dashed p-4">
                  <b>{e.name}</b> <span className="text-[13px] text-muted-foreground">· no route assigned (available for handover)</span>
                </Card>
              </Link>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="money">
          <Card>
            <CardHeader title="Agency settlement" description="All billed periods" />
            <CardBody>
              <KeyValue
                cols={3}
                items={[
                  ['Agency purchase value', formatINR(s.purchaseValue)],
                  ['Agent selling value', formatINR(s.agentValue)],
                  ['Customer selling value', formatINR(s.customerValue)],
                  ['Agency margin', formatINR(s.agencyMargin)],
                  ['Agent margin', formatINR(s.agentMargin)],
                  ['Customer collections', formatINR(s.customerCollections)],
                  ['Collected in person', formatINR(s.agentCollections)],
                  ['Remitted to agency', formatINR(s.remitted)],
                  ['Outstanding agent balance', <b key="b" className="text-destructive">{formatINR(s.outstandingAgentBalance)}</b>],
                ]}
              />
              <div className="mt-4 text-[13px] text-muted-foreground">
                Joined {fmtDate(a.joiningDate)} · Max discount {a.maxDiscountPct}% · {a.canManageRoutes ? 'Manages own routes' : 'Routes managed by admin'}
              </div>
              <Button className="mt-4" variant="outline" asChild>
                <Link to="/settlements">Record remittance</Link>
              </Button>
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <PaymentTable payments={db.payments.filter((p) => p.agentId === a.id)} exportName={`collections-${a.code}`} />
        </TabsContent>
      </Tabs>
      {edit && <AgentDialog agent={a} onClose={() => setEdit(false)} />}
    </>
  )
}
