import { ImagePlus, Truck } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/misc'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { children } from '@/domain/locations'
import { CONTACT_RELATIONS, type ContactRelation, type Executive, type IdProof } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { todayISO } from '@/lib/dates'
import { formatMobile } from '@/lib/utils'
import { executives as api, routes as routeApi } from '@/services/api'
import { FormSection } from '@/components/ui/form-guide'
import { FormCard, FormTable, RowActions } from '../console/shared'

const ID_PROOFS: IdProof[] = ['Aadhaar Card', 'Voter ID', 'Driving Licence', 'PAN Card']

const blank = {
  photo: '',
  code: '',
  name: '',
  stateId: '',
  districtId: '',
  routeId: '',
  mobile: '',
  altMobile: '',
  altMobileRelation: '' as '' | ContactRelation,
  email: '',
  idProof: '' as '' | IdProof,
  idNumber: '',
  username: '',
  password: '',
  joiningDate: todayISO(),
  address: '',
  active: true,
  collection: false,
  discontinued: false,
  discontinuedOn: todayISO(),
  reason: '',
}

async function shrinkPhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const size = 240
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const k = Math.max(size / img.width, size / img.height)
  c.getContext('2d')!.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k)
  URL.revokeObjectURL(url)
  return c.toDataURL('image/jpeg', 0.8)
}

