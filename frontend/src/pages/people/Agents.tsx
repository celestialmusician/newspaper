import { Landmark, Pencil, Plus } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AreaMultiSelect } from '@/components/AreaMultiSelect'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, Switch } from '@/components/ui/form'
import { Avatar, PageHeader, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { agentSettlement } from '@/domain/billing'
import type { Agent } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useData, useRun, useWarmup } from '@/hooks/app'
import { todayISO } from '@/lib/dates'
import { formatINR, formatMobile } from '@/lib/utils'
import { agents as api } from '@/services/api'

export default function Agents() {
  const db = useData()
  const ready = useWarmup()
  const navigate = useNavigate()
  const [dialog, setDialog] = React.useState<{ agent?: Agent } | null>(null)
  const rows = db.agents.map((a) => ({ a, s: agentSettlement(db, a.id), customers: db.customers.filter((c) => c.agentId === a.id).length, execs: db.executives.filter((e) => e.agentId === a.id).length }))
  type Row = (typeof rows)[number]
  const cols: Column<Row>[] = [
    {
      key: 'name',
      header: 'Agent',
      sort: (r) => r.a.name,
      csv: (r) => r.a.name,
      cell: ({ a }) => (
        <div className="flex items-center gap-3">
          <Avatar name={a.name} size={34} />
          <div>
            <div className="font-semibold">{a.name}</div>
            <div className="text-[12px] text-muted-foreground">
              {a.code} · {a.agencyName}
            </div>
          </div>
        </div>
      ),
    },
    { key: 'mobile', header: 'Mobile', sort: (r) => r.a.mobile, cell: ({ a }) => <span className="tabular">{formatMobile(a.mobile)}</span> },
    { key: 'areas', header: 'Areas', sort: (r) => r.a.areaIds.length, cell: ({ a }) => <span className="text-[13px]">{a.areaIds.map((id) => db.locations.find((l) => l.id === id)?.name).join(', ')}</span> },
    { key: 'customers', header: 'Customers', align: 'right', sort: (r) => r.customers, cell: (r) => r.customers },
    { key: 'execs', header: 'Executives', align: 'right', sort: (r) => r.execs, cell: (r) => r.execs, hideOnMobile: true },
    { key: 'due', header: 'Customer dues', align: 'right', sort: (r) => r.s.customerOutstanding, cell: (r) => <span className="tabular text-destructive">{formatINR(r.s.customerOutstanding, true)}</span> },
    { key: 'bal', header: 'Owes agency', align: 'right', sort: (r) => r.s.outstandingAgentBalance, cell: (r) => <span className="tabular font-semibold">{formatINR(r.s.outstandingAgentBalance, true)}</span> },
    { key: 'status', header: 'Status', sort: (r) => r.a.status, cell: ({ a }) => <StatusBadge status={a.status} /> },
    {
      key: 'edit',
      header: '',
      hideOnMobile: true,
      cell: ({ a }) => (
        <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={(e) => { e.stopPropagation(); setDialog({ agent: a }) }}>
          <Pencil />
        </Button>
      ),
    },
  ]
  return (
    <>
      <PageHeader
        kicker="People"
        title="Agency owners"
        description="Agencies that buy from the main agency and serve customers in their areas."
        actions={
          <Button onClick={() => setDialog({})}>
            <Plus /> Add agent
          </Button>
        }
      />
      <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.a.id} search={({ a }) => `${a.name} ${a.agencyName} ${a.mobile} ${a.code}`} onRowClick={({ a }) => navigate(`/agents/${a.id}`)} exportName="agents" empty={{ icon: Landmark, title: 'No agents' }} />
      {dialog && <AgentDialog agent={dialog.agent} onClose={() => setDialog(null)} />}
    </>
  )
}

export function AgentDialog({ agent, onClose }: { agent?: Agent; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const form = useForm(
    {
      name: agent?.name ?? '',
      mobile: agent?.mobile ?? '',
      email: agent?.email ?? '',
      agencyName: agent?.agencyName ?? '',
      areaIds: agent?.areaIds ?? ([] as string[]),
      maxDiscountPct: agent?.maxDiscountPct ?? db.settings.defaultAgentMaxDiscountPct,
      canManageRoutes: agent?.canManageRoutes ?? true,
      joiningDate: agent?.joiningDate ?? todayISO(),
      status: agent?.status ?? ('active' as Agent['status']),
    },
    (v) => ({
      name: rules.required(v.name, 'Name'),
      mobile: rules.mobile(v.mobile),
      email: rules.email(v.email),
      agencyName: rules.required(v.agencyName, 'Agency name'),
      areaIds: v.areaIds.length ? undefined : 'Assign at least one area.',
      maxDiscountPct: v.maxDiscountPct >= 0 && v.maxDiscountPct <= db.settings.adminMaxDiscountPct ? undefined : `Between 0 and ${db.settings.adminMaxDiscountPct}%.`,
    }),
  )
  const { values: v, set, errors } = form
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const ok = agent ? await run(() => api.update(agent.id, v), 'Agent updated') : await run(() => api.create(v), (a) => `${a.name} added as ${a.code}`)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={agent ? `Edit ${agent.name}` : 'Add agency owner'} description="Agents sign in with their mobile number and MPIN.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errors.name}>
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Agency name" required error={errors.agencyName}>
            <Input value={v.agencyName} onChange={(e) => set('agencyName', e.target.value)} aria-invalid={!!errors.agencyName} />
          </Field>
          <Field label="Mobile number" required error={errors.mobile}>
            <Input value={v.mobile} inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Service areas" required error={errors.areaIds} className="sm:col-span-2">
            <AreaMultiSelect value={v.areaIds} onChange={(x) => set('areaIds', x)} invalid={!!errors.areaIds} />
          </Field>
          <Field label="Max discount agent may give (%)" error={errors.maxDiscountPct} hint={`Platform ceiling: ${db.settings.adminMaxDiscountPct}%`}>
            <Input type="number" min={0} value={v.maxDiscountPct} onChange={(e) => set('maxDiscountPct', Number(e.target.value))} />
          </Field>
          <Field label="Joining date">
            <Input type="date" value={v.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Switch checked={v.canManageRoutes} onCheckedChange={(x) => set('canManageRoutes', x)} label="Can create routes & hand over to executives" />
            <Switch checked={v.status === 'active'} onCheckedChange={(x) => set('status', x ? 'active' : 'inactive')} label="Account active" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            {agent ? 'Save' : 'Add agent'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
