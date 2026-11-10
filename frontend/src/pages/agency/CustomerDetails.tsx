import { Users } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { FormSection } from '@/components/ui/form-guide'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { customerOutstanding } from '@/domain/billing'
import { areaLabel } from '@/domain/locations'
import type { Customer, IdProof } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { todayISO } from '@/lib/dates'
import { formatINR, formatMobile } from '@/lib/utils'
import { customers as api } from '@/services/api'
import { FormCard, FormTable, RowActions } from '../console/shared'

const ID_PROOFS: IdProof[] = ['Aadhaar Card', 'Voter ID', 'Driving Licence', 'PAN Card']
const blank = {
  name: '',
  code: '',
  areaId: '',
  routeId: '',
  serialNo: '',
  landline: '',
  mobile: '',
  whatsapp: '',
  email: '',
  idProof: '' as '' | IdProof,
  idNumber: '',
  deposit: 0,
  address: '',
  handling: 0,
  joiningDate: todayISO(),
  active: true,
  skipBill: false,
  subAgent: false,
}

/** CRM > Customer Details: the legacy customer form with its list underneath. */
export default function CustomerDetails() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const actor = useActor()
  const { run, pending } = useRun()
  const me = db.agents.find((a) => a.id === actor.userId)!
  const [editing, setEditing] = React.useState<Customer | null>(null)
  const myRoutes = db.routes.filter((r) => r.agentId === actor.userId)
  const areas = db.locations.filter((l) => l.level === 'area' && me.areaIds.includes(l.id))
  const rows = db.customers
    .filter((c) => c.agentId === actor.userId)
    .map((c, i) => {
      const route = db.routes.find((r) => r.id === c.routeId)
      return { c, n: i + 1, route, boy: db.executives.find((e) => e.id === route?.executiveId), due: customerOutstanding(db, c.id), used: Object.values(api.usage(c.id)).reduce((a, b) => a + b, 0) }
    })
  type Row = (typeof rows)[number]

  const form = useForm(blank, (v) => ({
    name: rules.required(v.name, 'Customer name'),
    areaId: rules.required(v.areaId, 'Area'),
    routeId: rules.required(v.routeId, 'Route'),
    serialNo: rules.required(v.serialNo, 'Serial no'),
    mobile: rules.mobile(v.mobile),
    whatsapp: rules.mobile(v.whatsapp),
    email: rules.email(v.email),
    address: rules.required(v.address, 'Address'),
  }))
  const { values: v, set, errors } = form
  const pickedRoute = myRoutes.find((r) => r.id === v.routeId)
  const boy = db.executives.find((e) => e.id === pickedRoute?.executiveId)

  const clear = () => {
    setEditing(null)
    form.reset(blank)
  }
  const startEdit = (c: Customer) => {
    setEditing(c)
    form.reset({ name: c.name, code: c.code, areaId: c.areaId, routeId: c.routeId ?? '', serialNo: c.serialNo ?? '', landline: c.landline ?? '', mobile: c.mobile, whatsapp: c.whatsapp ?? '', email: c.email ?? '', idProof: c.idProof === 'None' ? '' : c.idProof, idNumber: c.idNumber ?? '', deposit: c.securityDeposit, address: c.address, handling: c.handlingCharge, joiningDate: c.registeredOn, active: c.status === 'active', skipBill: !!c.skipBill, subAgent: !!c.subAgent })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const area = db.locations.find((l) => l.id === v.areaId)
    const base = {
      name: v.name.trim(),
      mobile: v.mobile,
      whatsapp: v.whatsapp,
      email: v.email.trim() || undefined,
      areaId: v.areaId,
      houseName: editing?.houseName || v.address.split(',')[0]!.trim(),
      address: v.address.trim(),
      lat: editing?.lat ?? area?.lat ?? 0,
      lng: editing?.lng ?? area?.lng ?? 0,
      idProof: (v.idProof || 'None') as IdProof,
      idNumber: v.idNumber.trim() || undefined,
      securityDeposit: Number(v.deposit) || 0,
      handlingCharge: Number(v.handling) || 0,
      serialNo: v.serialNo.trim(),
      landline: v.landline.trim() || undefined,
      skipBill: v.skipBill,
      subAgent: v.subAgent,
      routeId: v.routeId,
    }
    const ok = await run(() => (editing ? api.update(editing.id, { ...base, status: v.active ? 'active' : 'inactive' }) : api.create({ ...base, code: v.code, registeredOn: v.joiningDate })), editing ? 'Customer updated' : 'Customer saved')
    if (ok) clear()
    return !!ok
  }
  const remove = async (c: Customer) => {
    if (await confirm({ title: `Delete ${c.name}?`, description: 'No subscriptions, deliveries or bills are linked, so the record can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(c.id), 'Customer deleted')
      if (editing?.id === c.id) clear()
    }
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Si No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    { key: 'name', header: 'Customer Name', sort: (r) => r.c.name, cell: (r) => <span><span className="block font-semibold">{r.c.name}</span><span className="text-[12px] text-muted-foreground">{r.c.code}</span></span>, csv: (r) => r.c.name, hideOnMobile: true },
    { key: 'mobile', header: 'Mobile', sort: (r) => r.c.mobile, cell: (r) => <span className="tabular">{formatMobile(r.c.mobile)}</span>, csv: (r) => r.c.mobile },
    { key: 'serial', header: 'Customer Serial No', sort: (r) => r.c.serialNo ?? '', cell: (r) => r.c.serialNo || '—', csv: (r) => r.c.serialNo ?? '' },
    { key: 'boy', header: 'Delivery Boy', sort: (r) => r.boy?.name ?? '', cell: (r) => r.boy?.name ?? '—', csv: (r) => r.boy?.name ?? '', hideOnMobile: true },
    { key: 'route', header: 'Route', sort: (r) => r.route?.name ?? '', cell: (r) => r.route ? `${r.route.name} (${r.route.code})` : '—', csv: (r) => r.route?.name ?? '', hideOnMobile: true },
    { key: 'due', header: 'Due Amount', align: 'right', sort: (r) => r.due, cell: (r) => <span className={r.due ? 'tabular font-semibold text-destructive' : 'tabular'}>{formatINR(r.due)}</span>, csv: (r) => r.due },
    { key: 'status', header: 'Active/Deactive', sort: (r) => r.c.status, cell: (r) => <StatusBadge status={r.c.status} />, csv: (r) => r.c.status },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => startEdit(r.c)} onDelete={() => void remove(r.c)} lockedReason={r.used ? 'Has subscriptions or bills — mark inactive instead' : undefined} /> },
  ]

  return (
    <>
      <PageHeader kicker="Master · CRM" title="Customer Details" description="Add and edit your subscribers." />
      <FormTable
        noun="customer"
        form={
          <FormCard title="Customer Details Form" description={editing ? `Editing ${editing.name}` : undefined} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending} submitLabel={editing ? 'Save changes' : 'Save customer'}>
            <FormSection n={1} title="Customer" description="Who the customer is and when they joined." className="@2xl:grid-cols-3">
              <Field label="Customer Name" required error={errors.name}>
                <Input value={v.name} placeholder="Customer Name" onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
              </Field>
              <Field label="Customer Code" hint={editing ? undefined : 'Leave empty to make one automatically'}>
                <Input value={v.code} disabled={!!editing} placeholder="Customer Code" onChange={(e) => set('code', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Joining Date">
                <Input type="date" value={v.joiningDate} disabled={!!editing} onChange={(e) => set('joiningDate', e.target.value)} />
              </Field>
            </FormSection>
            <FormSection n={2} title="Delivery" description="Where the paper goes. The delivery boy comes from the route." className="@2xl:grid-cols-4">
              <Field label="Area" required error={errors.areaId}>
                <NativeSelect value={v.areaId} onChange={(e) => set('areaId', e.target.value)} aria-invalid={!!errors.areaId}>
                  <option value="">Select Area</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {areaLabel(db, a.id)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Route" required error={errors.routeId}>
                <NativeSelect value={v.routeId} onChange={(e) => set('routeId', e.target.value)} aria-invalid={!!errors.routeId}>
                  <option value="">Select Route</option>
                  {myRoutes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Delivery Boys Name" hint="Set by the route">
                <NativeSelect value={boy?.id ?? ''} disabled onChange={() => undefined}>
                  <option value="">{boy ? boy.name : 'Select Delivery Boy'}</option>
                  {boy && <option value={boy.id}>{boy.name}</option>}
                </NativeSelect>
              </Field>
              <Field label="Serial No" required error={errors.serialNo}>
                <Input value={v.serialNo} placeholder="Serial No" onChange={(e) => set('serialNo', e.target.value)} aria-invalid={!!errors.serialNo} />
              </Field>
            </FormSection>
            <FormSection n={3} title="Contact" className="@2xl:grid-cols-4">
              <Field label="Mobile" required error={errors.mobile}>
                <Input value={v.mobile} placeholder="Mobile" inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
              </Field>
              <Field label="Whatsapp No" required error={errors.whatsapp}>
                <Input value={v.whatsapp} placeholder="Whatsapp No" inputMode="numeric" onChange={(e) => set('whatsapp', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.whatsapp} />
              </Field>
              <Field label="Landline No">
                <Input value={v.landline} placeholder="Landline No" onChange={(e) => set('landline', e.target.value)} />
              </Field>
              <Field label="Email" error={errors.email}>
                <Input type="email" value={v.email} placeholder="Email" onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
              </Field>
              <Field label="Address" required error={errors.address} className="@xl:col-span-2 @2xl:col-span-4">
                <Textarea rows={2} value={v.address} placeholder="Customer Address" onChange={(e) => set('address', e.target.value)} aria-invalid={!!errors.address} />
              </Field>
            </FormSection>
            <FormSection n={4} title="ID and billing" description="All optional." className="@2xl:grid-cols-3 @5xl:grid-cols-5">
              <Field label="ID Proof">
                <NativeSelect value={v.idProof} onChange={(e) => set('idProof', e.target.value as IdProof)}>
                  <option value="">Select ID Proof</option>
                  {ID_PROOFS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Id No">
                <Input value={v.idNumber} placeholder="Id No" onChange={(e) => set('idNumber', e.target.value)} />
              </Field>
              <Field label="Security Deposit">
                <Input type="number" min={0} value={v.deposit || ''} placeholder="Security Deposit" onChange={(e) => set('deposit', Number(e.target.value))} />
              </Field>
              <Field label="Handling Charge">
                <Input type="number" min={0} value={v.handling} onChange={(e) => set('handling', Number(e.target.value))} />
              </Field>
              <Field label="Due Amount" hint="Calculated from unpaid bills">
                <Input value={editing ? customerOutstanding(db, editing.id).toFixed(2) : ''} readOnly disabled />
              </Field>
            </FormSection>
            <FormSection n={5} title="Status" className="@xl:grid-cols-1">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Switch checked={v.active} onCheckedChange={(x) => set('active', x)} label="Display Status" />
                <Switch checked={v.skipBill} onCheckedChange={(x) => set('skipBill', x)} label="Skip Bill" />
                <Switch checked={v.subAgent} onCheckedChange={(x) => set('subAgent', x)} label="Sub-agent" />
              </div>
            </FormSection>
          </FormCard>
        }
      >
        <DataTable cardAvatar={(r) => r.c.name} loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.c.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.c.name}</span>} search={(r) => `${r.c.name} ${r.c.mobile} ${r.c.code} ${r.c.serialNo ?? ''} ${r.route?.name ?? ''}`} exportName="customers" empty={{ icon: Users, title: 'No customers yet', description: 'Add the first customer with the form.' }} />
      </FormTable>
    </>
  )
}
