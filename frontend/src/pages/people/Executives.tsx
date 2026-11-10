import { Pencil, Plus, Truck } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AreaMultiSelect } from '@/components/AreaMultiSelect'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch } from '@/components/ui/form'
import { Avatar, Badge, PageHeader, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { CONTACT_RELATIONS, type ContactRelation, type Executive } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useData, useRun, useScope, useWarmup } from '@/hooks/app'
import { addDaysISO, fmtDate, todayISO } from '@/lib/dates'
import { formatMobile } from '@/lib/utils'
import { executives as api } from '@/services/api'

export function executivePerformance(db: ReturnType<typeof useData>, executiveId: string, days = 30) {
  const from = addDaysISO(todayISO(), -days)
  const recs = Object.values(db.deliveries).filter((r) => r.executiveId === executiveId && r.date >= from)
  const delivered = recs.filter((r) => r.status === 'delivered').length
  return { total: recs.length, delivered, missed: recs.length - delivered, rate: recs.length ? (delivered / recs.length) * 100 : 0 }
}

export default function Executives() {
  const { db, executives, actor } = useScope()
  const ready = useWarmup()
  const navigate = useNavigate()
  const [dialog, setDialog] = React.useState<{ ex?: Executive } | null>(null)
  const rows = executives.map((e) => {
    const routes = db.routes.filter((r) => r.executiveId === e.id)
    return { e, routes, customers: routes.reduce((s, r) => s + r.stops.length, 0), perf: executivePerformance(db, e.id) }
  })
  type Row = (typeof rows)[number]
  const cols: Column<Row>[] = [
    {
      key: 'name',
      header: 'Executive',
      sort: (r) => r.e.name,
      csv: (r) => r.e.name,
      cell: ({ e }) => (
        <div className="flex items-center gap-3">
          <Avatar name={e.name} size={34} />
          <div>
            <div className="font-semibold">{e.name}</div>
            <div className="text-[12px] text-muted-foreground">{e.code}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'mobile',
      header: 'Mobile',
      sort: (r) => r.e.mobile,
      csv: (r) => r.e.mobile,
      cell: ({ e }) => (
        <div className="whitespace-nowrap">
          <div className="tabular">{formatMobile(e.mobile)}</div>
          {e.altMobile && (
            <div className="tabular text-[12px] text-muted-foreground" title="Alternate number">
              Alt {formatMobile(e.altMobile)} · {e.altMobileRelation}
            </div>
          )}
        </div>
      ),
    },
    ...(actor.role === 'admin' ? [{ key: 'agent', header: 'Agent', sort: (r: Row) => userName(db, r.e.agentId), cell: (r: Row) => userName(db, r.e.agentId) }] : []),
    { key: 'areas', header: 'Assigned areas', cell: ({ e }) => <span className="text-[13px]">{e.areaIds.map((id) => db.locations.find((l) => l.id === id)?.name).join(', ') || '—'}</span>, hideOnMobile: true },
    { key: 'routes', header: 'Routes', sort: (r) => r.routes.length, cell: ({ routes }) => (routes.length ? routes.map((r) => <Badge key={r.id} tone="navy" className="mr-1">{r.code}</Badge>) : <Badge tone="warning">None</Badge>) },
    { key: 'cust', header: 'Customers', align: 'right', sort: (r) => r.customers, cell: (r) => r.customers },
    { key: 'rate', header: '30-day delivery rate', align: 'right', sort: (r) => r.perf.rate, cell: (r) => (r.perf.total ? <span className="tabular font-semibold">{r.perf.rate.toFixed(1)}%</span> : '—') },
    { key: 'joined', header: 'Joined', sort: (r) => r.e.joiningDate, cell: ({ e }) => fmtDate(e.joiningDate), hideOnMobile: true },
    { key: 'status', header: 'Status', sort: (r) => r.e.status, cell: ({ e }) => <StatusBadge status={e.status} /> },
    {
      key: 'edit',
      header: '',
      hideOnMobile: true,
      cell: ({ e }) => (
        <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={(ev) => { ev.stopPropagation(); setDialog({ ex: e }) }}>
          <Pencil />
        </Button>
      ),
    },
  ]
  return (
    <>
      <PageHeader
        kicker="People"
        title="Delivery executives"
        description="Assign areas and routes. When someone leaves, hand over their route — every address, pin and instruction moves with it."
        actions={
          <Button onClick={() => setDialog({})}>
            <Plus /> Add executive
          </Button>
        }
      />
      <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.e.id} search={({ e }) => `${e.name} ${e.mobile} ${e.code}`} onRowClick={({ e }) => navigate(`/executives/${e.id}`)} exportName="executives" empty={{ icon: Truck, title: 'No delivery executives' }} />
      {dialog && <ExecutiveDialog ex={dialog.ex} onClose={() => setDialog(null)} />}
    </>
  )
}

