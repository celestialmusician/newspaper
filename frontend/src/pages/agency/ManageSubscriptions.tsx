import { Plus, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, NativeSelect } from '@/components/ui/form'
import { Card, PageHeader, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import type { Frequency, Product, Subscription } from '@/domain/types'
import { errorMessage, useActor, useData } from '@/hooks/app'
import { dayOfMonth, diffDays, fmtDate, todayISO, WEEKDAYS, weekday } from '@/lib/dates'
import { formatINR, initials } from '@/lib/utils'
import { areaLabel } from '@/domain/locations'
import { subscriptions as api } from '@/services/api'

interface GridRow {
  key: string
  subId?: string
  manage: 'active' | 'unsubscribe' | 'modify'
  type: 'all' | 'individual'
  productId: string
  qty: number
  from: string
  to: string
  skip: boolean
  dayQty: number[]
}

let seq = 0
const fresh = (): GridRow => ({ key: `n${++seq}`, manage: 'active', type: 'all', productId: '', qty: 1, from: todayISO(), to: '', skip: false, dayQty: [1, 1, 1, 1, 1, 1, 1] })
const fromSub = (s: Subscription): GridRow => ({ key: s.id, subId: s.id, manage: 'active', type: s.dayQuantities ? 'individual' : 'all', productId: s.productId, qty: s.quantity, from: s.startDate, to: s.endDate ?? '', skip: false, dayQty: s.dayQuantities ?? [1, 1, 1, 1, 1, 1, 1] })

/** Schedule defaults for a title when the grid only asks for dates and a quantity. */
function scheduleFor(p: Product, from: string): { frequency: Frequency; weekdays: number[]; monthDays: number[]; customDates: string[] } {
  const wd = p.publishWeekdays?.length ? p.publishWeekdays : [weekday(from)]
  const md = p.publishDates?.length ? p.publishDates : [dayOfMonth(from)]
  switch (p.defaultFrequency) {
    case 'weekly':
      return { frequency: 'weekly', weekdays: [wd[0]!], monthDays: [], customDates: [] }
    case 'twice_weekly':
      return { frequency: 'twice_weekly', weekdays: wd.length >= 2 ? wd.slice(0, 2) : [wd[0]!, (wd[0]! + 3) % 7], monthDays: [], customDates: [] }
    case 'monthly':
      return { frequency: 'monthly', weekdays: [], monthDays: [md[0]!], customDates: [] }
    case 'twice_monthly':
      return { frequency: 'twice_monthly', weekdays: [], monthDays: md.length >= 2 ? md.slice(0, 2) : [1, 16], customDates: [] }
    case 'custom':
      return { frequency: 'custom', weekdays: [], monthDays: [], customDates: [from] }
    default:
      return { frequency: p.defaultFrequency, weekdays: [], monthDays: [], customDates: [] }
  }
}

/** CRM > Manage Subscriptions: pick a route and customer, then edit their products in one grid. */
export default function ManageSubscriptions() {
  const db = useData()
  const actor = useActor()
  const today = todayISO()
  const [routeId, setRouteId] = React.useState('')
  const [customerId, setCustomerId] = React.useState('')
  const [rows, setRows] = React.useState<GridRow[]>([])
  const [saving, setSaving] = React.useState(false)

  const routes = db.routes.filter((r) => r.agentId === actor.userId)
  const customers = db.customers.filter((c) => c.agentId === actor.userId && (!routeId || c.routeId === routeId))
  const customer = db.customers.find((c) => c.id === customerId)
  const route = db.routes.find((r) => r.id === customer?.routeId)
  const boy = db.executives.find((e) => e.id === route?.executiveId)
  const subs = db.subscriptions.filter((s) => s.customerId === customerId)
  const products = db.products.filter((p) => p.status === 'active' && (!p.ownerId || p.ownerId === actor.userId))

  const loadGrid = React.useCallback(
    (id: string) => setRows(db.subscriptions.filter((s) => s.customerId === id && !['cancelled', 'expired'].includes(deriveSubscriptionStatus(s))).map(fromSub)),
    [db.subscriptions],
  )
  const pickCustomer = (id: string) => {
    setCustomerId(id)
    if (id) loadGrid(id)
    else setRows([])
  }
  const patch = (key: string, p: Partial<GridRow>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const days = (r: GridRow) => (r.to ? Math.max(0, diffDays(r.to, r.from) + 1) : null)

  const save = async () => {
    if (!customer) return toast.error('Select a route and a customer first.')
    setSaving(true)
    let done = 0
    const failed: string[] = []
    for (const r of rows) {
      const product = products.find((p) => p.id === r.productId) ?? db.products.find((p) => p.id === r.productId)
      const label = product?.name ?? 'New product'
      try {
        if (r.subId) {
          if (r.manage === 'unsubscribe') await api.cancel(r.subId, r.to && r.to >= today ? r.to : today, 'Un-subscribed in CRM')
          else if (r.manage === 'modify') await api.update(r.subId, { quantity: r.type === 'individual' ? Math.max(...r.dayQty) : r.qty, endDate: r.to || null, dayQuantities: r.type === 'individual' ? r.dayQty : undefined })
          else if (!r.skip) continue
          if (r.skip && r.manage !== 'unsubscribe') await api.pause(r.subId, r.from < today ? today : r.from, r.to || null, 'Skipped in CRM')
          done++
        } else {
          if (!product) throw new Error('Select the product.')
          if (r.manage !== 'active') continue
          const sched = r.type === 'individual' ? { frequency: 'daily' as Frequency, weekdays: [], monthDays: [], customDates: [] } : scheduleFor(product, r.from)
          const created = await api.create({ customerId: customer.id, productId: product.id, startDate: r.from, endDate: r.to || null, quantity: r.type === 'individual' ? Math.max(...r.dayQty) : r.qty, dayQuantities: r.type === 'individual' ? r.dayQty : undefined, ...sched })
          if (r.skip) await api.pause(created.id, r.from < today ? today : r.from, r.to || null, 'Skipped in CRM')
          done++
        }
      } catch (e) {
        failed.push(`${label}: ${errorMessage(e)}`)
      }
    }
    setSaving(false)
    if (failed.length) toast.error(failed.join('\n'))
    else if (done) toast.success(`${done} subscription change${done > 1 ? 's' : ''} saved`)
    else toast.message('Nothing to save.')
    if (!failed.length) loadGrid(customer.id)
  }

  return (
    <>
      <PageHeader kicker="Master · CRM" title="Manage Subscriptions" description="Choose a customer, then add, change, skip or stop their papers." />
      <Card className="crm-head">
        <div className="@container grid gap-3 p-4 sm:p-5 @xl:grid-cols-2">
            <Field label="Route" required>
              <NativeSelect
                value={routeId}
                onChange={(e) => {
                  setRouteId(e.target.value)
                  pickCustomer('')
                }}
              >
                <option value="">Select Route</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Customer Name" required>
              <NativeSelect value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
                <option value="">Select Customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.serialNo ? ` · ${c.serialNo}` : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
        </div>
        {customer ? (
          <div className="crm-profile">
            <span className="rec-avatar size-12 text-base">{initials(customer.name)}</span>
            <dl className="crm-facts">
              {(
                [
                    ['Customer Name', customer?.name ?? ''],
                    ['Area', customer ? areaLabel(db, customer.areaId) : ''],
                    ['Contact Number', customer?.mobile ?? ''],
                    ['Delivery Boy', boy?.name ?? ''],
                    ['Security Deposit', customer ? formatINR(customer.securityDeposit) : ''],
                ] as [string, string][]
              ).map(([k, val]) => (
                <div key={k} className="min-w-0">
                  <dt>{k}</dt>
                  <dd>{val || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="crm-profile justify-center text-[13.5px] text-muted-foreground">Pick a route and a customer to manage their papers.</p>
        )}
      </Card>

      <Tabs defaultValue="update" className="mt-5">
        <TabsList>
          <TabsTrigger value="update">Update CRM</TabsTrigger>
          <TabsTrigger value="history">Subscription History · {subs.length}</TabsTrigger>
        </TabsList>
        <TabsContent value="update" className="grid gap-3">
          {rows.map((r) => (
            <div key={r.key} className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="grid grid-cols-2 items-end gap-3 sm:grid-cols-4 xl:grid-cols-[9rem_9rem_minmax(0,1.4fr)_5rem_9rem_9rem_4.5rem_4rem_2.5rem]">
                <Field label="Manage Subscriptions">
                  <NativeSelect value={r.manage} onChange={(e) => patch(r.key, { manage: e.target.value as GridRow['manage'] })} className="h-10">
                    <option value="active">Active</option>
                    {r.subId && <option value="unsubscribe">Un-Subscribe</option>}
                    {r.subId && <option value="modify">Modify</option>}
                  </NativeSelect>
                </Field>
                <Field label="Type">
                  <NativeSelect value={r.type} onChange={(e) => patch(r.key, { type: e.target.value as GridRow['type'] })} className="h-10">
                    <option value="all">All Day</option>
                    <option value="individual">Individual Day</option>
                  </NativeSelect>
                </Field>
                <Field label="Product Name" className="col-span-2 sm:col-span-1">
                  <NativeSelect value={r.productId} disabled={!!r.subId} onChange={(e) => patch(r.key, { productId: e.target.value })} className="h-10">
                    <option value="">Select Product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Qty">
                  <Input type="number" min={1} max={50} value={r.type === 'all' ? r.qty : ''} disabled={r.type === 'individual'} onChange={(e) => patch(r.key, { qty: Number(e.target.value) })} className="h-10" />
                </Field>
                <Field label="Start date">
                  <Input type="date" value={r.from} disabled={!!r.subId} onChange={(e) => patch(r.key, { from: e.target.value })} className="h-10" />
                </Field>
                <Field label="End date">
                  <Input type="date" min={r.from} value={r.to} onChange={(e) => patch(r.key, { to: e.target.value })} className="h-10" />
                </Field>
                <Field label="Skip">
                  <Checkbox checked={r.skip} onChange={(e) => patch(r.key, { skip: e.target.checked })} aria-label="Skip" className="h-7" />
                </Field>
                <Field label="Days">
                  <span className="tabular flex h-7 items-center text-[15px] font-semibold">{days(r) ?? '—'}</span>
                </Field>
                {!r.subId && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove row" className="mb-1 text-destructive" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))}>
                    <X />
                  </Button>
                )}
              </div>
              {r.type === 'individual' && (
                <div className="grid grid-cols-7 gap-2">
                  {WEEKDAYS.map((w, i) => (
                    <label key={w} className="flex flex-col items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">
                      {w}
                      <Input type="number" min={0} max={50} value={r.dayQty[i]} onChange={(e) => patch(r.key, { dayQty: r.dayQty.map((q, j) => (j === i ? Number(e.target.value) : q)) })} className="h-9 px-1 text-center" aria-label={`${w} quantity`} />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          {!rows.length && <p className="py-4 text-center text-sm text-muted-foreground">{customer ? 'No active products. Add one below.' : 'Select a customer to manage their papers.'}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={!customer} onClick={() => setRows((r) => [...r, fresh()])}>
              <Plus /> Add new product
            </Button>
            <Button type="button" disabled={!customer || !rows.length} loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="history">
          {subs.length ? (
            <ol className="sub-timeline">
              {subs.map((s, i) => {
                const end = s.cancelledOn ?? s.endDate
                return (
                  <li key={s.id} className="sub-stop">
                    <span className="sub-dot" aria-hidden />
                    <div className="rec-card">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold">
                          <span className="tabular text-muted-foreground">{i + 1}. </span>
                          {db.products.find((p) => p.id === s.productId)?.name}
                        </p>
                        <StatusBadge status={deriveSubscriptionStatus(s)} />
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-border/60 pt-3 text-[13px]">
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Start date</dt>
                          <dd>{fmtDate(s.startDate)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">End date</dt>
                          <dd>{fmtDate(end)}</dd>
                        </div>
                        <div>
                          <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Days</dt>
                          <dd className="tabular">{Math.max(0, diffDays(end && end < today ? end : today, s.startDate) + 1)}</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                )
              })}
            </ol>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">{customer ? 'No subscriptions yet.' : 'Select a customer to see their subscriptions.'}</p>
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
