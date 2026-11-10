import { ArrowLeft, Bell, CreditCard, HandCoins, MapPin, MessageSquareWarning, Pencil, Phone, Plus, Power, UserX } from 'lucide-react'
import * as React from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BillDialog } from '@/components/BillDialog'
import { CustomerDialog } from '@/components/CustomerDialog'
import { DeliveryCalendar } from '@/components/DeliveryCalendar'
import { RouteMap } from '@/components/Maps'
import { PayDialog } from '@/components/PayDialog'
import { ComplaintList, DeliveryHistoryTable, InvoiceTable, PaymentTable } from '@/components/records'
import { SubscriptionCards, SubscriptionDialog } from '@/components/subscriptions'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, KeyValue, Money, StatCard, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { can, canSeeCustomer, executiveOf, userName } from '@/domain/access'
import { customerOutstanding, invoiceRemaining, isOverdue } from '@/domain/billing'
import { chainByLevel } from '@/domain/locations'
import { activeDiscounts } from '@/domain/pricing'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import { useActor, useData, useRun } from '@/hooks/app'
import { fmtDate, fmtDateTime, monthEndISO, monthStartISO, relativeTime, todayISO } from '@/lib/dates'
import { formatINR, formatMobile } from '@/lib/utils'
import { customers as api } from '@/services/api'

const TABS = [
  ['overview', 'Overview'],
  ['personal', 'Personal Details'],
  ['subscriptions', 'Subscriptions'],
  ['calendar', 'Delivery Calendar'],
  ['history', 'Delivery History'],
  ['billing', 'Billing & Invoices'],
  ['payments', 'Payment History'],
  ['pending', 'Pending Amount'],
  ['complaints', 'Complaints'],
  ['notifications', 'Notifications'],
] as const

