import { Check, CheckCheck, ChevronDown, ClipboardCheck, CloudOff, Navigation, Phone, Undo2, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { NativeSelect, Segmented, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Progress } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, useConfirm } from '@/components/ui/overlay'
import { can } from '@/domain/access'
import { occurrences, type Occurrence } from '@/domain/schedule'
import { MISSED_REASONS, type ID } from '@/domain/types'
import { errorMessage, useScope } from '@/hooks/app'
import { addDaysISO, fmtDate, fmtTime, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { markDelivery, useNetwork } from '@/services/offline'

type Eff = 'delivered' | 'missed' | 'pending' | 'scheduled' | 'holiday' | 'paused'

export default function Checklist() {
  const { db, actor, routes } = useScope()
  const confirm = useConfirm()
  const queue = useNetwork((s) => s.queue)
  const [date, setDate] = React.useState(todayISO())
  const [routeId, setRouteId] = React.useState(routes[0]?.id ?? '')
  const [filter, setFilter] = React.useState<'all' | 'pending'>('all')
  const [missFor, setMissFor] = React.useState<Occurrence[] | null>(null)
  const [open, setOpen] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const canMark = can(db, actor, 'delivery.mark')

  const route = routes.find((r) => r.id === routeId)
  const occ = React.useMemo(() => {
    if (!route) return []
    const ids = new Set(route.stops.map((s) => s.customerId))
    return occurrences(db, db.subscriptions.filter((s) => ids.has(s.customerId)), date, date)
  }, [db, route, date])

  // Overlay offline-queued marks so the checklist reflects taps made without signal.
  const queued = new Map(queue.filter((q) => q.kind === 'delivery').map((q) => [`${q.payload.subscriptionId}|${(q.payload as { date: string }).date}`, q]))
  const eff = (o: Occurrence): Eff => {
    const q = queued.get(o.key)
    if (q && q.kind === 'delivery') return q.payload.status === 'clear' ? 'pending' : q.payload.status
    return o.status
  }

  const stops = (route?.stops ?? [])
    .map((s, i) => ({ seq: i + 1, s, c: db.customers.find((c) => c.id === s.customerId)!, items: occ.filter((o) => o.customerId === s.customerId) }))
    .filter((x) => x.c && x.items.length)
  const actionable = (o: Occurrence) => !['holiday', 'paused'].includes(eff(o))
  const counts = {
    total: occ.filter(actionable).length,
    done: occ.filter((o) => eff(o) === 'delivered').length,
    missed: occ.filter((o) => eff(o) === 'missed').length,
    queued: occ.filter((o) => queued.has(o.key)).length,
  }
  const pendingStops = stops.filter((x) => x.items.some((o) => actionable(o) && eff(o) !== 'delivered' && eff(o) !== 'missed'))
  const shown = filter === 'pending' ? pendingStops : stops

  const mark = async (items: Occurrence[], status: 'delivered' | 'missed' | 'clear', reason?: string, remarks?: string) => {
    const key = items[0]!.customerId
    setBusy(key)
    let queuedAny = false
    try {
      for (const o of items.filter(actionable)) {
        const r = await markDelivery({ subscriptionId: o.subscription.id, date, status, reason, remarks }, `${status === 'clear' ? 'Undo' : status === 'delivered' ? 'Delivered' : 'Missed'} · ${db.customers.find((c) => c.id === o.customerId)?.name} · ${db.products.find((p) => p.id === o.productId)?.name}`)
        if (r === 'queued') queuedAny = true
      }
      if (queuedAny) toast.info('Saved offline — will sync automatically.', { icon: <CloudOff className="size-4" /> })
      else if (status === 'delivered') toast.success('Marked delivered')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (!routes.length) return <EmptyState icon={ClipboardCheck} title="No route assigned" description="Once a route is assigned, your daily checklist appears here." />

  return (
    <>
      <PageHeader
        kicker="Daily delivery checklist"
        title={route?.name ?? 'Checklist'}
        description={`${fmtDate(date)} · ${route?.code ?? ''}${route?.instructions ? ` · ${route.instructions}` : ''}`}
        actions={
          <>
            {routes.length > 1 && (
              <NativeSelect value={routeId} onChange={(e) => setRouteId(e.target.value)} className="h-10 w-56" aria-label="Route">
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </NativeSelect>
            )}
            <Segmented
              value={date}
              onChange={setDate}
              options={[
                { value: addDaysISO(todayISO(), -1), label: 'Yesterday' },
                { value: todayISO(), label: 'Today' },
              ]}
            />
          </>
        }
      />

      <Card className="sticky top-[72px] z-10 mb-4 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex-1">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-display text-2xl font-semibold text-primary">
                {counts.done + counts.missed}/{counts.total} <span className="text-base font-normal text-muted-foreground">done</span>
              </span>
              <span className="text-[13px] text-muted-foreground">
                <b className="text-success">{counts.done}</b> delivered · <b className="text-destructive">{counts.missed}</b> missed {counts.queued > 0 && <>· <b className="text-info">{counts.queued}</b> offline</>}
              </span>
            </div>
            <Progress value={counts.total ? ((counts.done + counts.missed) / counts.total) * 100 : 0} tone="success" className="h-2.5" />
          </div>
          <div className="flex gap-2">
            <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: `All ${stops.length}` }, { value: 'pending', label: `Pending ${pendingStops.length}` }]} />
            {canMark && pendingStops.length > 0 && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (await confirm({ title: 'Mark all remaining as delivered?', description: `${pendingStops.length} stops will be marked delivered for ${fmtDate(date)}.`, confirmLabel: 'Mark delivered' }))
                    for (const x of pendingStops) await mark(x.items.filter((o) => eff(o) !== 'delivered' && eff(o) !== 'missed'), 'delivered')
                }}
              >
                <CheckCheck /> All delivered
              </Button>
            )}
          </div>
        </div>
      </Card>

      {!shown.length ? (
        <EmptyState icon={CheckCheck} title={filter === 'pending' ? 'All done for this round!' : 'No deliveries scheduled'} description={filter === 'pending' ? 'Every stop has been updated.' : 'Holidays or paused subscriptions may apply on this date.'} />
      ) : (
        <ol className="space-y-2.5">
            {shown.map(({ seq, s, c, items }) => {
              const states = items.map(eff)
              const allDone = states.every((x) => x === 'delivered' || x === 'holiday' || x === 'paused')
              const anyMissed = states.includes('missed')
              const inactive = states.every((x) => x === 'holiday' || x === 'paused')
              const isQueued = items.some((o) => queued.has(o.key))
              const expanded = open === c.id
              return (
                <li key={c.id} className="animate-card3d">
                  <Card className={cn('overflow-hidden transition', allDone && !inactive && 'border-success/40 bg-success/[0.03]', anyMissed && 'border-destructive/40 bg-destructive/[0.03]', inactive && 'opacity-60')}>
                    <div className="flex items-start gap-3 p-4">
                      <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-bold', allDone && !inactive ? 'bg-success text-primary-foreground' : anyMissed ? 'bg-destructive text-primary-foreground' : 'bg-primary text-primary-foreground')}>
                        {allDone && !inactive ? <Check className="size-5" /> : anyMissed ? <X className="size-5" /> : seq}
                      </span>
                      <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(expanded ? null : c.id)}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[16px] font-semibold">{c.name}</span>
                          {isQueued && (
                            <Badge tone="info">
                              <CloudOff className="size-3" /> offline
                            </Badge>
                          )}
                        </div>
                        <div className="text-[13px] text-muted-foreground">
                          {c.houseName}
                          {c.landmark && ` · ${c.landmark}`}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {items.map((o) => {
                            const p = db.products.find((x) => x.id === o.productId)!
                            const st = eff(o)
                            return (
                              <span key={o.key} className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[13px] font-semibold', st === 'delivered' ? 'border-success/30 bg-success/10 text-success' : st === 'missed' ? 'border-destructive/30 bg-destructive/10 text-destructive' : st === 'holiday' || st === 'paused' ? 'border-border bg-muted text-muted-foreground line-through' : 'border-border bg-card')}>
                                <span className="size-2 rounded-full" style={{ background: p.color }} />
                                {p.name}
                                {o.quantity > 1 && ` ×${o.quantity}`}
                              </span>
                            )
                          })}
                        </div>
                        {s.instructions && <div className="mt-2 rounded-md bg-warning/10 px-2 py-1 text-[13px] text-warning">📝 {s.instructions}</div>}
                      </button>
                      <ChevronDown className={cn('mt-2 size-4 shrink-0 text-muted-foreground transition', expanded && 'rotate-180')} />
                    </div>
                    {expanded && (
                      <div className="flex flex-wrap gap-2 border-t border-border/70 bg-muted/40 px-4 py-2.5 text-[13px]">
                        <Button variant="outline" size="sm" asChild>
                          <a href={`tel:${c.mobile}`}>
                            <Phone /> Call
                          </a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={`https://www.openstreetmap.org/directions?to=${c.lat}%2C${c.lng}`} target="_blank" rel="noreferrer">
                            <Navigation /> Directions
                          </a>
                        </Button>
                        {items.map((o) => o.record?.actualAt && <span key={o.key} className="self-center text-muted-foreground">{db.products.find((p) => p.id === o.productId)?.name} at {fmtTime(o.record.actualAt)}</span>)}
                        {items.map((o) => o.record?.reason && <span key={o.key + 'r'} className="self-center text-destructive">{o.record.reason}</span>)}
                        {items.some((o) => o.holiday) && <span className="self-center text-masthead">{items.find((o) => o.holiday)?.holiday?.name}</span>}
                      </div>
                    )}
                    {canMark && !inactive && (
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-border/70 p-3">
                        {allDone || anyMissed ? (
                          <Button variant="ghost" size="lg" onClick={() => void mark(items, 'clear')} loading={busy === c.id}>
                            <Undo2 /> Undo
                          </Button>
                        ) : (
                          <Button variant="success" size="xl" onClick={() => void mark(items.filter((o) => eff(o) !== 'delivered'), 'delivered')} loading={busy === c.id}>
                            <Check /> Delivered
                          </Button>
                        )}
                        {!allDone && !anyMissed && (
                          <Button variant="outline" size="xl" className="border-destructive/40 text-destructive hover:bg-destructive/5" onClick={() => setMissFor(items.filter(actionable))}>
                            <X /> Missed
                          </Button>
                        )}
                        {(allDone || anyMissed) && <span />}
                      </div>
                    )}
                  </Card>
                </li>
              )
            })}
        </ol>
      )}
      {missFor && <MissedDialog items={missFor} onClose={() => setMissFor(null)} onSubmit={async (reason, remarks) => { await mark(missFor, 'missed', reason, remarks); setMissFor(null) }} />}
    </>
  )
}

function MissedDialog({ items, onClose, onSubmit }: { items: Occurrence[]; onClose: () => void; onSubmit: (reason: string, remarks?: string) => Promise<void> }) {
  const [reason, setReason] = React.useState<string>('')
  const [remarks, setRemarks] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const ids: ID[] = items.map((o) => o.key)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Why was it missed?" description={`${ids.length} item(s) for this stop`}>
        <div className="grid grid-cols-2 gap-2">
          {MISSED_REASONS.map((r) => (
            <button key={r} onClick={() => setReason(r)} className={cn('min-h-12 rounded-xl border-2 px-3 py-2 text-left text-[14px] font-semibold', reason === r ? 'border-destructive bg-destructive/5 text-destructive' : 'border-border')}>
              {r}
            </button>
          ))}
        </div>
        <Textarea className="mt-3" rows={2} placeholder="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!reason} loading={busy} onClick={async () => { setBusy(true); await onSubmit(reason, remarks || undefined); setBusy(false) }}>
            Mark missed
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
