import { Database } from 'lucide-react'
import * as React from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { MASTER_META, type Master, type MasterKind } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { masters as api } from '@/services/api'
import { FormCard, FormTable, RowActions } from './shared'

/** The simple list masters of the Agent Console. Companies live inside Manage Products. */
export type SimpleMaster = Exclude<MasterKind, 'company'>

export const MASTER_SLUG: Record<SimpleMaster, string> = {
  subscription_type: 'subscription-types',
  area: 'areas',
  language: 'languages',
  product_type: 'product-types',
  payment_mode: 'payment-modes',
}
const KIND_OF = Object.fromEntries(Object.entries(MASTER_SLUG).map(([k, v]) => [v, k as SimpleMaster])) as Record<string, SimpleMaster>
const SUBSCRIPTION_PRESETS = ['Daily', 'Weekly', 'Fortnight', 'Fortnightly', 'Monthly', 'Yearly']

const FORM_TITLE: Record<SimpleMaster, string> = {
  subscription_type: 'Subscription Type Form',
  area: 'Area Master',
  language: 'Language Master',
  product_type: 'Product Type',
  payment_mode: 'Mode Of Pay',
}

export default function Masters() {
  const { kind: slug } = useParams()
  const actor = useActor()
  const kind = KIND_OF[slug ?? '']
  // An agency maintains only its own subscription types and payment modes; the rest belong to the main agency.
  if (!kind || (actor.role === 'agent' && kind !== 'subscription_type' && kind !== 'payment_mode')) return <Navigate to={`/masters/${MASTER_SLUG.subscription_type}`} replace />
  return <MasterManager key={kind} kind={kind} />
}

const blank = { name: '', code: '', description: '', active: true }

function MasterManager({ kind }: { kind: SimpleMaster }) {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const meta = MASTER_META[kind]
  const { run, pending } = useRun()
  const actor = useActor()
  const owner = actor.role === 'agent' ? actor.userId : undefined
  const [editing, setEditing] = React.useState<Master | null>(null)
  const rows = db.masters.filter((m) => m.kind === kind && m.ownerId === owner).map((m, i) => ({ m, n: i + 1, used: api.usage(m) }))
  type Row = (typeof rows)[number]
  const hasCode = kind === 'product_type' || kind === 'area'
  const hasDescription = kind !== 'language'

  const form = useForm(blank, (v) => ({ name: rules.required(v.name, meta.nameLabel) }))
  const { values: v, set, errors } = form

  const startEdit = (m: Master) => {
    setEditing(m)
    form.reset({ name: m.name, code: m.code ?? '', description: m.description ?? '', active: m.status === 'active' })
  }
  const clear = () => {
    setEditing(null)
    form.reset(blank)
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const base: Omit<Master, 'id'> = { kind, name: v.name.trim(), status: v.active ? 'active' : 'inactive' }
    if (hasCode) base.code = v.code.trim() || undefined
    if (hasDescription) base.description = v.description.trim() || undefined
    const ok = await run(() => api.save({ ...base, id: editing?.id }), editing ? `${meta.label} updated` : `${meta.label} saved`)
    if (ok) clear()
    return !!ok
  }
  const remove = async (m: Master) => {
    if (await confirm({ title: `Delete ${m.name}?`, description: 'It is not used anywhere and will be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(m.id), `${m.name} deleted`)
      if (editing?.id === m.id) clear()
    }
  }

  const presets = SUBSCRIPTION_PRESETS.filter((p) => !db.masters.some((m) => m.kind === 'subscription_type' && m.ownerId === owner && m.name.toLowerCase() === p.toLowerCase() && m.id !== editing?.id))

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-16' },
    { key: 'name', header: kind === 'subscription_type' ? 'Subscription Type' : kind === 'payment_mode' ? 'Name' : meta.nameLabel, sort: (r) => r.m.name, cell: (r) => <span className="font-semibold">{r.m.name}</span>, csv: (r) => r.m.name, hideOnMobile: true },
  ]
  if (kind === 'subscription_type') cols.push({ key: 'desc', header: 'Description', cell: (r) => <span className="text-[13px] text-muted-foreground">{r.m.description || '—'}</span>, csv: (r) => r.m.description ?? '' })
  if (hasCode) cols.push({ key: 'code', header: 'Code', sort: (r) => r.m.code ?? '', cell: (r) => r.m.code || '—' })
  cols.push(
    { key: 'status', header: 'Status', sort: (r) => r.m.status, cell: (r) => <StatusBadge status={r.m.status} />, csv: (r) => r.m.status },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => startEdit(r.m)} onDelete={() => void remove(r.m)} lockedReason={r.used ? `In use by ${r.used} record${r.used > 1 ? 's' : ''} — deactivate instead` : undefined} /> },
  )

  return (
    <>
      <PageHeader kicker={meta.kicker} title={meta.plural} description={meta.description} />
      <FormTable
        noun={meta.label.replace(/ Master$/, '').toLowerCase()}
        form={
          <FormCard title={FORM_TITLE[kind]} description={editing ? `Editing ${editing.name}` : undefined} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending}>
            {kind === 'subscription_type' ? (
              <Field label="Subscription" required error={errors.name}>
                <NativeSelect value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name}>
                  <option value="">Select Subscription Type</option>
                  {(editing && !presets.includes(editing.name) ? [editing.name, ...presets] : presets).map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <Field label={meta.nameLabel} required error={errors.name}>
                <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
              </Field>
            )}
            {hasCode && (
              <Field label="Code">
                <Input value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
              </Field>
            )}
            {hasDescription && (
              <Field label="Description">
                <Textarea rows={3} value={v.description} onChange={(e) => set('description', e.target.value)} />
              </Field>
            )}
            <Switch checked={v.active} onCheckedChange={(x) => set('active', x)} label={kind === 'subscription_type' ? 'Display status' : 'Active / Deactive'} />
          </FormCard>
        }
      >
        <DataTable cardAvatar={(r) => r.m.name} loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.m.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.m.name}</span>} search={(r) => `${r.m.name} ${r.m.code ?? ''} ${r.m.description ?? ''}`} exportName={MASTER_SLUG[kind]} empty={{ icon: Database, title: 'No entries yet', description: 'Use the form to add the first one.' }} />
      </FormTable>
    </>
  )
}
