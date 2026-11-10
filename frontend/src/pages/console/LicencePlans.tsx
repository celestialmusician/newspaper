import { BadgeIndianRupee, ImagePlus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, Switch } from '@/components/ui/form'
import { Badge, PageHeader } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import type { LicencePlan } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useData, useRun, useWarmup } from '@/hooks/app'
import { formatINR, round2 } from '@/lib/utils'
import { licencePlans as api } from '@/services/api'
import { FormCard, FormTable, RowActions } from './shared'

const blank = { name: '', rate: 0, gstPct: 18, renewalAmount: 0, logo: '', primary: false }

/** Logo for invoices: scaled down to at most 1024 px wide so the device cache stays small. */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const scale = Math.min(1, 1024 / img.width)
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * scale)
  c.height = Math.round(img.height * scale)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(url)
  return c.toDataURL('image/png')
}

export default function LicencePlans() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [editing, setEditing] = React.useState<LicencePlan | null>(null)
  const form = useForm(blank, (v) => ({
    name: rules.required(v.name, 'Version type'),
    rate: rules.positive(v.rate, 'Rate'),
    gstPct: v.gstPct >= 0 && v.gstPct <= 100 ? undefined : 'GST must be between 0 and 100%.',
    renewalAmount: rules.nonNegative(v.renewalAmount, 'Renewal amount'),
  }))
  const { values: v, set, errors } = form
  const withGst = (x: number) => round2(x * (1 + (v.gstPct || 0) / 100))
  const rows = db.licencePlans.map((p, i) => ({ p, n: i + 1, used: api.usage(p.id) }))
  type Row = (typeof rows)[number]

  const clear = () => {
    setEditing(null)
    form.reset(blank)
  }
  const startEdit = (p: LicencePlan) => {
    setEditing(p)
    form.reset({ name: p.name, rate: p.rate, gstPct: p.gstPct, renewalAmount: p.renewalAmount, logo: p.logo ?? '', primary: p.primary })
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(() => api.save({ ...v, logo: v.logo || undefined, id: editing?.id }), editing ? 'Plan updated' : 'Plan added')
    if (ok) clear()
    return !!ok
  }
  const remove = async (p: LicencePlan) => {
    if (await confirm({ title: `Delete ${p.name}?`, description: 'No agency uses this plan, so it can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(p.id), 'Plan deleted')
      if (editing?.id === p.id) clear()
    }
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-16' },
    { key: 'name', header: 'Version type', sort: (r) => r.p.name, cell: (r) => <span className="font-semibold">{r.p.name}</span>, csv: (r) => r.p.name, hideOnMobile: true },
    { key: 'rate', header: 'Rate', align: 'right', sort: (r) => r.p.rate, cell: (r) => <span className="tabular">{formatINR(r.p.rate, true)}</span>, csv: (r) => r.p.rate },
    { key: 'gst', header: 'GST', align: 'right', sort: (r) => r.p.gstPct, cell: (r) => <span className="tabular">{r.p.gstPct}%</span>, csv: (r) => r.p.gstPct, hideOnMobile: true },
    { key: 'net', header: 'Net Amount', align: 'right', sort: (r) => r.p.netAmount, cell: (r) => <span className="tabular font-semibold">{formatINR(r.p.netAmount, true)}</span>, csv: (r) => r.p.netAmount },
    { key: 'logo', header: 'Logo', cell: (r) => (r.p.logo ? <img src={r.p.logo} alt="" className="h-8 w-12 rounded border border-border object-cover" /> : <span className="text-muted-foreground">—</span>), hideOnMobile: true },
    { key: 'primary', header: 'Primary', sort: (r) => (r.p.primary ? 0 : 1), cell: (r) => (r.p.primary ? <Badge tone="success" dot>Primary</Badge> : <span className="text-muted-foreground">—</span>), csv: (r) => (r.p.primary ? 'Yes' : 'No') },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => startEdit(r.p)} onDelete={() => void remove(r.p)} lockedReason={r.used ? `Assigned to ${r.used} account${r.used > 1 ? 's' : ''}` : r.p.primary && rows.length > 1 ? 'Primary plan — make another primary first' : undefined} /> },
  ]

  return (
    <>
      <PageHeader kicker="Licence console" title="Billing" description="Licence plans an agency pays for — the rate, GST and renewal amounts shown on licence invoices." />
      <FormTable
        noun="licence plan"
        form={
          <FormCard title="Billing" description={editing ? `Editing ${editing.name}` : 'Add a licence plan'} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending}>
            <Field label="Version type" required error={errors.name}>
              <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rate (₹)" required error={errors.rate}>
                <Input type="number" min={0} value={v.rate || ''} onChange={(e) => set('rate', Number(e.target.value))} aria-invalid={!!errors.rate} />
              </Field>
              <Field label="GST (%)" required error={errors.gstPct}>
                <Input type="number" min={0} max={100} value={v.gstPct} onChange={(e) => set('gstPct', Number(e.target.value))} aria-invalid={!!errors.gstPct} />
              </Field>
              <Field label="Net amount (₹)">
                <Input value={v.rate ? withGst(v.rate) : ''} readOnly disabled />
              </Field>
              <Field label="Renewal amount (₹)" required error={errors.renewalAmount}>
                <Input type="number" min={0} value={v.renewalAmount || ''} onChange={(e) => set('renewalAmount', Number(e.target.value))} aria-invalid={!!errors.renewalAmount} />
              </Field>
            </div>
            <Field label="Total renewal (₹)">
              <Input value={v.renewalAmount ? withGst(v.renewalAmount) : ''} readOnly disabled />
            </Field>
            <Field label="Logo (1024 × 768)" hint="Printed on the licence invoice. Larger images are scaled down.">
              <div className="flex items-center gap-3">
                <div className="grid h-14 w-[4.5rem] place-items-center overflow-hidden rounded-lg border border-border bg-muted">{v.logo ? <img src={v.logo} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="size-5 text-muted-foreground" />}</div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-[13px] font-semibold hover:bg-accent">
                  <ImagePlus className="size-4" /> Choose file
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('logo', await shrinkLogo(f)) }} />
                </label>
                {v.logo && (
                  <button type="button" className="text-[12.5px] text-destructive" onClick={() => set('logo', '')}>
                    Remove
                  </button>
                )}
              </div>
            </Field>
            <Switch checked={v.primary} onCheckedChange={(x) => set('primary', x)} label="Set as primary bill" />
          </FormCard>
        }
      >
        <DataTable cardAvatar={(r) => r.p.name} loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.p.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.p.name}</span>} search={(r) => r.p.name} exportName="licence-plans" empty={{ icon: BadgeIndianRupee, title: 'No plans yet', description: 'Add the first plan with the form.' }} />
      </FormTable>
    </>
  )
}
