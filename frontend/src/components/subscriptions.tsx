import { CalendarPlus, History, MoreVertical, Pause, Pencil, Play, RefreshCcw, Repeat, Shuffle, XCircle } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Field, Input, Segmented, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, useConfirm } from '@/components/ui/overlay'
import { can, executiveOf, userName } from '@/domain/access'
import { resolvePrice } from '@/domain/pricing'
import { billableDeliveries, deriveSubscriptionStatus, isPausedOn, matchesFrequency } from '@/domain/schedule'
import { FREQUENCY_META, type Frequency, type ID, type Subscription } from '@/domain/types'
import { useActor, useData, useRun } from '@/hooks/app'
import { addDaysISO, eachDay, fmtDate, fmtDateTime, fmtShort, todayISO, weekday, WEEKDAYS, WEEKDAYS_LONG } from '@/lib/dates'
import { cn, formatINR, round2 } from '@/lib/utils'
import { subscriptions as api, type SubscriptionInput } from '@/services/api'

type Mode = 'new' | 'edit' | 'change'

interface Values {
  customerId: ID
  productId: ID
  startDate: string
  endDate: string
  frequency: Frequency
  weekdays: number[]
  monthDays: number[]
  customDates: string[]
  quantity: number
  notes: string
}

function toValues(s: Subscription | undefined, customerId: ID, mode: Mode): Values {
  return {
    customerId: s?.customerId ?? customerId,
    productId: mode === 'change' ? '' : s?.productId ?? '',
    startDate: mode === 'new' || mode === 'change' ? addDaysISO(todayISO(), 1) : s!.startDate,
    endDate: s?.endDate ?? '',
    frequency: s?.frequency ?? 'daily',
    weekdays: s?.weekdays ?? [],
    monthDays: s?.monthDays ?? [],
    customDates: s?.customDates ?? [],
    quantity: s?.quantity ?? 1,
    notes: s?.notes ?? '',
  }
}

function asInput(v: Values): SubscriptionInput {
  return {
    customerId: v.customerId,
    productId: v.productId,
    startDate: v.startDate,
    endDate: v.endDate || null,
    frequency: v.frequency,
    weekdays: v.frequency === 'weekly' || v.frequency === 'twice_weekly' ? [...v.weekdays].sort() : [],
    monthDays: v.frequency === 'monthly' || v.frequency === 'twice_monthly' ? [...v.monthDays].sort((a, b) => a - b) : [],
    customDates: v.frequency === 'custom' ? [...v.customDates].sort() : [],
    quantity: v.quantity,
    notes: v.notes || undefined,
  }
}

