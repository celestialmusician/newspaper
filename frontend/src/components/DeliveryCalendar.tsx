import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight, CircleSlash, PauseCircle } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/form'
import { Badge, Card, StatusBadge } from '@/components/ui/misc'
import { occurrences, type Occurrence } from '@/domain/schedule'
import type { DeliveryStatus, Subscription } from '@/domain/types'
import { useData } from '@/hooks/app'
import { eachDay, fmtWeekday, fromISO, toISO, todayISO, WEEKDAYS } from '@/lib/dates'
import { cn, groupBy } from '@/lib/utils'

type View = 'month' | 'week' | 'day'

const STATUS_DOT: Record<DeliveryStatus, string> = {
  delivered: 'bg-success',
  scheduled: 'bg-info',
  pending: 'bg-warning',
  missed: 'bg-destructive',
  holiday: 'bg-[var(--chart-4)]',
  paused: 'bg-[var(--chart-neutral)]',
}

export const STATUS_LEGEND: { s: DeliveryStatus; label: string }[] = [
  { s: 'scheduled', label: 'Scheduled' },
  { s: 'delivered', label: 'Delivered' },
  { s: 'pending', label: 'Pending' },
  { s: 'missed', label: 'Missed' },
  { s: 'holiday', label: 'Holiday' },
  { s: 'paused', label: 'Paused' },
]

/**
 * Dynamic delivery calendar. Derived live from subscriptions + holidays + delivery records,
 * so any change (new subscription, pause, frequency edit, holiday) shows instantly — and
 * an entry can never be duplicated because each is keyed by subscription + date.
 */
