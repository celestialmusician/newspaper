import { ChevronRight, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { MapPicker } from '@/components/Maps'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Badge, Card, PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, useConfirm } from '@/components/ui/overlay'
import { children, locationChain } from '@/domain/locations'
import { LOCATION_LEVELS, type ID, type LocationLevel, type LocationNode } from '@/domain/types'
import { useActor, useData, useRun } from '@/hooks/app'
import { cn } from '@/lib/utils'
import { locations as api } from '@/services/api'

const LABEL: Record<LocationLevel, string> = { country: 'Countries', state: 'States', district: 'Districts', city: 'Cities / Towns', locality: 'Localities', area: 'Areas' }
const SINGLE: Record<LocationLevel, string> = { country: 'country', state: 'state', district: 'district', city: 'city / town', locality: 'locality', area: 'area' }

export default function Locations() {
  const db = useData()
  const actor = useActor()
  const confirm = useConfirm()
  const { run } = useRun()
  const [path, setPath] = React.useState<ID[]>(() => locationChain(db, 'a_kmp').map((l) => l.id))
  const [dialog, setDialog] = React.useState<{ level: LocationLevel; parentId: ID | null; node?: LocationNode } | null>(null)
  const canAdd = (level: LocationLevel) => actor.role === 'admin' || level === 'locality' || level === 'area'

  const usage = (id: ID) => {
    const ids = new Set([id, ...db.locations.filter((l) => locationChain(db, l.id).some((x) => x.id === id)).map((l) => l.id)])
    return db.customers.filter((c) => ids.has(c.areaId)).length
  }

  return (
    <>
      <PageHeader kicker="Catalogue" title="Location master" description="One central hierarchy used by every form. Country → State → District → City → Locality → Area (with pincode and map centre)." />
      <Card className="overflow-hidden">
        <div className="scrollbar-thin flex overflow-x-auto">
          {LOCATION_LEVELS.map((level, i) => {
            const parentId = i === 0 ? null : path[i - 1]
            if (i > 0 && !parentId) return null
            const items = children(db, parentId ?? null, level)
            return (
              <div key={level} className="flex w-64 shrink-0 flex-col border-r border-border last:border-r-0">
                <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-2.5">
                  <span className="text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">{LABEL[level]}</span>
                  {canAdd(level) && (
                    <Button variant="ghost" size="icon-sm" aria-label={`Add ${SINGLE[level]}`} onClick={() => setDialog({ level, parentId: parentId ?? null })}>
                      <Plus />
                    </Button>
                  )}
                </div>
                <ul className="max-h-[560px] flex-1 overflow-y-auto p-1.5">
                  {items.map((n) => {
                    const active = path[i] === n.id
                    const count = level === 'area' ? usage(n.id) : children(db, n.id).length
                    return (
                      <li key={n.id} className="group">
                        <button
                          onClick={() => setPath([...path.slice(0, i), n.id])}
                          className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px]', active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
                        >
                          {level === 'area' && <MapPin className={cn('size-3.5 shrink-0', active ? 'text-primary-foreground' : 'text-masthead')} />}
                          <span className="flex-1 truncate font-medium">{n.name}</span>
                          {n.pincode && <span className={cn('tabular text-[11.5px]', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{n.pincode}</span>}
                          <span className={cn('rounded-full px-1.5 text-[11px]', active ? 'bg-white/15' : 'bg-muted text-muted-foreground')}>{count}</span>
                          {level !== 'area' && <ChevronRight className="size-3.5 opacity-50" />}
                        </button>
                        {active && canAdd(level) && (
                          <div className="flex gap-1 px-1 pb-1 pt-1">
                            <Button variant="ghost" size="sm" onClick={() => setDialog({ level, parentId: n.parentId, node: n })}>
                              <Pencil /> Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={async () => {
                                const used = api.usage(n.id)
                                if (used) {
                                  await confirm({ title: 'Location in use', description: `${n.name} is used by ${used} customer(s)/route(s). Move them before deleting.`, confirmLabel: 'OK' })
                                  return
                                }
                                if (await confirm({ title: `Delete ${n.name}?`, description: 'Child locations under it are removed too.', tone: 'destructive', confirmLabel: 'Delete' })) {
                                  await run(() => api.remove(n.id), `${n.name} deleted`)
                                  setPath(path.slice(0, i))
                                }
                              }}
                            >
                              <Trash2 /> Delete
                            </Button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                  {!items.length && <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">None yet.</li>}
                </ul>
              </div>
            )
          })}
        </div>
      </Card>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
        Selected:
        {path.map((id) => (
          <Badge key={id} tone="navy">
            {db.locations.find((l) => l.id === id)?.name}
          </Badge>
        ))}
      </div>
      {dialog && <LocationDialog {...dialog} onClose={() => setDialog(null)} />}
    </>
  )
}

function LocationDialog({ level, parentId, node, onClose }: { level: LocationLevel; parentId: ID | null; node?: LocationNode; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const parent = db.locations.find((l) => l.id === parentId)
  const [name, setName] = React.useState(node?.name ?? '')
  const [pincode, setPincode] = React.useState(node?.pincode ?? '')
  const [ll, setLL] = React.useState<{ lat?: number; lng?: number }>({ lat: node?.lat, lng: node?.lng })
  const sibling = parent ? db.locations.find((l) => l.parentId === parent.parentId && l.level === 'area') : undefined
  const save = async () => {
    const ok = node ? await run(() => api.update(node.id, { name, pincode: pincode || undefined, ...ll }), 'Location updated') : await run(() => api.create({ level, name, parentId, pincode: pincode || undefined, ...ll }), `${name} added — now available in all forms`)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size={level === 'area' ? 'lg' : 'sm'} title={`${node ? 'Edit' : 'Add'} ${SINGLE[level]}`} description={parent ? `Under ${parent.name}` : undefined}>
        <div className="space-y-4">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          {level === 'area' && (
            <>
              <Field label="Pincode" required>
                <Input value={pincode} inputMode="numeric" onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <Field label="Area centre on map" hint="Used as the default pin when registering customers in this area.">
                <MapPicker lat={ll.lat} lng={ll.lng} onChange={(lat, lng) => setLL({ lat, lng })} height={240} fallback={sibling?.lat ? [sibling.lat, sibling.lng!] : undefined} />
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
