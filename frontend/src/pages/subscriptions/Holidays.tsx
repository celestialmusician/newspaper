import { CalendarOff, Pencil, Plus, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { DataTable } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { Badge, DemoNote, PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, useConfirm } from '@/components/ui/overlay'
import { locationChain } from '@/domain/locations'
import { blockingHoliday, holidayContext, occurrences } from '@/domain/schedule'
import type { Holiday, HolidayType, ID } from '@/domain/types'
import { useCan, useData, useRun, useWarmup } from '@/hooks/app'
import { fmtDate, fmtWeekday, todayISO } from '@/lib/dates'
import { holidays as api } from '@/services/api'

const TYPES: HolidayType[] = ['Public Holiday', 'Newspaper Holiday', 'Regional Holiday', 'Strike / Hartal', 'Special Holiday']
const TONE: Record<HolidayType, 'info' | 'accent' | 'warning' | 'danger' | 'navy'> = { 'Public Holiday': 'info', 'Newspaper Holiday': 'accent', 'Regional Holiday': 'warning', 'Strike / Hartal': 'danger', 'Special Holiday': 'navy' }

export function holidayImpact(db: ReturnType<typeof useData>, h: Pick<Holiday, 'date' | 'locationIds' | 'productIds' | 'deliveryApplicable'>) {
  if (h.deliveryApplicable) return 0
  const fake = { ...db, holidays: [{ ...h, id: 'x', name: '', type: 'Special Holiday' as HolidayType, description: '' }] }
  const ctx = holidayContext(fake)
  const occ = occurrences({ ...db, holidays: [] }, db.subscriptions, h.date, h.date)
  return occ.filter((o) => o.status !== 'paused' && blockingHoliday(db, ctx, db.customers.find((c) => c.id === o.customerId)!.areaId, o.productId, h.date)).length
}

export default function Holidays() {
  const db = useData()
  const ready = useWarmup()
  const canWrite = useCan('holiday.write')
  const confirm = useConfirm()
  const { run } = useRun()
  const [dialog, setDialog] = React.useState<{ h?: Holiday } | null>(null)
  const scope = (h: Holiday) => (h.locationIds.length ? h.locationIds.map((id) => db.locations.find((l) => l.id === id)?.name).join(', ') : 'All locations')

  return (
    <>
      <PageHeader
        kicker="Distribution rules"
        title="Holidays & strikes"
        description="Holidays and hartals automatically suspend deliveries in the affected areas. Subscription bills are NOT reduced — any concession is an approved manual adjustment."
        actions={
          canWrite && (
            <Button onClick={() => setDialog({})}>
              <Plus /> Add holiday / strike
            </Button>
          )
        }
      />
      <DataTable
        loading={!ready}
        rows={db.holidays}
        rowKey={(h) => h.id}
        initialSort={{ key: 'date', dir: 'desc' }}
        search={(h) => `${h.name} ${h.type} ${scope(h)}`}
        exportName="holidays"
        empty={{ icon: CalendarOff, title: 'No holidays configured' }}
        columns={[
          { key: 'date', header: 'Date', sort: (h) => h.date, cell: (h) => <div><div className="font-semibold">{fmtDate(h.date)}</div><div className="text-[12px] text-muted-foreground">{fmtWeekday(h.date)}{h.date >= todayISO() ? ' · upcoming' : ''}</div></div> },
          { key: 'name', header: 'Holiday', sort: (h) => h.name, cell: (h) => <div><div className="font-semibold">{h.name}</div><div className="max-w-xs truncate text-[12px] text-muted-foreground">{h.description}</div></div> },
          { key: 'type', header: 'Type', sort: (h) => h.type, cell: (h) => <Badge tone={TONE[h.type]}>{h.type}</Badge> },
          { key: 'scope', header: 'Applies to', cell: (h) => <span className="text-[13px]">{scope(h)}{h.productIds.length ? ` · ${h.productIds.map((p) => db.products.find((x) => x.id === p)?.name).join(', ')}` : ''}</span>, csv: (h) => scope(h) },
          { key: 'delivery', header: 'Delivery', sort: (h) => (h.deliveryApplicable ? 1 : 0), cell: (h) => (h.deliveryApplicable ? <Badge tone="success">Continues</Badge> : <Badge tone="danger">Suspended</Badge>) },
          { key: 'impact', header: 'Deliveries affected', align: 'right', cell: (h) => <span className="tabular">{holidayImpact(db, h)}</span> },
          ...(canWrite
            ? [
                {
                  key: 'act',
                  header: '',
                  cell: (h: Holiday) => (
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setDialog({ h })}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete"
                        onClick={async () => {
                          if (await confirm({ title: `Delete ${h.name}?`, description: 'The calendar will show deliveries on this date again.', tone: 'destructive', confirmLabel: 'Delete' })) await run(() => api.remove(h.id), 'Holiday removed')
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
      />
      {dialog && <HolidayDialog h={dialog.h} onClose={() => setDialog(null)} />}
    </>
  )
}

function HolidayDialog({ h, onClose }: { h?: Holiday; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const [v, setV] = React.useState<Omit<Holiday, 'id'>>({
    name: h?.name ?? '',
    date: h?.date ?? todayISO(),
    type: h?.type ?? 'Newspaper Holiday',
    locationIds: h?.locationIds ?? [],
    productIds: h?.productIds ?? [],
    deliveryApplicable: h?.deliveryApplicable ?? false,
    description: h?.description ?? '',
  })
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const impact = holidayImpact(db, v)
  const locOptions = db.locations.filter((l) => l.level !== 'country' && !v.locationIds.includes(l.id)).map((l) => ({ value: l.id, label: l.name, hint: `${l.level} · ${locationChain(db, l.id).slice(1, -1).map((x) => x.name).join(' › ')}` }))
  const save = async () => {
    if (!v.name.trim()) return toast.error('Enter a name.')
    if ((await run(() => api.save({ ...v, id: h?.id }), h ? 'Holiday updated — calendar refreshed' : 'Holiday added — calendar refreshed'))) onClose()
  }
  const remove = (k: 'locationIds' | 'productIds', id: ID) => set(k, v[k].filter((x) => x !== id))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={h ? 'Edit holiday' : 'Add holiday / strike'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Holiday name" required className="sm:col-span-2">
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Statewide Hartal" />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={v.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Type" required>
            <NativeSelect value={v.type} onChange={(e) => set('type', e.target.value as HolidayType)}>
              {TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Applicable district / city / areas" hint="Leave empty for everywhere. A district covers all its cities and areas." className="sm:col-span-2">
            <Combobox value="" onChange={(id) => set('locationIds', [...v.locationIds, id])} options={locOptions} placeholder="Add location…" />
            <div className="flex flex-wrap gap-1.5">
              {v.locationIds.map((id) => (
                <Badge key={id} tone="navy">
                  {db.locations.find((l) => l.id === id)?.name}
                  <button onClick={() => remove('locationIds', id)} aria-label="Remove">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </Field>
          <Field label="Only for specific products" hint="Leave empty for all products." className="sm:col-span-2">
            <Combobox value="" onChange={(id) => set('productIds', [...v.productIds, id])} options={db.products.filter((p) => !v.productIds.includes(p.id)).map((p) => ({ value: p.id, label: p.name }))} placeholder="Add product…" />
            <div className="flex flex-wrap gap-1.5">
              {v.productIds.map((id) => (
                <Badge key={id}>
                  {db.products.find((p) => p.id === id)?.name}
                  <button onClick={() => remove('productIds', id)} aria-label="Remove">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={v.deliveryApplicable} onCheckedChange={(x) => set('deliveryApplicable', x)} label="Delivery continues on this day (informational holiday only)" />
          </div>
          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={2} value={v.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <DemoNote className="sm:col-span-2">
            {v.deliveryApplicable ? 'No deliveries are suspended.' : `${impact} scheduled deliveries will be marked Holiday.`} Bills remain at the fixed subscription rate.
          </DemoNote>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