export function DeliveryCalendar({ subscriptions, showCustomer = true, defaultView = 'month', compact }: { subscriptions: Subscription[]; showCustomer?: boolean; defaultView?: View; compact?: boolean }) {
  const db = useData()
  const [view, setView] = React.useState<View>(defaultView)
  const [cursor, setCursor] = React.useState(todayISO())
  const [selected, setSelected] = React.useState(todayISO())

  const range = React.useMemo(() => {
    const d = fromISO(cursor)
    if (view === 'month') return { from: toISO(startOfWeek(startOfMonth(d))), to: toISO(endOfWeek(endOfMonth(d))) }
    if (view === 'week') return { from: toISO(startOfWeek(d)), to: toISO(endOfWeek(d)) }
    return { from: cursor, to: cursor }
  }, [cursor, view])

  const occ = React.useMemo(() => occurrences(db, subscriptions, range.from, range.to), [db, subscriptions, range])
  const byDate = React.useMemo(() => groupBy(occ, (o) => o.date), [occ])
  const days = eachDay(range.from, range.to)

  const step = (dir: 1 | -1) => {
    const d = fromISO(cursor)
    const next = view === 'month' ? addMonths(d, dir) : addDays(d, dir * (view === 'week' ? 7 : 1))
    setCursor(toISO(next))
    if (view === 'day') setSelected(toISO(next))
  }

  const title = view === 'month' ? format(fromISO(cursor), 'MMMM yyyy') : view === 'week' ? `${format(fromISO(range.from), 'dd MMM')} – ${format(fromISO(range.to), 'dd MMM yyyy')}` : format(fromISO(cursor), 'EEEE, dd MMMM yyyy')
  const dayList = byDate[view === 'day' ? cursor : selected] ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => step(-1)} aria-label="Previous">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" onClick={() => step(1)} aria-label="Next">
            <ChevronRight />
          </Button>
          <h3 className="ml-1 font-display text-[22px] font-semibold text-primary">{title}</h3>
          <Button variant="ghost" size="sm" onClick={() => { setCursor(todayISO()); setSelected(todayISO()) }}>
            Today
          </Button>
        </div>
        <Segmented value={view} onChange={(v) => setView(v)} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
        {STATUS_LEGEND.map((l) => (
          <span key={l.s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-full', STATUS_DOT[l.s])} /> {l.label}
          </span>
        ))}
      </div>

      {view !== 'day' && (
        <div className={cn('grid grid-cols-1 gap-4', !compact && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
          <Card className="overflow-hidden">
            <div className="grid grid-cols-7 border-b border-border bg-muted/50">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-2 text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const list = byDate[d] ?? []
                const inMonth = view === 'week' || d.slice(0, 7) === cursor.slice(0, 7)
                const holiday = list.find((o) => o.holiday)?.holiday ?? db.holidays.find((h) => h.date === d && !h.deliveryApplicable && h.locationIds.length === 0)
                const byProduct = groupBy(list, (o) => o.productId)
                return (
                  <button
                    key={d}
                    onClick={() => setSelected(d)}
                    className={cn(
                      'relative flex flex-col gap-1 border-b border-r border-border/60 p-1.5 text-left transition-colors hover:bg-accent/60 sm:p-2',
                      view === 'week' ? 'min-h-40' : 'min-h-[74px] sm:min-h-24',
                      !inMonth && 'bg-muted/30 text-muted-foreground/60',
                      selected === d && 'bg-masthead/[0.06] ring-2 ring-inset ring-masthead/50',
                    )}
                  >
                    <span className={cn('grid size-6 place-items-center rounded-full text-[12.5px] font-semibold', d === todayISO() && 'bg-primary text-primary-foreground')}>{Number(d.slice(8))}</span>
                    {holiday && <span className="hidden truncate rounded bg-masthead/10 px-1 text-[10.5px] font-semibold text-masthead sm:block">{holiday.name}</span>}
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(byProduct)
                        .slice(0, view === 'week' ? 12 : 4)
                        .map(([pid, os]) => {
                          const p = db.products.find((x) => x.id === pid)
                          const worst = pickStatus(os)
                          return view === 'week' ? (
                            <span key={pid} className="flex w-full items-center gap-1 truncate rounded bg-card px-1 py-0.5 text-[11px] ring-1 ring-border">
                              <span className={cn('size-1.5 shrink-0 rounded-full', STATUS_DOT[worst])} />
                              <span className="truncate">{p?.name}</span>
                              {os.length > 1 && <span className="ml-auto font-semibold">×{os.reduce((s, o) => s + o.quantity, 0)}</span>}
                            </span>
                          ) : (
                            <span key={pid} title={`${p?.name} · ${worst}`} className={cn('size-2 rounded-full sm:size-2.5', STATUS_DOT[worst])} />
                          )
                        })}
                      {view === 'month' && Object.keys(byProduct).length > 4 && <span className="text-[10px] font-semibold">+{Object.keys(byProduct).length - 4}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>
          <DayPanel date={selected} list={byDate[selected] ?? []} showCustomer={showCustomer} />
        </div>
      )}
      {view === 'day' && <DayPanel date={cursor} list={dayList} showCustomer={showCustomer} wide />}
    </div>
  )
}

function pickStatus(os: Occurrence[]): DeliveryStatus {
  const order: DeliveryStatus[] = ['missed', 'pending', 'holiday', 'paused', 'scheduled', 'delivered']
  for (const s of order) if (os.some((o) => o.status === s)) return s
  return 'scheduled'
}

function DayPanel({ date, list, showCustomer, wide }: { date: string; list: Occurrence[]; showCustomer: boolean; wide?: boolean }) {
  const db = useData()
  const holidays = db.holidays.filter((h) => h.date === date)
  const counts = groupBy(list, (o) => o.status)
  return (
    <Card className={cn('flex flex-col', wide ? '' : 'lg:max-h-[640px]')}>
      <div className="border-b border-border px-4 py-3">
        <div className="kicker text-muted-foreground">{fmtWeekday(date)}</div>
        <div className="font-display text-xl font-semibold text-primary">{format(fromISO(date), 'dd MMMM yyyy')}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone="navy">{list.reduce((s, o) => s + o.quantity, 0)} copies</Badge>
          {Object.entries(counts).map(([s, os]) => (
            <StatusBadge key={s} status={s} label={`${os.length} ${s}`} />
          ))}
        </div>
        {holidays.map((h) => (
          <div key={h.id} className={cn('mt-2 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[12.5px]', h.deliveryApplicable ? 'bg-info/8 text-info' : 'bg-masthead/8 text-masthead')}>
            <CircleSlash className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <b>{h.name}</b> · {h.type}. {h.deliveryApplicable ? 'Delivery continues.' : 'No delivery in affected areas — bill unchanged.'}
            </span>
          </div>
        ))}
      </div>
      <ul className="flex-1 divide-y divide-border/60 overflow-y-auto">
        {list.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">No deliveries scheduled.</li>}
        {list
          .slice()
          .sort((a, b) => a.customerId.localeCompare(b.customerId))
          .map((o) => {
            const p = db.products.find((x) => x.id === o.productId)
            const c = db.customers.find((x) => x.id === o.customerId)
            return (
              <li key={o.key} className="flex items-center gap-3 px-4 py-2.5">
                <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: p?.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">
                    {p?.name}
                    {o.quantity > 1 && <span className="text-muted-foreground"> ×{o.quantity}</span>}
                  </div>
                  {showCustomer && c && (
                    <Link to={`/customers/${c.id}`} className="block truncate text-[12.5px] text-muted-foreground hover:text-primary">
                      {c.name} · {c.houseName}
                    </Link>
                  )}
                  {o.status === 'paused' && (
                    <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
                      <PauseCircle className="size-3" /> {o.subscription.pauses.find((pp) => date >= pp.from && (!pp.to || date <= pp.to))?.reason ?? 'Paused'}
                    </div>
                  )}
                  {o.record?.reason && <div className="text-[12px] text-destructive">{o.record.reason}</div>}
                </div>
                <StatusBadge status={o.status} />
              </li>
            )
          })}
      </ul>
    </Card>
  )
}