/** Manage Delivery Boys: the legacy form, saved as delivery executives. */
export default function DeliveryBoys() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const actor = useActor()
  const { run, pending } = useRun()
  const me = db.agents.find((a) => a.id === actor.userId)!
  const [editing, setEditing] = React.useState<Executive | null>(null)
  const myRoutes = db.routes.filter((r) => r.agentId === actor.userId)
  const rows = db.executives.filter((e) => e.agentId === actor.userId).map((e, i) => ({ e, n: i + 1, used: Object.values(api.usage(e.id)).reduce((a, b) => a + b, 0) }))
  type Row = (typeof rows)[number]

  const form = useForm(blank, (x) => ({
    name: rules.required(x.name, 'Name'),
    stateId: rules.required(x.stateId, 'State'),
    districtId: rules.required(x.districtId, 'District'),
    routeId: rules.required(x.routeId, 'Route'),
    mobile: rules.mobile(x.mobile),
    altMobile: /^[6-9]\d{9}$/.test(x.altMobile) ? (x.altMobile === x.mobile ? 'Must differ from the mobile number.' : undefined) : 'Enter a valid 10-digit alternate number.',
    altMobileRelation: x.altMobileRelation ? undefined : 'Choose the relation.',
    email: rules.email(x.email),
    username: rules.required(x.username, 'Username'),
    password: editing && !x.password ? undefined : x.password.length >= 4 ? undefined : 'Enter a password of at least 4 characters.',
    discontinuedOn: x.discontinued && !x.discontinuedOn ? 'Choose the date.' : undefined,
  }))
  const { values: v, set, errors } = form
  const states = children(db, 'in', 'state')
  const districts = v.stateId ? children(db, v.stateId, 'district') : []
  const stateOf = (areaIds: string[]) => {
    const a = db.locations.find((l) => l.id === areaIds[0])
    const chain: string[] = []
    let n = a
    while (n) {
      chain.push(n.id)
      n = db.locations.find((l) => l.id === n!.parentId)
    }
    return { stateId: db.locations.find((l) => chain.includes(l.id) && l.level === 'state')?.id ?? '', districtId: db.locations.find((l) => chain.includes(l.id) && l.level === 'district')?.id ?? '' }
  }

  const clear = () => {
    setEditing(null)
    form.reset(blank)
  }
  const startEdit = (e: Executive) => {
    const route = db.routes.find((r) => r.executiveId === e.id)
    const where = stateOf(e.areaIds)
    setEditing(e)
    form.reset({
      photo: e.photo ?? '',
      code: e.code,
      name: e.name,
      ...where,
      routeId: route?.id ?? '',
      mobile: e.mobile,
      altMobile: e.altMobile ?? '',
      altMobileRelation: e.altMobileRelation ?? '',
      email: e.email ?? '',
      idProof: e.idProof && e.idProof !== 'None' ? e.idProof : '',
      idNumber: e.idNumber ?? '',
      username: e.username ?? '',
      password: '',
      joiningDate: e.joiningDate,
      address: e.address ?? '',
      active: e.status === 'active',
      collection: e.canCollectCash,
      discontinued: !!e.discontinuedOn,
      discontinuedOn: e.discontinuedOn ?? todayISO(),
      reason: e.discontinueReason ?? '',
    })
  }
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const route = myRoutes.find((r) => r.id === v.routeId)
    const base = {
      name: v.name.trim(),
      mobile: v.mobile,
      agentId: actor.userId,
      areaIds: route?.areaIds.length ? route.areaIds : me.areaIds,
      joiningDate: v.joiningDate,
      status: (v.active && !v.discontinued ? 'active' : 'inactive') as Executive['status'],
      canCollectCash: v.collection,
      altMobile: v.altMobile,
      altMobileRelation: v.altMobileRelation as ContactRelation,
      email: v.email.trim() || undefined,
      idProof: (v.idProof || undefined) as IdProof | undefined,
      idNumber: v.idNumber.trim() || undefined,
      username: v.username.trim(),
      password: v.password || undefined,
      address: v.address.trim() || undefined,
      photo: v.photo || undefined,
      discontinuedOn: v.discontinued ? v.discontinuedOn : undefined,
      discontinueReason: v.discontinued ? v.reason.trim() || undefined : undefined,
    }
    const saved = await run(() => (editing ? api.update(editing.id, base) : api.create({ ...base, code: v.code })), editing ? 'Delivery boy updated' : 'Delivery boy saved')
    if (!saved) return
    // The route decides which customers the delivery boy serves.
    if (route && route.executiveId !== saved.id && !v.discontinued) await run(() => routeApi.save({ id: route.id, name: route.name, areaIds: route.areaIds, agentId: route.agentId, executiveId: saved.id, instructions: route.instructions, status: route.status }))
    clear()
    return true
  }
  const remove = async (e: Executive) => {
    if (await confirm({ title: `Delete ${e.name}?`, description: 'No route or delivery history is linked, so the record can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(e.id), 'Delivery boy deleted')
      if (editing?.id === e.id) clear()
    }
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (x) => x.n, cell: (x) => <span className="tabular text-muted-foreground">{x.n}</span>, className: 'w-14' },
    {
      key: 'name',
      header: 'Delivery Boys Name',
      sort: (x) => x.e.name,
      csv: (x) => x.e.name,
      hideOnMobile: true,
      cell: (x) => (
        <span className="flex items-center gap-2.5">
          {x.e.photo ? <img src={x.e.photo} alt="" className="size-8 rounded-full object-cover" /> : <Avatar name={x.e.name} size={32} />}
          <span>
            <span className="block font-semibold">{x.e.name}</span>
            <span className="text-[12px] text-muted-foreground">{x.e.code}</span>
          </span>
        </span>
      ),
    },
    { key: 'mobile', header: 'Mobile Number', sort: (x) => x.e.mobile, cell: (x) => <span className="tabular">{formatMobile(x.e.mobile)}</span>, csv: (x) => x.e.mobile },
    { key: 'status', header: 'Status', sort: (x) => x.e.status, csv: (x) => (x.e.discontinuedOn ? 'discontinued' : x.e.status), cell: (x) => (x.e.discontinuedOn ? <StatusBadge status="cancelled" label="Discontinued" /> : <StatusBadge status={x.e.status} />) },
    { key: 'act', header: '', cell: (x) => <RowActions onEdit={() => startEdit(x.e)} onDelete={() => void remove(x.e)} lockedReason={x.used ? 'Has routes or delivery history — mark discontinued instead' : undefined} /> },
  ]

  return (
    <>
      <PageHeader kicker="Master" title="Manage Delivery Boys" description="Delivery boys sign in with their mobile number and MPIN." />
      <FormTable
        noun="delivery boy"
        form={
          <FormCard title="Delivery Boys Form" description={editing ? `Editing ${editing.name}` : undefined} editing={!!editing} onCancel={clear} onSubmit={save} pending={pending}>
            <FormSection n={1} title="Who" description="Photo, name and code.">
              <div className="flex items-center gap-3 @xl:col-span-2">
                <div className="grid size-16 place-items-center overflow-hidden rounded-xl border border-border bg-muted">{v.photo ? <img src={v.photo} alt="" className="size-full object-cover" /> : <ImagePlus className="size-6 text-muted-foreground" />}</div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-[13px] font-semibold hover:bg-accent">
                  <ImagePlus className="size-4" /> Photo
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('photo', await shrinkPhoto(f)) }} />
                </label>
                {v.photo && (
                  <button type="button" className="text-[12.5px] text-destructive" onClick={() => set('photo', '')}>
                    Remove
                  </button>
                )}
              </div>
              <Field label="Delivery Boys Code" hint={editing ? undefined : 'Leave empty to make one automatically'}>
                <Input value={v.code} disabled={!!editing} onChange={(e) => set('code', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Delivery Boys Name" required error={errors.name}>
                <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
              </Field>
              <Field label="Joining Date" className="@xl:col-span-2">
                <Input type="date" value={v.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
              </Field>
            </FormSection>
            <FormSection n={2} title="Area and route">
              <Field label="State" required error={errors.stateId}>
                <NativeSelect value={v.stateId} onChange={(e) => { set('stateId', e.target.value); set('districtId', '') }} aria-invalid={!!errors.stateId}>
                  <option value="">Select State</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="District" required error={errors.districtId}>
                <NativeSelect value={v.districtId} onChange={(e) => set('districtId', e.target.value)} aria-invalid={!!errors.districtId}>
                  <option value="">Select District</option>
                  {districts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Route" required error={errors.routeId} className="@xl:col-span-2">
                <NativeSelect value={v.routeId} onChange={(e) => set('routeId', e.target.value)} aria-invalid={!!errors.routeId}>
                  <option value="">Select Route</option>
                  {myRoutes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </FormSection>
            <FormSection n={3} title="Contact">
              <Field label="Mobile" required error={errors.mobile}>
                <Input value={v.mobile} inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
              </Field>
              <Field label="Email" error={errors.email}>
                <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
              </Field>
              <Field label="Alternate mobile" required error={errors.altMobile} hint="Staff-only contact">
                <Input value={v.altMobile} inputMode="numeric" onChange={(e) => set('altMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.altMobile} />
              </Field>
              <Field label="Relation" required error={errors.altMobileRelation}>
                <NativeSelect value={v.altMobileRelation} onChange={(e) => set('altMobileRelation', e.target.value as ContactRelation)} aria-invalid={!!errors.altMobileRelation}>
                  <option value="">Select</option>
                  {CONTACT_RELATIONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Address" className="@xl:col-span-2">
                <Textarea rows={2} value={v.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
            </FormSection>
            <FormSection n={4} title="ID and app login" description="The username and password open the delivery app.">
              <Field label="ID Proof">
                <NativeSelect value={v.idProof} onChange={(e) => set('idProof', e.target.value as IdProof)}>
                  <option value="">Select ID Proof</option>
                  {ID_PROOFS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Id No">
                <Input value={v.idNumber} onChange={(e) => set('idNumber', e.target.value)} />
              </Field>
              <Field label="Username" required error={errors.username}>
                <Input value={v.username} autoComplete="off" onChange={(e) => set('username', e.target.value)} aria-invalid={!!errors.username} />
              </Field>
              <Field label="Password" required={!editing} error={errors.password} hint={editing ? 'Leave empty to keep it' : undefined}>
                <Input type="password" value={v.password} autoComplete="new-password" onChange={(e) => set('password', e.target.value)} aria-invalid={!!errors.password} />
              </Field>
            </FormSection>
            <FormSection n={5} title="Status" className="@xl:grid-cols-1">
              <div className="grid gap-3">
                <Switch checked={v.active} onCheckedChange={(x) => set('active', x)} label="Display Status" />
                <Switch checked={v.collection} onCheckedChange={(x) => set('collection', x)} label="Collection Allowed" />
                <Switch checked={v.discontinued} onCheckedChange={(x) => set('discontinued', x)} label="Discontinued" />
              </div>
              {v.discontinued && (
                <div className="grid gap-3 rounded-xl border border-dashed border-destructive/40 bg-destructive/[0.04] p-3">
                  <Field label="Date of Discontinue" error={errors.discontinuedOn}>
                    <Input type="date" value={v.discontinuedOn} onChange={(e) => set('discontinuedOn', e.target.value)} />
                  </Field>
                  <Field label="Reason for Discontinue">
                    <Textarea rows={2} value={v.reason} onChange={(e) => set('reason', e.target.value)} />
                  </Field>
                </div>
              )}
            </FormSection>
          </FormCard>
        }
      >
        <DataTable cardAvatar={(x) => x.e.name} loading={!ready} rows={rows} columns={cols} rowKey={(x) => x.e.id} mobileTitle={(x) => <span className="font-semibold">{x.n}. {x.e.name}</span>} search={(x) => `${x.e.name} ${x.e.mobile} ${x.e.code}`} exportName="delivery-boys" empty={{ icon: Truck, title: 'No delivery boys yet', description: 'Add the first one with the form.' }} />
      </FormTable>
    </>
  )
}