export default function CustomerProfile() {
  const { id = '' } = useParams()
  const db = useData()
  const actor = useActor()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'overview'
  const confirm = useConfirm()
  const { run } = useRun()
  const [edit, setEdit] = React.useState(false)
  const [newSub, setNewSub] = React.useState(false)
  const [bill, setBill] = React.useState(false)
  const [pay, setPay] = React.useState(false)

  const c = db.customers.find((x) => x.id === id)
  if (!c || !canSeeCustomer(db, actor, id)) return <EmptyState icon={UserX} title="Customer not found" description="This customer does not exist or is not assigned to you." action={<Button asChild><Link to="/customers">Back to customers</Link></Button>} />

  const subs = db.subscriptions.filter((s) => s.customerId === c.id)
  const invoices = db.invoices.filter((i) => i.customerId === c.id)
  const pays = db.payments.filter((p) => p.customerId === c.id)
  const complaints = db.complaints.filter((x) => x.customerId === c.id)
  const notes = db.notifications.filter((n) => n.to === c.id)
  const outstanding = customerOutstanding(db, c.id)
  const exec = executiveOf(db, c)
  const route = db.routes.find((r) => r.id === c.routeId)
  const chain = chainByLevel(db, c.areaId)
  const canWrite = can(db, actor, 'customer.write')
  const canSub = can(db, actor, 'subscription.write')
  const canCollect = can(db, actor, 'payment.collect')
  const discounts = activeDiscounts(db, c.id, monthStartISO(todayISO()), monthEndISO(todayISO()))
  const seq = route ? route.stops.findIndex((s) => s.customerId === c.id) + 1 : 0
  const instructions = route?.stops.find((s) => s.customerId === c.id)?.instructions

  return (
    <>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <Card className="mb-6 overflow-hidden">
        <div className="paper-grain flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
          <Avatar name={c.name} size={68} className="text-2xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-[30px] font-semibold leading-tight text-primary">{c.name}</h1>
              <StatusBadge status={c.status} />
              {c.selfRegistered && <Badge tone="info">Self-registered</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted-foreground">
              <span>{c.code}</span>
              <a href={`tel:${c.mobile}`} className="inline-flex items-center gap-1 hover:text-primary">
                <Phone className="size-3.5" /> {formatMobile(c.mobile)}
              </a>
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" /> {c.houseName}, {chain.area?.name}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-[12.5px]">
              <Badge tone="navy">Agent: {userName(db, c.agentId)}</Badge>
              <Badge tone={exec ? 'success' : 'warning'}>Executive: {exec?.name ?? 'Not assigned'}</Badge>
              {route && <Badge tone="neutral">{route.code} · stop #{seq}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {canSub && (
              <Button variant="outline" onClick={() => setNewSub(true)}>
                <Plus /> Subscription
              </Button>
            )}
            {canCollect && outstanding > 0 && (
              <Button variant="success" onClick={() => setBill(true)}>
                <HandCoins /> Collect {formatINR(outstanding)}
              </Button>
            )}
            {actor.role === 'admin' && (
              <Button
                variant="ghost"
                onClick={async () => {
                  const next = c.status === 'active' ? 'inactive' : 'active'
                  if (await confirm({ title: `${next === 'active' ? 'Activate' : 'Deactivate'} account?`, description: 'History, bills and subscriptions are preserved.', tone: next === 'inactive' ? 'destructive' : 'default', confirmLabel: next === 'active' ? 'Activate' : 'Deactivate' }))
                    await run(() => api.update(c.id, { status: next }), `Account ${next}`)
                }}
              >
                <Power /> {c.status === 'active' ? 'Deactivate' : 'Activate'}
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v }, { replace: true })}>
        <TabsList>
          {TABS.map(([k, l]) => (
            <TabsTrigger key={k} value={k}>
              {l}
              {k === 'pending' && outstanding > 0 && <span className="ml-1.5 rounded-full bg-destructive/10 px-1.5 text-[11px] text-destructive">{formatINR(outstanding, true)}</span>}
              {k === 'complaints' && complaints.some((x) => x.status !== 'resolved') && <span className="ml-1.5 size-1.5 rounded-full bg-masthead inline-block" />}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active subscriptions" value={subs.filter((s) => deriveSubscriptionStatus(s) === 'active').length} icon={Plus} onClick={() => setParams({ tab: 'subscriptions' })} />
            <StatCard label="Outstanding" value={formatINR(outstanding)} icon={HandCoins} tone={outstanding ? 'danger' : 'success'} onClick={() => setParams({ tab: 'pending' })} />
            <StatCard label="Total paid" value={formatINR(pays.reduce((s, p) => s + p.amount, 0), true)} icon={CreditCard} tone="success" onClick={() => setParams({ tab: 'payments' })} />
            <StatCard label="Open complaints" value={complaints.filter((x) => x.status !== 'resolved').length} icon={MessageSquareWarning} tone="warning" onClick={() => setParams({ tab: 'complaints' })} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Delivery location" description={instructions ? `Instructions: ${instructions}` : 'No special instructions'} />
              <CardBody>
                <RouteMap stops={[{ id: c.id, lat: c.lat, lng: c.lng, label: c.name, sub: c.address, seq: seq || '•', tone: 'pending' }]} height={260} showPath={false} />
                <p className="mt-2 text-[13px] text-muted-foreground">{c.address}</p>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Subscriptions" action={<button className="text-[13px] font-semibold text-primary" onClick={() => setParams({ tab: 'subscriptions' })}>Manage</button>} />
              <ul className="divide-y divide-border/60 px-5 pb-3">
                {subs.map((s) => {
                  const p = db.products.find((x) => x.id === s.productId)!
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                        <b>{p.name}</b>
                      </span>
                      <StatusBadge status={deriveSubscriptionStatus(s)} />
                    </li>
                  )
                })}
              </ul>
              {discounts.length > 0 && (
                <div className="mx-5 mb-4 rounded-lg bg-success/8 px-3 py-2 text-[12.5px] text-success">
                  Discounts: {discounts.map((d) => `${d.kind === 'percentage' ? `${d.value}%` : `₹${d.value}`} ${d.category}`).join(', ')}
                </div>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="personal">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Personal details" />
              <CardBody>
                <KeyValue
                  items={[
                    ['Full name', c.name],
                    ['Mobile', formatMobile(c.mobile)],
                    ['Alternate mobile', c.altMobile ? formatMobile(c.altMobile) : '—'],
                    ['WhatsApp', c.whatsapp ? formatMobile(c.whatsapp) : '—'],
                    ['Email', c.email ?? '—'],
                    ['Gender', c.gender ?? '—'],
                    ['Date of birth', fmtDate(c.dob)],
                    ['ID proof', c.idProof === 'None' ? '—' : `${c.idProof} · ${c.idNumber ?? ''}`],
                  ]}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Address & account" />
              <CardBody>
                <KeyValue
                  items={[
                    ['Country', chain.country?.name],
                    ['State', chain.state?.name],
                    ['District', chain.district?.name],
                    ['City / Town', chain.city?.name],
                    ['Locality', chain.locality?.name],
                    ['Area', chain.area?.name],
                    ['Pincode', chain.area?.pincode],
                    ['House', c.houseName],
                    ['Landmark', c.landmark ?? '—'],
                    ['Coordinates', `${c.lat}, ${c.lng}`],
                    ['Customer ID', c.code],
                    ['Registered', fmtDate(c.registeredOn)],
                    ['Security deposit', formatINR(c.securityDeposit)],
                    ['Handling charge', `${formatINR(c.handlingCharge)} / month`],
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="subscriptions">
          {canSub && (
            <div className="mb-4 flex justify-end">
              <Button onClick={() => setNewSub(true)}>
                <Plus /> New subscription
              </Button>
            </div>
          )}
          <SubscriptionCards subs={subs} />
        </TabsContent>

        <TabsContent value="calendar">
          <DeliveryCalendar subscriptions={subs} showCustomer={false} />
        </TabsContent>

        <TabsContent value="history">
          <DeliveryHistoryTable subscriptions={subs} showCustomer={false} exportName={`deliveries-${c.code}`} />
        </TabsContent>

        <TabsContent value="billing">
          <InvoiceTable invoices={invoices} showCustomer={false} exportName={`invoices-${c.code}`} />
        </TabsContent>

        <TabsContent value="payments">
          <PaymentTable payments={pays} showCustomer={false} exportName={`payments-${c.code}`} />
        </TabsContent>

        <TabsContent value="pending">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="p-5">
              <div className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">Total outstanding</div>
              <div className={`font-display text-4xl font-semibold ${outstanding ? 'text-destructive' : 'text-success'}`}>{formatINR(outstanding)}</div>
              <div className="mt-1 text-[13px] text-muted-foreground">{invoices.filter((i) => isOverdue(i)).length} overdue invoice(s)</div>
              <div className="mt-4 flex flex-col gap-2">
                {canCollect && outstanding > 0 && (
                  <Button variant="success" onClick={() => setBill(true)}>
                    <HandCoins /> Record collection
                  </Button>
                )}
                {actor.role === 'customer' && outstanding > 0 && (
                  <Button variant="accent" onClick={() => setPay(true)}>
                    <CreditCard /> Pay now
                  </Button>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Open invoices" description="Oldest dues are cleared first" />
              <ul className="divide-y divide-border/60 px-5 pb-3">
                {invoices.filter((i) => invoiceRemaining(i) > 0).map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 py-3">
                    <Link to={`/invoices/${i.id}`} className="hover:text-primary">
                      <div className="font-semibold">{i.number}</div>
                      <div className="text-[12.5px] text-muted-foreground">
                        Bill {formatINR(i.currentBill)} · paid {formatINR(i.paid)} · due {fmtDate(i.dueDate)}
                      </div>
                    </Link>
                    <div className="text-right">
                      <Money value={invoiceRemaining(i)} className="text-destructive" />
                      <div>{isOverdue(i) ? <StatusBadge status="overdue" /> : <StatusBadge status={i.status} />}</div>
                    </div>
                  </li>
                ))}
                {!invoices.some((i) => invoiceRemaining(i) > 0) && <li className="py-8 text-center text-sm text-muted-foreground">No pending amount.</li>}
              </ul>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="complaints">
          <ComplaintList complaints={complaints} />
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <ul className="divide-y divide-border/60">
              {notes.map((n) => (
                <li key={n.id} className="flex gap-3 px-5 py-3">
                  <Bell className="mt-0.5 size-4 text-masthead" />
                  <div className="flex-1">
                    <div className="text-[14px] font-semibold">{n.title}</div>
                    <div className="text-[13px] text-muted-foreground">{n.body}</div>
                  </div>
                  <span className="text-[12px] text-muted-foreground" title={fmtDateTime(n.at)}>
                    {relativeTime(n.at)}
                  </span>
                </li>
              ))}
              {!notes.length && <li className="py-10 text-center text-sm text-muted-foreground">No notifications sent to this customer.</li>}
            </ul>
          </Card>
        </TabsContent>
      </Tabs>

      <CustomerDialog open={edit} onOpenChange={setEdit} customer={c} />
      <SubscriptionDialog open={newSub} onOpenChange={setNewSub} mode="new" customerId={c.id} />
      <BillDialog customerId={c.id} open={bill} onOpenChange={setBill} />
      {actor.role === 'customer' && <PayDialog customerId={c.id} open={pay} onOpenChange={setPay} />}
    </>
  )
}
