import { Route as RouteIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, Switch, Textarea } from '@/components/ui/form'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import type { Route } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { routes as api } from '@/services/api'
import { FormCard, FormTable, RowActions } from '../console/shared'

const blank = { name: '', code: '', description: '', active: true }

/** Manage Route: the simple route master of the legacy panel. Stops are filled by assigning customers to the route. */
export default function ManageRoute() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const actor = useActor()
  const { run, pending } = useRun()
  const me = db.agents.find((a) => a.id === actor.userId)!
  const [editing, setEditing] = React.useState<Route | null>(null)
  const rows = db.routes.filter((r) => r.agentId === actor.userId).map((r, i) => ({ r, n: i + 1 }))
  type Row = (typeof rows)[number]
  const form = useForm(blank, (v) => ({ name: rules.required(v.name, 'Route name') }))
  const { values: v, set, errors } = form

  const clear = () => {
    setEditing(null)
    form.reset(blank)
  }
  const startEdit = (r: Route) => {
    setEditing(r)
    form.reset({ name: r.name, code: r.code, description: r.instructions, active: r.status === 'active' })
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(
      () => api.save({ id: editing?.id, name: v.name.trim(), code: v.code, instructions: v.description.trim(), status: v.active ? 'active' : 'inactive', agentId: actor.userId, executiveId: editing?.executiveId ?? null, areaIds: editing?.areaIds ?? me.areaIds }),
      editing ? 'Route updated' : 'Route saved',
    )
    if (ok) clear()
    return !!ok
  }
  const remove = async (r: Route) => {
    if (await confirm({ title: `Delete ${r.name}?`, description: 'The route has no customers or delivery history, so it can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(r.id), 'Route deleted')
      if (editing?.id === r.id) clear()
    }
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (x) => x.n, cell: (x) => <span className="tabular text-muted-foreground">{x.n}</span>, className: 'w-14' },
    { key: 'name', header: 'Route Name', sort: (x) => x.r.name, cell: (x) => <span className="font-semibold">{x.r.name}</span>, csv: (x) => x.r.name, hideOnMobile: true },
    { key: 'code', header: 'Code', sort: (x) => x.r.code, cell: (x) => <span className="font-mono text-[13px]">{x.r.code}</span> },
    { key: 'status', header: 'Status', sort: (x) => x.r.status, cell: (x) => <StatusBadge status={x.r.status} />, csv: (x) => x.r.status },
    { key: 'act', header: '', cell: (x) => <RowActions onEdit={() => startEdit(x.r)} onDelete={() => void remove(x.r)} lockedReason={x.r.stops.length ? `${x.r.stops.length} customers on this route` : undefined} /> },
  ]

  return (
    <>
      <PageHeader kicker="Master" title="Manage Route" description="The delivery routes of your agency." />
      <FormTable
        noun="route"
        form={
          <FormCard title="Route Master" description={editing ? `Editing ${editing.name}` : undefined} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending}>
            <Field label="Route Name" required error={errors.name}>
              <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
            </Field>
            <Field label="Code" hint="Leave empty to number it automatically.">
              <Input value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Description">
              <Textarea rows={3} value={v.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <Switch checked={v.active} onCheckedChange={(x) => set('active', x)} label="Active / Deactive" />
          </FormCard>
        }
      >
        <DataTable cardAvatar={(x) => x.r.name} loading={!ready} rows={rows} columns={cols} rowKey={(x) => x.r.id} mobileTitle={(x) => <span className="font-semibold">{x.n}. {x.r.name}</span>} search={(x) => `${x.r.name} ${x.r.code}`} exportName="routes" empty={{ icon: RouteIcon, title: 'No routes yet', description: 'Add the first route with the form.' }} />
      </FormTable>
    </>
  )
}
