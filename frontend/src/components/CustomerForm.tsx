import * as React from 'react'
import { LocationPicker } from '@/components/LocationPicker'
import { MapPicker } from '@/components/Maps'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/form'
import { Section } from '@/components/ui/misc'
import { chainByLevel, fullAddressLine } from '@/domain/locations'
import type { Customer, IdProof } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useData } from '@/hooks/app'
import type { CustomerInput } from '@/services/api'

export interface CustomerFormValues extends Record<string, unknown> {
  name: string
  mobile: string
  altMobile: string
  whatsapp: string
  email: string
  gender: '' | 'Male' | 'Female' | 'Other'
  dob: string
  areaId: string | null
  houseName: string
  landmark: string
  address: string
  lat: number | undefined
  lng: number | undefined
  agentId: string
  routeId: string
  idProof: IdProof
  idNumber: string
  securityDeposit: number
  handlingCharge: number
}

export function customerToValues(c?: Customer): CustomerFormValues {
  return {
    name: c?.name ?? '',
    mobile: c?.mobile ?? '',
    altMobile: c?.altMobile ?? '',
    whatsapp: c?.whatsapp ?? '',
    email: c?.email ?? '',
    gender: c?.gender ?? '',
    dob: c?.dob ?? '',
    areaId: c?.areaId ?? null,
    houseName: c?.houseName ?? '',
    landmark: c?.landmark ?? '',
    address: c?.address ?? '',
    lat: c?.lat,
    lng: c?.lng,
    agentId: c?.agentId ?? '',
    routeId: c?.routeId ?? '',
    idProof: c?.idProof ?? 'None',
    idNumber: c?.idNumber ?? '',
    securityDeposit: c?.securityDeposit ?? 0,
    handlingCharge: c?.handlingCharge ?? 0,
  }
}

export function valuesToInput(v: CustomerFormValues): CustomerInput {
  return {
    name: v.name.trim(),
    mobile: v.mobile,
    altMobile: v.altMobile || undefined,
    whatsapp: v.whatsapp || undefined,
    email: v.email || undefined,
    gender: v.gender || undefined,
    dob: v.dob || undefined,
    areaId: v.areaId!,
    houseName: v.houseName.trim(),
    landmark: v.landmark || undefined,
    address: v.address.trim(),
    lat: v.lat!,
    lng: v.lng!,
    idProof: v.idProof,
    idNumber: v.idNumber || undefined,
    securityDeposit: Number(v.securityDeposit) || 0,
    handlingCharge: Number(v.handlingCharge) || 0,
    agentId: v.agentId || undefined,
    routeId: v.routeId || null,
  }
}

export function useCustomerForm(initial: CustomerFormValues, opts: { staff: boolean; requireAgent: boolean }) {
  return useForm(initial, (v) => ({
    name: rules.required(v.name, 'Full name') ?? (v.name.trim().length < 3 ? 'Enter the full name.' : undefined),
    mobile: rules.mobile(v.mobile),
    altMobile: rules.mobile(v.altMobile, false),
    whatsapp: rules.mobile(v.whatsapp, false),
    email: rules.email(v.email),
    areaId: v.areaId ? undefined : 'Select the area.',
    houseName: rules.required(v.houseName, 'House name / number'),
    address: rules.required(v.address, 'Complete address'),
    lat: typeof v.lat === 'number' ? undefined : 'Drop a pin on the map so the delivery executive can find the house.',
    agentId: opts.staff && opts.requireAgent && !v.agentId ? 'Select the assigned agent.' : undefined,
    securityDeposit: rules.nonNegative(Number(v.securityDeposit), 'Security deposit'),
    handlingCharge: rules.nonNegative(Number(v.handlingCharge), 'Handling charge'),
  }))
}

type FormApi = ReturnType<typeof useCustomerForm>

/** A titled section; in single-part mode the caller already shows the part name, so the title is dropped. */
function PartSection({ title, bare, children }: { title: string; bare: boolean; children: React.ReactNode }) {
  return bare ? <div className="space-y-4">{children}</div> : <Section title={title}>{children}</Section>
}

/** Sign-up shows one part per screen so nothing scrolls; without `only` every part is shown. */
export type CustomerPart = 'personal' | 'location' | 'house' | 'map'

