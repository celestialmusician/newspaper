import { ArrowDown, ArrowLeft, ArrowRightLeft, ArrowUp, Navigation, Pencil, Phone, Plus, Sparkles, Trash2, UserMinus } from 'lucide-react'
import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { HandoverDialog } from '@/components/HandoverDialog'
import { RouteMap, type MapStop } from '@/components/Maps'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Input } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, EmptyState, Progress, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { can, routesFor, userName } from '@/domain/access'
import { customerOutstanding } from '@/domain/billing'
import { haversineKm, pathKm, suggestSequence } from '@/domain/geo'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import type { Route } from '@/domain/types'
import { useActor, useData, useRun } from '@/hooks/app'
import { addDaysISO, fmtDateTime, todayISO } from '@/lib/dates'
import { formatINR, formatMobile, groupBy } from '@/lib/utils'
import { todayStats } from '@/pages/dashboard/shared'
import { routes as api } from '@/services/api'
import { RouteDialog } from './Routes'

export default function RouteDetail() {
  const { id } = useParams()
  const db = useData()
  const actor = useActor()
  const confirm = useConfirm()
  const { run } = useRun()
  const [edit, setEdit] = React.useState(false)
  const [handover, setHandover] = React.useState(false)
  const [editingNote, setEditingNote] = React.useState<string | null>(null)
  const [noteText, setNoteText] = React.useState('')
  const r = db.routes.find((x) => x.id === id)
  if (!r || !routesFor(db, actor).some((x) => x.id === r.id)) return <EmptyState icon={Navigation} title="Route not found" action={<Button asChild><Link to="/routes">Back</Link></Button>} />

  const canWrite = can(db, actor, 'route.write')
  const canHand = can(db, actor, 'route.handover')
  const stops = r.stops.map((s, i) => ({ ...s, c: db.customers.find((c) => c.id === s.customerId)!, seq: i + 1 })).filter((s) => s.c)
  const ids = new Set(stops.map((s) => s.customerId))
  const today = todayStats(db, db.subscriptions.filter((s) => ids.has(s.customerId)))
  const km = pathKm(stops.map((s) => s.c))
  const suggestion = suggestSequence(stops.map((s) => ({ ...s, lat: s.c.lat, lng: s.c.lng })))
  const suggestedKm = pathKm(suggestion.map((s) => s.c))
  const saving = km - suggestedKm

  // Route-wise performance (30 days)
  const from = addDaysISO(todayISO(), -30)
  const recs = Object.values(db.deliveries).filter((d) => ids.has(d.customerId) && d.date >= from)
  const delivered = recs.filter((d) => d.status === 'delivered').length
  const reasons = Object.entries(groupBy(recs.filter((d) => d.status === 'missed'), (d) => d.reason ?? 'Other')).sort((a, b) => b[1].length - a[1].length)

  const setStops = (next: Route['stops'], msg: string) => run(() => api.setStops(r.id, next), msg)
  const move = (i: number, dir: -1 | 1) => {
    const next = r.stops.slice()
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    void setStops(next, 'Sequence updated')
  }
  const addable = db.customers.filter((c) => c.agentId === r.agentId && c.routeId !== r.id && c.status === 'active')

  const mapStops: MapStop[] = stops.map((s) => {
    const os = today.occ.filter((o) => o.customerId === s.customerId)
    const tone = !os.length ? 'navy' : os.every((o) => o.status === 'delivered') ? 'done' : os.some((o) => o.status === 'missed') ? 'missed' : 'pending'
    return { id: s.customerId, lat: s.c.lat, lng: s.c.lng, label: `${s.seq}. ${s.c.name}`, sub: `${s.c.houseName}${s.instructions ? ` — ${s.instructions}` : ''}`, seq: s.seq, tone }
  })

  return (
    <>
      <Link to="/routes" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Routes
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="navy">{r.code}</Badge>
            <StatusBadge status={r.status} />
          </div>
          <h1 className="mt-2 font-display text-[32px] font-semibold leading-tight text-primary">{r.name}</h1>
          <p className="text-[14px] text-muted-foreground">
            {userName(db, r.executiveId)} · {stops.length} stops · {km.toFixed(1)} km · Agent {userName(db, r.agentId)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canHand && (
            <Button variant="outline" onClick={() => setHandover(true)}>
              <ArrowRightLeft /> Hand over route
            </Button>
          )}
          {canWrite && (
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil /> Edit route
            </Button>
          )}
          {actor.role === 'executive' && (
            <Button asChild>
              <Link to="/deliveries/today">Open today's checklist</Link>
            </Button>
          )}
        </div>
      </div>

      {r.instructions && <Card className="mb-4 border-masthead/30 bg-masthead/[0.04] p-4 text-[14px]"><b className="text-masthead">Route instructions:</b> {r.instructions}</Card>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="space-y-4">
          <RouteMap stops={mapStops} height={460} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader title="Route performance" description="Last 30 days" />
              <CardBody className="space-y-3">
                <div className="flex items-end justify-between">
                  <span className="font-display text-4xl font-semibold text-primary">{recs.length ? ((delivered / recs.length) * 100).toFixed(1) : '—'}%</span>
                  <span className="text-right text-[13px] text-muted-foreground">
                    {delivered} delivered
                    <br />
                    {recs.length - delivered} missed
                  </span>
                </div>
                <Progress value={recs.length ? (delivered / recs.length) * 100 : 0} tone="success" />
                <ul className="space-y-1 pt-1 text-[13px]">
                  {reasons.map(([k, v]) => (
                    <li key={k} className="flex justify-between">
                      <span className="text-muted-foreground">{k}</span>
                      <b>{v.length}</b>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Sequence optimisation" icon={Sparkles} />
              <CardBody>
                {saving > 0.05 ? (
                  <>
                    <p className="text-[14px]">
                      A nearest-neighbour order shortens the round by <b className="text-success">{saving.toFixed(2)} km</b> ({km.toFixed(1)} → {suggestedKm.toFixed(1)} km).
                    </p>
                    <ol className="mt-2 max-h-28 list-decimal overflow-y-auto pl-5 text-[12.5px] text-muted-foreground">
                      {suggestion.map((s) => (
                        <li key={s.customerId}>{s.c.name}</li>
                      ))}
                    </ol>
                    {canWrite && (
                      <Button
                        className="mt-3"
                        size="sm"
                        onClick={async () => {
                          if (await confirm({ title: 'Apply suggested order?', description: 'The executive will be notified of the new sequence.', confirmLabel: 'Apply' })) void setStops(suggestion.map(({ customerId, instructions }) => ({ customerId, instructions })), 'Optimised sequence applied')
                        }}
                      >
                        Apply suggestion
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-[14px] text-muted-foreground">The current sequence is already efficient. 👍</p>
                )}
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader title="Handover history" />
            <ul className="divide-y divide-border/60 px-5 pb-3">
              {db.handovers.filter((h) => h.routeId === r.id).map((h) => (
                <li key={h.id} className="py-2.5 text-[13.5px]">
                  {userName(db, h.fromExecutiveId)} → <b>{userName(db, h.toExecutiveId)}</b>
                  <div className="text-[12.5px] text-muted-foreground">
                    {fmtDateTime(h.at)} · by {userName(db, h.by)} {h.note && `· ${h.note}`}
                  </div>
                </li>
              ))}
              {!db.handovers.some((h) => h.routeId === r.id) && <li className="py-6 text-center text-sm text-muted-foreground">No handovers yet.</li>}
            </ul>
          </Card>
        </div>

        <Card className="flex flex-col">
          <CardHeader title="Delivery sequence" description="Customers in the order they are visited" />
          {canWrite && (
            <div className="px-5 pt-3">
              <Combobox
                value=""
                onChange={(cid) => {
                  const nearest = stops.length ? stops.reduce((best, s) => (haversineKm(s.c, db.customers.find((c) => c.id === cid)!) < haversineKm(best.c, db.customers.find((c) => c.id === cid)!) ? s : best)) : null
                  const at = nearest ? r.stops.findIndex((s) => s.customerId === nearest.customerId) + 1 : r.stops.length
                  const next = r.stops.slice()
                  next.splice(at, 0, { customerId: cid })
                  void setStops(next, 'Customer added to route (placed next to the nearest stop)')
                }}
                options={addable.map((c) => ({ value: c.id, label: c.name, hint: c.routeId ? `on ${db.routes.find((x) => x.id === c.routeId)?.code}` : 'unassigned' }))}
                placeholder="+ Add customer to this route"
              />
            </div>
          )}
          <ol className="flex-1 divide-y divide-border/60 overflow-y-auto px-3 py-2">
            {stops.map((s, i) => {
              const subs = db.subscriptions.filter((x) => x.customerId === s.customerId && deriveSubscriptionStatus(x) === 'active')
              const due = customerOutstanding(db, s.customerId)
              return (
                <li key={s.customerId} className="py-3">
                  <div className="flex items-start gap-3 px-2">
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground">{s.seq}</span>
                    <div className="min-w-0 flex-1">
                      <Link to={`/customers/${s.customerId}`} className="block truncate font-semibold hover:text-primary">
                        {s.c.name}
                      </Link>
                      <div className="truncate text-[12.5px] text-muted-foreground">
                        {s.c.houseName} · {s.c.landmark}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {subs.map((x) => {
                          const p = db.products.find((pp) => pp.id === x.productId)!
                          return (
                            <span key={x.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11.5px] font-medium">
                              <span className="size-1.5 rounded-full" style={{ background: p.color }} /> {p.name}
                              {x.quantity > 1 && ` ×${x.quantity}`}
                            </span>
                          )
                        })}
                        {due > 0 && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11.5px] font-semibold text-destructive">Due {formatINR(due)}</span>}
                      </div>
                      {editingNote === s.customerId ? (
                        <div className="mt-2 flex gap-1.5">
                          <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} className="h-9 text-[13px]" autoFocus />
                          <Button
                            size="sm"
                            onClick={() => {
                              void setStops(r.stops.map((x) => (x.customerId === s.customerId ? { ...x, instructions: noteText || undefined } : x)), 'Instructions saved')
                              setEditingNote(null)
                            }}
                          >
                            Save
                          </Button>
                        </div>
                      ) : (
                        s.instructions && <div className="mt-1.5 rounded-md bg-warning/10 px-2 py-1 text-[12.5px] text-warning">📝 {s.instructions}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <Button variant="ghost" size="icon-sm" asChild aria-label="Call">
                        <a href={`tel:${s.c.mobile}`} title={formatMobile(s.c.mobile)}>
                          <Phone />
                        </a>
                      </Button>
                      <Button variant="ghost" size="icon-sm" asChild aria-label="Directions">
                        <a href={`https://www.openstreetmap.org/directions?to=${s.c.lat}%2C${s.c.lng}`} target="_blank" rel="noreferrer">
                          <Navigation />
                        </a>
                      </Button>
                    </div>
                  </div>
                  {canWrite && (
                    <div className="mt-1.5 flex gap-1 pl-12">
                      <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                        <ArrowUp />
                      </Button>
                      <Button variant="ghost" size="icon-sm" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                        <ArrowDown />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setEditingNote(s.customerId); setNoteText(s.instructions ?? '') }}>
                        <Plus /> Instruction
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={async () => {
                          if (await confirm({ title: `Remove ${s.c.name} from route?`, description: 'The customer becomes unassigned until added to another route. Deliveries will not appear on any checklist.', tone: 'destructive', confirmLabel: 'Remove' }))
                            void setStops(r.stops.filter((x) => x.customerId !== s.customerId), 'Removed from route')
                        }}
                      >
                        <UserMinus /> Remove
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
            {!stops.length && (
              <li className="py-10 text-center text-sm text-muted-foreground">
                No customers on this route yet.
                {canWrite && r.stops.length === 0 && (
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive"
                      onClick={async () => {
                        if (await confirm({ title: 'Delete empty route?', description: 'This route has no customers.', tone: 'destructive', confirmLabel: 'Delete' })) await run(() => api.remove(r.id), 'Route deleted')
                      }}
                    >
                      <Trash2 /> Delete route
                    </Button>
                  </div>
                )}
              </li>
            )}
          </ol>
        </Card>
      </div>

      {edit && <RouteDialog r={r} onClose={() => setEdit(false)} />}
      {handover && <HandoverDialog route={r} open onOpenChange={setHandover} />}
    </>
  )
}
