import { Handshake } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, Switch, Textarea } from '@/components/ui/form'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import type { Reseller } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useData, useRun, useWarmup } from '@/hooks/app'
import { formatMobile } from '@/lib/utils'
import { resellers as api } from '@/services/api'
import { FormCard, FormTable, RowActions } from './shared'

const blank = { name: '', mobile: '', email: '', address: '', active: true }

export default function Resellers() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [editing, setEditing] = React.useState<Reseller | null>(null)
  const form = useForm(blank, (v) => ({ name: rules.required(v.name, 'Name'), mobile: rules.mobile(v.mobile), email: rules.email(v.email) }))
  const { values: v, set, errors } = form
  const rows = db.resellers.map((r, i) => ({ r, n: i + 1 }))
  type Row = (typeof rows)[number]
  const nextNo = `RS-${String(db.counters.reseller! + 1).padStart(3, '0')}`

  const clear = () => {
    setEditing(null)
    form.reset(blank)
  }
  const startEdit = (r: Reseller) => {
    setEditing(r)
    form.reset({ name: r.name, mobile: r.mobile, email: r.email, address: r.address, active: r.status === 'active' })
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(() => api.save({ name: v.name, mobile: v.mobile, email: v.email.trim(), address: v.address.trim(), status: v.active ? 'active' : 'inactive', id: editing?.id }), editing ? 'Reseller updated' : 'Reseller added')
    if (ok) clear()
    return !!ok
  }
  const remove = async (r: Reseller) => {
    if (await confirm({ title: `Delete ${r.name}?`, description: 'The reseller record is removed. Agency accounts are not affected.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(r.id), 'Reseller deleted')
      if (editing?.id === r.id) clear()
    }
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (x) => x.n, cell: (x) => <span className="tabular text-muted-foreground">{x.n}</span>, className: 'w-16' },
    { key: 'name', header: 'Reseller name', sort: (x) => x.r.name, cell: (x) => <span className="font-semibold">{x.r.name}</span>, csv: (x) => x.r.name, hideOnMobile: true },
    { key: 'no', header: 'Account no', sort: (x) => x.r.accountNo, cell: (x) => <span className="font-mono text-[13px]">{x.r.accountNo}</span> },
    { key: 'mobile', header: 'Mobile no', sort: (x) => x.r.mobile, cell: (x) => <span className="tabular">{formatMobile(x.r.mobile)}</span>, csv: (x) => x.r.mobile },
    { key: 'email', header: 'E-mail', cell: (x) => <span className="text-[13px]">{x.r.email || '—'}</span>, hideOnMobile: true, csv: (x) => x.r.email },
    { key: 'status', header: 'Status', sort: (x) => x.r.status, cell: (x) => <StatusBadge status={x.r.status} />, csv: (x) => x.r.status },
    { key: 'act', header: '', cell: (x) => <RowActions onEdit={() => startEdit(x.r)} onDelete={() => void remove(x.r)} /> },
  ]

  return (
    <>
      <PageHeader kicker="Licence console" title="Resellers / Agents" description="Partners who sell NewsRound licences to new agencies." />
      <FormTable
        noun="reseller"
        form={
          <FormCard title="Resellers / Agents master" description={editing ? `Editing ${editing.name}` : 'Add a reseller'} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending}>
            <Field label="Account no">
              <Input value={editing?.accountNo ?? nextNo} readOnly disabled />
            </Field>
            <Field label="Name" required error={errors.name}>
              <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
            </Field>
            <Field label="Mobile no (username)" required error={errors.mobile}>
              <Input value={v.mobile} inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
            </Field>
            <Field label="Email id" error={errors.email}>
              <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
            </Field>
            <Field label="Address">
              <Textarea rows={2} value={v.address} onChange={(e) => set('address', e.target.value)} />
            </Field>
            <Switch checked={v.active} onCheckedChange={(x) => set('active', x)} label="Active / Deactive" />
          </FormCard>
        }
      >
        <DataTable cardAvatar={(x) => x.r.name} loading={!ready} rows={rows} columns={cols} rowKey={(x) => x.r.id} mobileTitle={(x) => <span className="font-semibold">{x.n}. {x.r.name}</span>} search={(x) => `${x.r.name} ${x.r.accountNo} ${x.r.mobile} ${x.r.email}`} exportName="resellers" empty={{ icon: Handshake, title: 'No resellers yet', description: 'Add the first reseller with the form.' }} />
      </FormTable>
    </>
  )
}