export function CustomerFormFields({ form, staff, showAgent, only }: { form: FormApi; staff: boolean; showAgent: boolean; only?: CustomerPart }) {
  const db = useData()
  const show = (p: CustomerPart) => !only || only === p
  // In single-part mode short fields pair up two per row.
  const pair = only ? 'col-span-2' : ''
  const { values: v, set, errors } = form
  const area = v.areaId ? db.locations.find((l) => l.id === v.areaId) : undefined

  // Auto-compose the complete address from house + area chain, while still editable.
  const lastAuto = React.useRef('')
  React.useEffect(() => {
    if (!v.areaId) return
    const auto = [v.houseName, v.landmark, fullAddressLine(db, v.areaId)].filter(Boolean).join(', ')
    if (!v.address || v.address === lastAuto.current) set('address', auto)
    lastAuto.current = auto
    if (v.lat === undefined && area?.lat) form.patch({ lat: area.lat, lng: area.lng })
  }, [v.areaId, v.houseName, v.landmark]) // eslint-disable-line react-hooks/exhaustive-deps

  const routeOptions = db.routes.filter((r) => r.status === 'active' && (!v.agentId || r.agentId === v.agentId))
  const suggested = v.areaId ? routeOptions.find((r) => r.areaIds.includes(v.areaId!)) : undefined
  const chain = chainByLevel(db, v.areaId)

  return (
    <div className={only ? 'space-y-4' : 'space-y-8'}>
      {show('personal') && (
      <PartSection title="Personal details" bare={!!only}>
        <div className={only ? 'grid grid-cols-2 gap-x-3 gap-y-3' : 'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
          <Field label="Full name" required error={errors.name} className={pair}>
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sreelakshmi Nair" autoComplete="name" aria-invalid={!!errors.name} />
          </Field>
          <Field label="Mobile number" required error={errors.mobile} className={pair}>
            <Input value={v.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" placeholder="98470 12345" aria-invalid={!!errors.mobile} />
          </Field>
          <Field label="Alternate mobile" error={errors.altMobile}>
            <Input value={v.altMobile} onChange={(e) => set('altMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" aria-invalid={!!errors.altMobile} />
          </Field>
          <Field label="WhatsApp number" error={errors.whatsapp} hint={only ? undefined : 'For bill reminders.'}>
            <Input value={v.whatsapp} onChange={(e) => set('whatsapp', e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" aria-invalid={!!errors.whatsapp} />
          </Field>
          <Field label="Email" error={errors.email} className={pair}>
            <Input value={v.email} onChange={(e) => set('email', e.target.value)} type="email" autoComplete="email" aria-invalid={!!errors.email} />
          </Field>
          <div className={`grid grid-cols-2 gap-x-3 gap-y-3 ${only ? pair : 'sm:gap-4'}`}>
            <Field label="Gender">
              <NativeSelect value={v.gender} onChange={(e) => set('gender', e.target.value as CustomerFormValues['gender'])}>
                <option value="">Prefer not to say</option>
                <option>Male</option>
                <option>Female</option>
                <option>Other</option>
              </NativeSelect>
            </Field>
            <Field label="Date of birth">
              <Input type="date" value={v.dob} onChange={(e) => set('dob', e.target.value)} max={new Date().toISOString().slice(0, 10)} />
            </Field>
          </div>
        </div>
      </PartSection>
      )}

      {(show('location') || show('house')) && (
        <PartSection title="Address" bare={!!only}>
          {show('location') && <LocationPicker value={v.areaId} onChange={(id) => set('areaId', id)} error={errors.areaId} compact={!!only} />}
          {show('house') && (
            <>
              <div className={only ? 'grid gap-3' : 'grid gap-4 sm:grid-cols-2'}>
                <Field label="House name / number" required error={errors.houseName}>
                  <Input value={v.houseName} onChange={(e) => set('houseName', e.target.value)} placeholder="e.g. Sreenilayam, TC 14/221" aria-invalid={!!errors.houseName} />
                </Field>
                <Field label="Landmark">
                  <Input value={v.landmark} onChange={(e) => set('landmark', e.target.value)} placeholder="e.g. Near Kumarapuram temple" />
                </Field>
              </div>
              <Field label="Complete address" required error={errors.address} hint={chain.area ? `Pincode ${chain.area.pincode}` : undefined}>
                <Textarea value={v.address} onChange={(e) => set('address', e.target.value)} rows={only ? 3 : 2} aria-invalid={!!errors.address} />
              </Field>
            </>
          )}
        </PartSection>
      )}

      {show('map') && (
        <PartSection title="Map location" bare={!!only}>
          <MapPicker lat={v.lat} lng={v.lng} onChange={(lat, lng) => form.patch({ lat, lng })} fallback={area?.lat ? [area.lat, area.lng!] : undefined} height={only ? 'clamp(180px, calc(100dvh - 520px), 340px)' : 280} />
          {errors.lat && <p className="text-[12.5px] font-medium text-destructive">{errors.lat}</p>}
        </PartSection>
      )}

      {staff && (
        <Section title="Account & distribution">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {showAgent && (
              <Field label="Assigned agent" required error={errors.agentId}>
                <NativeSelect value={v.agentId} onChange={(e) => form.patch({ agentId: e.target.value, routeId: '' })} aria-invalid={!!errors.agentId}>
                  <option value="">Select agent</option>
                  {db.agents.filter((a) => a.status === 'active').map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.agencyName}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field label="Delivery route" hint={suggested && v.routeId !== suggested.id ? `Suggested for this area: ${suggested.name}` : 'The delivery executive comes from the route.'}>
              <NativeSelect value={v.routeId} onChange={(e) => set('routeId', e.target.value)}>
                <option value="">Not assigned yet</option>
                {routeOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.name} — {db.executives.find((e) => e.id === r.executiveId)?.name ?? 'no executive'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="ID proof">
              <NativeSelect value={v.idProof} onChange={(e) => set('idProof', e.target.value as IdProof)}>
                {(['None', 'Aadhaar Card', 'Voter ID', 'Driving Licence', 'PAN Card'] as IdProof[]).map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </NativeSelect>
            </Field>
            {v.idProof !== 'None' && (
              <Field label="ID number" hint="Store only the last 4 digits.">
                <Input value={v.idNumber} onChange={(e) => set('idNumber', e.target.value)} placeholder="XXXX-XXXX-1234" />
              </Field>
            )}
            <Field label="Security deposit (₹)" error={errors.securityDeposit}>
              <Input type="number" min={0} value={v.securityDeposit} onChange={(e) => set('securityDeposit', Number(e.target.value))} inputMode="decimal" />
            </Field>
            <Field label="Monthly handling charge (₹)" error={errors.handlingCharge} hint="Added to every monthly bill.">
              <Input type="number" min={0} value={v.handlingCharge} onChange={(e) => set('handlingCharge', Number(e.target.value))} inputMode="decimal" />
            </Field>
          </div>
        </Section>
      )}
    </div>
  )
}
