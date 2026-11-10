import { Megaphone } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, Segmented, Textarea } from '@/components/ui/form'
import { Badge, PageHeader } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import type { Broadcast } from '@/domain/types'
import { useForm } from '@/hooks/form'
import { useData, useRun, useWarmup } from '@/hooks/app'
import { addDaysISO, fmtDate, fmtDateTime, todayISO } from '@/lib/dates'
import { broadcasts as api } from '@/services/api'
import { AccountMultiSelect, FormCard, FormTable, RowActions } from './shared'

const blank = () => ({ accountIds: [] as string[], startDate: todayISO(), expiryDate: addDaysISO(todayISO(), 7), message: '', kind: 'notification' as Broadcast['kind'] })

export default function Broadcasts() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [editing, setEditing] = React.useState<Broadcast | null>(null)
  const form = useForm(blank(), (v) => ({
    accountIds: v.accountIds.length ? undefined : 'Select at least one account.',
    message: v.message.trim() ? undefined : 'Write the message to send.',
    expiryDate: v.expiryDate < v.startDate ? 'Must be on or after the start date.' : undefined,
  }))
  const { values: v, set, errors } = form
  const rows = db.broadcasts.map((b, i) => ({ b, n: i + 1, }))
  type Row = (typeof rows)[number]

  const clear = () => {
    setEditing(null)
    form.reset(blank())
  }
  const startEdit = (b: Broadcast) => {
    setEditing(b)
    form.reset({ accountIds: b.accountIds, startDate: b.startDate, expiryDate: b.expiryDate, message: b.message, kind: b.kind })
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(() => api.save({ ...v, id: editing?.id }), editing ? 'Notice updated' : `Sent to ${v.accountIds.length} account${v.accountIds.length > 1 ? 's' : ''}`)
    if (ok) clear()
    return !!ok
  }
  const remove = async (b: Broadcast) => {
    if (await confirm({ title: 'Delete this notice?', description: 'It is removed from the list. Notifications already delivered stay with the agencies.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(b.id), 'Notice deleted')
      if (editing?.id === b.id) clear()
    }
  }
  const names = (b: Broadcast) => (b.accountIds.length === db.agents.length ? 'All accounts' : b.accountIds.map((id) => db.agents.find((a) => a.id === id)?.agencyName ?? '—').join(', '))

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-16' },
    { key: 'to', header: 'Account list', sort: (r) => names(r.b), cell: (r) => <span className="text-[13px] font-semibold">{names(r.b)}</span>, csv: (r) => names(r.b), hideOnMobile: true },
    { key: 'msg', header: 'Description', cell: (r) => <span className="line-clamp-2 max-w-[22rem] text-[13px] text-muted-foreground">{r.b.message}</span>, csv: (r) => r.b.message },
    { key: 'at', header: 'Created Date', sort: (r) => r.b.createdAt, cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.b.createdAt)}</span>, hideOnMobile: true },
    { key: 'exp', header: 'Expiry Date', sort: (r) => r.b.expiryDate, cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDate(r.b.expiryDate)}</span> },
    {
      key: 'kind',
      header: 'Status',
      sort: (r) => r.b.kind,
      csv: (r) => r.b.kind,
      cell: (r) => (
        <Badge tone={r.b.kind === 'alert' ? 'danger' : 'info'} dot>
          {r.b.kind === 'alert' ? 'Alert' : 'Notification'}
        </Badge>
      ),
    },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => startEdit(r.b)} onDelete={() => void remove(r.b)} /> },
  ]

  return (
    <>
      <PageHeader kicker="Licence console" title="Send Information" description="Send a notice or an alert to one, several or all agency accounts." />
      <FormTable
        noun="notice"
        form={
          <FormCard title="Send information" description={editing ? 'Editing a sent notice' : 'Reaches each agency as a notification'} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending} submitLabel={editing ? 'Save changes' : 'Send'}>
            <Field label="Select account" required error={errors.accountIds}>
              <AccountMultiSelect value={v.accountIds} onChange={(x) => set('accountIds', x)} invalid={!!errors.accountIds} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
              </Field>
              <Field label="Expiring date" error={errors.expiryDate}>
                <Input type="date" min={v.startDate} value={v.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} aria-invalid={!!errors.expiryDate} />
              </Field>
            </div>
            <Field label="Description" required error={errors.message}>
              <Textarea rows={4} value={v.message} onChange={(e) => set('message', e.target.value)} aria-invalid={!!errors.message} />
            </Field>
            <Field label="Type">
              <Segmented
                value={v.kind}
                onChange={(x) => set('kind', x)}
                options={[
                  { value: 'notification', label: 'Notification' },
                  { value: 'alert', label: 'Alert' },
                ]}
              />
            </Field>
          </FormCard>
        }
      >
        <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.b.id} mobileTitle={(r) => <span className="text-[13.5px] font-semibold">{r.n}. {names(r.b)}</span>} search={(r) => `${names(r.b)} ${r.b.message}`} exportName="sent-information" empty={{ icon: Megaphone, title: 'Nothing sent yet', description: 'Notices you send appear here.' }} />
      </FormTable>
    </>
  )
}