export function ExecutiveDialog({ ex, onClose }: { ex?: Executive; onClose: () => void }) {
  const db = useData()
  const actor = useActor()
  const { run, pending } = useRun()
  const form = useForm(
    {
      name: ex?.name ?? '',
      mobile: ex?.mobile ?? '',
      altMobile: ex?.altMobile ?? '',
      altMobileRelation: ex?.altMobileRelation ?? ('' as ContactRelation | ''),
      agentId: ex?.agentId ?? (actor.role === 'agent' ? actor.userId : ''),
      areaIds: ex?.areaIds ?? ([] as string[]),
      joiningDate: ex?.joiningDate ?? todayISO(),
      status: ex?.status ?? ('active' as Executive['status']),
      canCollectCash: ex?.canCollectCash ?? true,
    },
    (v) => ({
      name: rules.required(v.name, 'Name'),
      mobile: rules.mobile(v.mobile),
      altMobile: rules.mobile(v.altMobile) ?? (v.altMobile === v.mobile ? "Must differ from the executive's own mobile." : undefined),
      altMobileRelation: v.altMobileRelation ? undefined : 'Select how this person is related.',
      agentId: v.agentId ? undefined : 'Select the agent.', areaIds: v.areaIds.length ? undefined : 'Assign at least one area.',
    }),
  )
  const { values: v, set, errors } = form
  const agentAreas = db.agents.find((a) => a.id === v.agentId)?.areaIds
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const input = { ...v, altMobileRelation: v.altMobileRelation as ContactRelation }
    const ok = ex ? await run(() => api.update(ex.id, input), 'Executive updated') : await run(() => api.create(input), (e) => `${e.name} added as ${e.code}`)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" title={ex ? `Edit ${ex.name}` : 'Add delivery executive'} description="They sign in with mobile + MPIN and see only their assigned routes.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errors.name}>
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Mobile number" required error={errors.mobile}>
            <Input value={v.mobile} inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
          </Field>
          <Field label="Alternate mobile" required error={errors.altMobile} hint="Family or emergency contact">
            <Input value={v.altMobile} inputMode="numeric" onChange={(e) => set('altMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.altMobile} />
          </Field>
          <Field label="Relation to executive" required error={errors.altMobileRelation}>
            <NativeSelect value={v.altMobileRelation} onChange={(e) => set('altMobileRelation', e.target.value as ContactRelation)} aria-invalid={!!errors.altMobileRelation}>
              <option value="">Select relation</option>
              {CONTACT_RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {actor.role === 'admin' && (
            <Field label="Agent" required error={errors.agentId}>
              <NativeSelect value={v.agentId} onChange={(e) => form.patch({ agentId: e.target.value, areaIds: [] })} aria-invalid={!!errors.agentId}>
                <option value="">Select agent</option>
                {db.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.agencyName}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Joining date">
            <Input type="date" value={v.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          </Field>
          <Field label="Assigned areas" required error={errors.areaIds} className="sm:col-span-2">
            <AreaMultiSelect value={v.areaIds} onChange={(x) => set('areaIds', x)} limitTo={agentAreas} invalid={!!errors.areaIds} />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Switch checked={v.canCollectCash} onCheckedChange={(x) => set('canCollectCash', x)} label="Authorised to collect cash" />
            <Switch checked={v.status === 'active'} onCheckedChange={(x) => set('status', x ? 'active' : 'inactive')} label="Account active" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            {ex ? 'Save' : 'Add executive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