export function SubscriptionDialog({ open, onOpenChange, customerId, subscription, mode, customerOptions }: { open: boolean; onOpenChange: (o: boolean) => void; customerId?: ID; subscription?: Subscription; mode: Mode; customerOptions?: { id: ID; name: string; code: string }[] }) {
  const db = useData()
  const { run, pending } = useRun()
  const [v, setV] = React.useState<Values>(() => toValues(subscription, customerId ?? '', mode))
  const [err, setErr] = React.useState('')
  const [customDate, setCustomDate] = React.useState('')
  React.useEffect(() => {
    if (open) {
      setV(toValues(subscription, customerId ?? '', mode))
      setErr('')
    }
  }, [open, subscription?.id, customerId, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((x) => ({ ...x, [k]: val }))
  const customer = db.customers.find((c) => c.id === v.customerId)
  const product = db.products.find((p) => p.id === v.productId)
  const price = product ? resolvePrice(db, product.id, v.startDate || todayISO(), customer?.agentId) : null
  const taken = new Set(db.subscriptions.filter((s) => s.customerId === v.customerId && !s.cancelledOn && deriveSubscriptionStatus(s) !== 'expired' && s.id !== subscription?.id).map((s) => s.productId))

  const preview = React.useMemo(() => {
    const draft = { ...asInput(v), id: 'preview', status: 'active', pauses: subscription?.pauses ?? [], createdOn: todayISO() } as Subscription
    if (!v.productId || !v.startDate) return { dates: [] as string[], monthly: 0 }
    const from = v.startDate > todayISO() ? v.startDate : todayISO()
    const dates = eachDay(from, addDaysISO(from, 120)).filter((d) => matchesFrequency(draft, d) && !isPausedOn(draft, d)).slice(0, 8)
    const monthly = price ? round2(billableDeliveries(draft, from, addDaysISO(from, 29)) * v.quantity * price.customerPrice) : 0
    return { dates, monthly }
  }, [v, price, subscription?.pauses])

  const toggleWeekday = (d: number) => {
    const max = v.frequency === 'weekly' ? 1 : 2
    const has = v.weekdays.includes(d)
    if (has) return set('weekdays', v.weekdays.filter((x) => x !== d))
    set('weekdays', max === 1 ? [d] : [...v.weekdays, d].slice(-max))
  }
  const toggleMonthDay = (d: number) => {
    const max = v.frequency === 'monthly' ? 1 : 2
    const has = v.monthDays.includes(d)
    if (has) return set('monthDays', v.monthDays.filter((x) => x !== d))
    set('monthDays', max === 1 ? [d] : [...v.monthDays, d].slice(-max))
  }

  const save = async () => {
    setErr('')
    if (!v.customerId) return setErr('Select the customer.')
    if (!v.productId) return setErr('Select a newspaper or magazine.')
    if (!v.startDate) return setErr('Choose a start date.')
    const input = asInput(v)
    const done = mode === 'new' ? await run(() => api.create(input), `${product?.name} subscribed`) : mode === 'edit' ? await run(() => api.update(subscription!.id, input), 'Subscription updated — calendar refreshed') : await run(() => api.change(subscription!.id, input), `Switched to ${product?.name}`)
    if (done) onOpenChange(false)
  }

  const productOptions = db.products
    .filter((p) => p.status === 'active' && (!taken.has(p.id) || p.id === subscription?.productId))
    .map((p) => {
      const pr = resolvePrice(db, p.id, todayISO(), customer?.agentId)
      return { value: p.id, label: p.name, hint: pr ? `${formatINR(pr.customerPrice)}/copy` : undefined, keywords: [p.category, p.language, p.publisher] }
    })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title={mode === 'new' ? 'New subscription' : mode === 'edit' ? 'Edit subscription' : 'Change subscription'} description={mode === 'change' ? 'The current subscription ends the day before the new one starts; both keep their history.' : customer ? `${customer.name} · ${customer.code}` : undefined}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-5">
            {!customerId && customerOptions && (
              <Field label="Customer" required>
                <Combobox value={v.customerId} onChange={(id) => set('customerId', id)} options={customerOptions.map((c) => ({ value: c.id, label: c.name, hint: c.code }))} placeholder="Search customer" />
              </Field>
            )}
            <Field label={mode === 'change' ? 'New product' : 'Newspaper / magazine'} required>
              <Combobox
                value={v.productId}
                disabled={mode === 'edit'}
                onChange={(id) => {
                  const p = db.products.find((x) => x.id === id)
                  setV((x) => ({ ...x, productId: id, frequency: mode === 'new' || mode === 'change' ? p?.defaultFrequency ?? x.frequency : x.frequency }))
                }}
                options={productOptions}
                placeholder="Search by name, language or category"
              />
            </Field>
            <Field label="Delivery frequency" required hint={FREQUENCY_META[v.frequency].hint}>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(FREQUENCY_META) as Frequency[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setV((x) => ({ ...x, frequency: f, weekdays: [], monthDays: [], customDates: f === 'custom' ? x.customDates : [] }))}
                    className={cn('rounded-lg border px-2 py-2 text-[13px] font-semibold transition', v.frequency === f ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/40')}
                  >
                    {FREQUENCY_META[f].label}
                  </button>
                ))}
              </div>
            </Field>
            {(v.frequency === 'weekly' || v.frequency === 'twice_weekly') && (
              <Field label={v.frequency === 'weekly' ? 'Delivery day (choose 1)' : 'Delivery days (choose 2)'} required>
                <Segmented multiple value={v.weekdays} onChange={toggleWeekday} options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))} />
              </Field>
            )}
            {(v.frequency === 'monthly' || v.frequency === 'twice_monthly') && (
              <Field label={v.frequency === 'monthly' ? 'Date of month (choose 1)' : 'Dates of month (choose 2)'} required hint="Dates after the 28th fall on the last day of shorter months.">
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <button key={d} type="button" onClick={() => toggleMonthDay(d)} className={cn('h-9 rounded-md text-[13px] font-semibold', v.monthDays.includes(d) ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-secondary')}>
                      {d}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {v.frequency === 'custom' && (
              <Field label="Delivery dates" required>
                <div className="flex gap-2">
                  <Input type="date" value={customDate} min={v.startDate} onChange={(e) => setCustomDate(e.target.value)} className="flex-1" />
                  <Button type="button" variant="outline" onClick={() => { if (customDate && !v.customDates.includes(customDate)) set('customDates', [...v.customDates, customDate].sort()); setCustomDate('') }}>
                    <CalendarPlus /> Add
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {v.customDates.map((d) => (
                    <button key={d} type="button" onClick={() => set('customDates', v.customDates.filter((x) => x !== d))} className="rounded-full bg-muted px-2.5 py-1 text-[12.5px] font-semibold hover:bg-destructive/10 hover:text-destructive">
                      {fmtShort(d)} ×
                    </button>
                  ))}
                  {!v.customDates.length && <span className="text-[12.5px] text-muted-foreground">No dates yet.</span>}
                </div>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Start date" required>
                <Input type="date" value={v.startDate} disabled={mode === 'edit' && subscription!.startDate <= todayISO()} min={mode === 'edit' ? undefined : todayISO()} onChange={(e) => set('startDate', e.target.value)} />
              </Field>
              <Field label="End date" hint="Leave blank for no end date.">
                <Input type="date" value={v.endDate} min={v.startDate} onChange={(e) => set('endDate', e.target.value)} />
              </Field>
              <Field label="Copies per delivery" required>
                <Input type="number" min={1} max={50} value={v.quantity} onChange={(e) => set('quantity', Math.max(1, Number(e.target.value) || 1))} />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Optional — special instructions" />
            </Field>
            {err && <p className="rounded-lg bg-destructive/8 px-3 py-2 text-[13.5px] font-medium text-destructive">{err}</p>}
          </div>
          <aside className="space-y-4 rounded-xl bg-muted/60 p-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Applicable price</div>
              <div className="font-display text-2xl font-semibold text-primary">{price ? `${formatINR(price.customerPrice)} / copy` : '—'}</div>
              {price?.source === 'agent' && <Badge tone="accent">Agent-specific rate</Badge>}
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Estimated 30-day bill</div>
              <div className="font-display text-xl font-semibold">{formatINR(preview.monthly)}</div>
              <div className="text-[12px] text-muted-foreground">Holidays don't reduce the bill.</div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Next deliveries</div>
              <ul className="space-y-1 text-[13px]">
                {preview.dates.map((d) => (
                  <li key={d} className="flex justify-between">
                    <span>{fmtDate(d)}</span>
                    <span className="text-muted-foreground">{WEEKDAYS[weekday(d)]}</span>
                  </li>
                ))}
                {!preview.dates.length && <li className="text-muted-foreground">Pick product & schedule</li>}
              </ul>
            </div>
            {customer && <div className="text-[12.5px] text-muted-foreground">Delivered by <b className="text-foreground">{executiveOf(db, customer)?.name ?? 'route not assigned'}</b></div>}
          </aside>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            {mode === 'new' ? 'Subscribe' : mode === 'edit' ? 'Save changes' : 'Switch product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function scheduleText(s: Subscription) {
  switch (s.frequency) {
    case 'weekly':
      return `Every ${WEEKDAYS_LONG[s.weekdays[0] ?? 0]}`
    case 'twice_weekly':
      return `Every ${s.weekdays.map((d) => WEEKDAYS[d]).join(' & ')}`
    case 'monthly':
      return `Monthly on the ${ordinal(s.monthDays[0] ?? 1)}`
    case 'twice_monthly':
      return `Monthly on the ${s.monthDays.map(ordinal).join(' & ')}`
    case 'fortnightly':
      return 'On the 1st & 16th'
    case 'every_14_days':
      return `Every 14 days from ${fmtShort(s.startDate)}`
    case 'custom':
      return `${s.customDates.length} chosen dates`
    default:
      return 'Every day'
  }
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`

function PauseDialog({ sub, open, onOpenChange }: { sub: Subscription; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending } = useRun()
  const [from, setFrom] = React.useState(addDaysISO(todayISO(), 1))
  const [to, setTo] = React.useState('')
  const [reason, setReason] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Pause deliveries" description="No deliveries and no charges for paused days.">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pause from" required>
              <Input type="date" value={from} min={todayISO()} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Resume on" hint="Blank = until resumed">
              <Input type="date" value={to ? addDaysISO(to, 1) : ''} min={addDaysISO(from, 1)} onChange={(e) => setTo(e.target.value ? addDaysISO(e.target.value, -1) : '')} />
            </Field>
          </div>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Travelling" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={pending} onClick={async () => (await run(() => api.pause(sub.id, from, to || null, reason || undefined), 'Deliveries paused')) && onOpenChange(false)}>
            Pause
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenewDialog({ sub, open, onOpenChange }: { sub: Subscription; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { run, pending } = useRun()
  const base = sub.endDate && sub.endDate > todayISO() ? sub.endDate : todayISO()
  const [end, setEnd] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Renew subscription" description={sub.endDate ? `Currently ends ${fmtDate(sub.endDate)}.` : 'No end date set.'}>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {[3, 6, 12].map((m) => {
              const d = addDaysISO(base, m * 30)
              return (
                <Button key={m} variant={end === d ? 'default' : 'outline'} size="sm" onClick={() => setEnd(d)}>
                  +{m} months
                </Button>
              )
            })}
            <Button variant={end === 'none' ? 'default' : 'outline'} size="sm" onClick={() => setEnd('none')}>
              No end date
            </Button>
          </div>
          <Field label="Or choose new end date">
            <Input type="date" value={end === 'none' ? '' : end} min={addDaysISO(todayISO(), 1)} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!end} loading={pending} onClick={async () => (await run(() => api.renew(sub.id, end === 'none' ? null : end), 'Subscription renewed')) && onOpenChange(false)}>
            Renew
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HistoryDialog({ sub, open, onOpenChange }: { sub: Subscription; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useData()
  const events = db.subscriptionEvents.filter((e) => e.subscriptionId === sub.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Subscription history" description={db.products.find((p) => p.id === sub.productId)?.name}>
        <ol className="relative space-y-4 border-l-2 border-border pl-5">
          {events.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-card bg-masthead" />
              <div className="text-[13.5px] font-semibold capitalize">{e.action}</div>
              <div className="text-[13px] text-muted-foreground">{e.detail}</div>
              <div className="text-[12px] text-muted-foreground">
                {fmtDateTime(e.at)} · {userName(db, e.by)}
              </div>
            </li>
          ))}
          {sub.pauses.map((p, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-card bg-warning" />
              <div className="text-[13.5px] font-semibold">Pause window</div>
              <div className="text-[13px] text-muted-foreground">
                {fmtDate(p.from)} → {p.to ? fmtDate(p.to) : 'until resumed'} {p.reason && `· ${p.reason}`}
              </div>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  )
}

/** Subscription cards with full lifecycle actions. */
export function SubscriptionCards({ subs, showCustomer }: { subs: Subscription[]; showCustomer?: boolean }) {
  const db = useData()
  const actor = useActor()
  const confirm = useConfirm()
  const { run } = useRun()
  const canWrite = can(db, actor, 'subscription.write')
  const [dialog, setDialog] = React.useState<{ kind: 'edit' | 'change' | 'pause' | 'renew' | 'history'; sub: Subscription } | null>(null)

  if (!subs.length) return <EmptyState icon={Repeat} title="No subscriptions" description="Add a newspaper or magazine to start deliveries." />

  const sorted = subs.slice().sort((a, b) => {
    const order = { active: 0, paused: 1, expired: 2, cancelled: 3 }
    return order[deriveSubscriptionStatus(a)] - order[deriveSubscriptionStatus(b)]
  })

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((s) => {
          const p = db.products.find((x) => x.id === s.productId)!
          const c = db.customers.find((x) => x.id === s.customerId)!
          const st = deriveSubscriptionStatus(s)
          const price = resolvePrice(db, s.productId, todayISO(), c.agentId)
          const pause = s.pauses.find((pp) => pp.to === null || pp.to >= todayISO())
          const closed = st === 'cancelled' || st === 'expired'
          return (
            <Card key={s.id} className={cn('relative overflow-hidden p-4', closed && 'opacity-70')}>
              <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: p.color }} />
              <div className="flex items-start justify-between gap-2 pl-2">
                <div className="min-w-0">
                  <div className="truncate font-display text-lg font-semibold text-primary">{p.name}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {p.category} · {p.language}
                  </div>
                  {showCustomer && <div className="mt-0.5 truncate text-[13px] font-semibold">{c.name}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge status={st} />
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Subscription actions">
                          <MoreVertical />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {!closed && (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', sub: s })}>
                            <Pencil /> Edit schedule
                          </DropdownMenuItem>
                        )}
                        {!closed && !pause && (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'pause', sub: s })}>
                            <Pause /> Pause
                          </DropdownMenuItem>
                        )}
                        {pause && (
                          <DropdownMenuItem
                            onSelect={async () => {
                              if (await confirm({ title: 'Resume deliveries?', description: `${p.name} will be delivered again from today.`, confirmLabel: 'Resume' })) await run(() => api.resume(s.id), 'Deliveries resumed')
                            }}
                          >
                            <Play /> Resume
                          </DropdownMenuItem>
                        )}
                        {!closed && (
                          <DropdownMenuItem onSelect={() => setDialog({ kind: 'change', sub: s })}>
                            <Shuffle /> Change product
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'renew', sub: s })}>
                          <RefreshCcw /> Renew
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'history', sub: s })}>
                          <History /> History
                        </DropdownMenuItem>
                        {!closed && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              destructive
                              onSelect={async () => {
                                if (await confirm({ title: `Cancel ${p.name}?`, description: 'Deliveries stop from tomorrow. Past deliveries and bills are kept. You can renew it later.', confirmLabel: 'Cancel subscription', tone: 'destructive' }))
                                  await run(() => api.cancel(s.id, addDaysISO(todayISO(), 1)), `${p.name} cancelled`)
                              }}
                            >
                              <XCircle /> Cancel
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 pl-2 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Schedule</dt>
                  <dd className="font-medium">{FREQUENCY_META[s.frequency].label}</dd>
                  <dd className="text-[12px] text-muted-foreground">{scheduleText(s)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Price</dt>
                  <dd className="font-medium">
                    {price ? formatINR(price.customerPrice) : '—'} × {s.quantity}
                  </dd>
                  <dd className="text-[12px] text-muted-foreground">per delivery</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Period</dt>
                  <dd className="text-[12.5px]">
                    {fmtShort(s.startDate)} → {s.cancelledOn ? `cancelled ${fmtShort(s.cancelledOn)}` : s.endDate ? fmtDate(s.endDate) : 'ongoing'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Executive</dt>
                  <dd className="truncate text-[12.5px]">{executiveOf(db, c)?.name ?? '—'}</dd>
                </div>
              </dl>
              {pause && (
                <div className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-warning">
                  Paused {fmtShort(pause.from)} → {pause.to ? fmtShort(pause.to) : 'until resumed'} {pause.reason && `· ${pause.reason}`}
                </div>
              )}
              {canWrite && !closed && !pause && actor.role === 'customer' && (
                <div className="mt-3 flex gap-2 pl-2">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'pause', sub: s })}>
                    <Pause /> Pause
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', sub: s })}>
                    <Pencil /> Edit
                  </Button>
                </div>
              )}
              {canWrite && pause && actor.role === 'customer' && (
                <Button size="sm" className="ml-2 mt-3" onClick={async () => void (await run(() => api.resume(s.id), 'Deliveries resumed'))}>
                  <Play /> Resume now
                </Button>
              )}
            </Card>
          )
        })}
      </div>
      {dialog?.kind === 'edit' && <SubscriptionDialog open onOpenChange={() => setDialog(null)} mode="edit" subscription={dialog.sub} customerId={dialog.sub.customerId} />}
      {dialog?.kind === 'change' && <SubscriptionDialog open onOpenChange={() => setDialog(null)} mode="change" subscription={dialog.sub} customerId={dialog.sub.customerId} />}
      {dialog?.kind === 'pause' && <PauseDialog open onOpenChange={() => setDialog(null)} sub={dialog.sub} />}
      {dialog?.kind === 'renew' && <RenewDialog open onOpenChange={() => setDialog(null)} sub={dialog.sub} />}
      {dialog?.kind === 'history' && <HistoryDialog open onOpenChange={() => setDialog(null)} sub={dialog.sub} />}
    </>
  )
}
