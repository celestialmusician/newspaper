import { MapPinned, Plus, Route as RouteIcon, Truck, Users } from 'lucide-react'
import * as React from 'react'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AreaMultiSelect } from '@/components/AreaMultiSelect'
import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, PageHeader, Progress, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { pathKm } from '@/domain/geo'
import type { Route } from '@/domain/types'
import { useActor, useCan, useData, useRun, useScope } from '@/hooks/app'
import { todayStats } from '@/pages/dashboard/shared'
import { routes as api } from '@/services/api'

export default function Routes() {
  const { db, actor, routes } = useScope()
  const canWrite = useCan('route.write')
  const [dialog, setDialog] = React.useState<{ r?: Route } | null>(null)
  if (actor.role === 'executive' && routes.length === 1) return <Navigate to={`/routes/${routes[0]!.id}`} replace />
  return (
    <>
      <PageHeader
        kicker="Distribution"
        title={actor.role === 'executive' ? 'My routes' : 'Delivery routes'}
        description="Each route holds its customers in delivery order with map pins and instructions — so anyone can take over a round on day one."
        actions={
          canWrite && (
            <Button onClick={() => setDialog({})}>
              <Plus /> New route
            </Button>
          )
        }
      />
      {!routes.length ? (
        <EmptyState icon={MapPinned} title="No routes" description={actor.role === 'executive' ? 'Your agent has not assigned a route yet.' : 'Create a route and add customers in delivery order.'} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {routes.map((r) => {
            const ids = new Set(r.stops.map((s) => s.customerId))
            const t = todayStats(db, db.subscriptions.filter((s) => ids.has(s.customerId)))
            const pts = r.stops.map((s) => db.customers.find((c) => c.id === s.customerId)!).filter(Boolean)
            return (
              <Link key={r.id} to={`/routes/${r.id}`}>
                <Card className="group h-full p-5 transition hover:-translate-y-0.5 hover:shadow-pop">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <Badge tone="navy">{r.code}</Badge>
                      <div className="mt-2 font-display text-xl font-semibold leading-tight text-primary">{r.name}</div>
                      <div className="text-[12.5px] text-muted-foreground">{r.areaIds.map((id) => db.locations.find((l) => l.id === id)?.name).join(' · ')}</div>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Mini icon={Users} v={r.stops.length} l="Stops" />
                    <Mini icon={RouteIcon} v={`${pathKm(pts).toFixed(1)} km`} l="Path" />
                    <Mini icon={Truck} v={t.copies} l="Copies today" />
                  </div>
                  <div className="mt-4 text-[13px]">
                    <div className="mb-1 flex justify-between">
                      <span className="font-semibold">{userName(db, r.executiveId)}</span>
                      <span className="tabular text-muted-foreground">
                        {t.delivered}/{t.total} delivered
                      </span>
                    </div>
                    <Progress value={t.total ? (t.delivered / t.total) * 100 : 0} tone="success" />
                  </div>
                  {actor.role === 'admin' && <div className="mt-3 text-[12px] text-muted-foreground">Agent: {userName(db, r.agentId)}</div>}
                </Card>
              </Link>
            )
          })}
        </div>
      )}
      {dialog && <RouteDialog r={dialog.r} onClose={() => setDialog(null)} />}
    </>
  )
}

function Mini({ icon: Icon, v, l }: { icon: React.ElementType; v: React.ReactNode; l: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2">
      <Icon className="mx-auto mb-0.5 size-4 text-masthead" />
      <div className="tabular text-[15px] font-bold">{v}</div>
      <div className="text-[11px] text-muted-foreground">{l}</div>
    </div>
  )
}

export function RouteDialog({ r, onClose }: { r?: Route; onClose: () => void }) {
  const db = useData()
  const actor = useActor()
  const { run, pending } = useRun()
  const [v, setV] = React.useState({
    name: r?.name ?? '',
    areaIds: r?.areaIds ?? ([] as string[]),
    agentId: r?.agentId ?? (actor.role === 'agent' ? actor.userId : ''),
    executiveId: r?.executiveId ?? null,
    instructions: r?.instructions ?? '',
    status: r?.status ?? ('active' as Route['status']),
  })
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const agentAreas = db.agents.find((a) => a.id === v.agentId)?.areaIds
  const save = async () => {
    if (!v.agentId) return toast.error('Select the agent.')
    if (await run(() => api.save({ ...v, id: r?.id }), r ? 'Route saved' : 'Route created')) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" title={r ? `Edit ${r.name}` : 'New delivery route'}>
        <div className="grid gap-4">
          <Field label="Route name" required>
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Ulloor – Akkulam loop" />
          </Field>
          {actor.role === 'admin' && (
            <Field label="Agent" required>
              <NativeSelect value={v.agentId} onChange={(e) => setV((s) => ({ ...s, agentId: e.target.value, areaIds: [], executiveId: null }))}>
                <option value="">Select agent</option>
                {db.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Areas covered" required>
            <AreaMultiSelect value={v.areaIds} onChange={(x) => set('areaIds', x)} limitTo={agentAreas} />
          </Field>
          <Field label="Delivery executive" hint={r ? 'Changing this records a handover.' : undefined}>
            <NativeSelect value={v.executiveId ?? ''} onChange={(e) => set('executiveId', e.target.value || null)}>
              <option value="">Not assigned</option>
              {db.executives.filter((e) => e.status === 'active' && e.agentId === v.agentId).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Route instructions">
            <Textarea rows={3} value={v.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="Bundle pickup point, timings, gate codes…" />
          </Field>
          <Switch checked={v.status === 'active'} onCheckedChange={(x) => set('status', x ? 'active' : 'inactive')} label="Route active" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            Save route
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
