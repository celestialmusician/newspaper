import { Plus } from 'lucide-react'
import * as React from 'react'
import { AreaMultiSelect } from '@/components/AreaMultiSelect'
import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { FormActions, FormSection } from '@/components/ui/form-guide'
import { DrawerBody, FormDrawer } from '@/components/ui/workspace'
import { useData, useRun } from '@/hooks/app'
import { addDaysISO, todayISO } from '@/lib/dates'
import { formatINR, isIndianMobile } from '@/lib/utils'
import { licences as api } from '@/services/api'

type Form = { agencyName: string; ownerName: string; mobile: string; email: string; areaIds: string[]; planId: string; licenceEnd: string; userLimit: number }
type Errors = Partial<Record<keyof Form, string>>

/**
 * Add agency: the super administrator opens a new agency account directly (the same account
 * Account Verification creates from a public registration). The agency then signs in with the
 * mobile number and creates its MPIN with an OTP.
 */
export function AddAgencyPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const primary = db.licencePlans.find((p) => p.primary)
  const blank = (): Form => ({ agencyName: '', ownerName: '', mobile: '', email: '', areaIds: [], planId: primary?.id ?? '', licenceEnd: addDaysISO(todayISO(), 365), userLimit: 3 })
  const [v, setV] = React.useState<Form>(blank)
  const [errors, setErrors] = React.useState<Errors>({})
  const set = <K extends keyof Form>(k: K, x: Form[K]) => {
    setV((p) => ({ ...p, [k]: x }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  const save = async () => {
    const e: Errors = {}
    if (v.agencyName.trim().length < 3) e.agencyName = 'Enter the agency name.'
    if (v.ownerName.trim().length < 3) e.ownerName = 'Enter the owner name.'
    if (!isIndianMobile(v.mobile)) e.mobile = 'Enter a valid 10-digit mobile number.'
    else if (db.agents.some((a) => a.mobile === v.mobile)) e.mobile = 'An agency already uses this mobile number.'
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = 'Enter a valid email address.'
    if (!v.areaIds.length) e.areaIds = 'Pick at least one service area.'
    if (!v.licenceEnd || v.licenceEnd <= todayISO()) e.licenceEnd = 'Pick a date after today.'
    if (!(v.userLimit >= 1)) e.userLimit = 'Allow at least one user.'
    setErrors(e)
    if (Object.values(e).some(Boolean)) return
    const ag = await run(() => api.create({ ...v, planId: v.planId || null }), (a) => `${a.agencyName} added as ${a.code} · ${a.accountNo}`)
    if (ag) {
      setV(blank())
      onClose()
    }
  }

  return (
    <FormDrawer open={open} onClose={onClose} kicker="Active Accounts" title="Add agency" description="The agency signs in with this mobile number and creates its MPIN with an OTP.">
      <form
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <DrawerBody className="grid content-start gap-4">
          <FormSection n={1} title="Agency" description="Who runs it and how to reach them.">
            <Field label="Agency Name" required error={errors.agencyName}>
              <Input value={v.agencyName} onChange={(e) => set('agencyName', e.target.value)} aria-invalid={!!errors.agencyName} />
            </Field>
            <Field label="Owner Name" required error={errors.ownerName}>
              <Input value={v.ownerName} onChange={(e) => set('ownerName', e.target.value)} aria-invalid={!!errors.ownerName} />
            </Field>
            <Field label="Mobile" required error={errors.mobile} hint="Used to sign in">
              <Input value={v.mobile} inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
            </Field>
            <Field label="Email" error={errors.email}>
              <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
            </Field>
          </FormSection>
          <FormSection n={2} title="Service areas" description="Where the agency distributes." className="@xl:grid-cols-1">
            <Field label="Service areas" required error={errors.areaIds}>
              <AreaMultiSelect value={v.areaIds} onChange={(x) => set('areaIds', x)} invalid={!!errors.areaIds} />
            </Field>
          </FormSection>
          <FormSection n={3} title="Licence" description="Plan, validity and how many logins it allows." className="@2xl:grid-cols-3">
            <Field label="Licence plan">
              <NativeSelect value={v.planId} onChange={(e) => set('planId', e.target.value)}>
                <option value="">No plan</option>
                {db.licencePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {formatINR(p.netAmount, true)}
                    {p.primary ? ' (primary)' : ''}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Licence valid till" required error={errors.licenceEnd}>
              <Input type="date" min={addDaysISO(todayISO(), 1)} value={v.licenceEnd} onChange={(e) => set('licenceEnd', e.target.value)} aria-invalid={!!errors.licenceEnd} />
            </Field>
            <Field label="Users allowed" required error={errors.userLimit} hint="Agent plus delivery-boy logins">
              <Input type="number" min={1} value={v.userLimit} onChange={(e) => set('userLimit', Number(e.target.value))} aria-invalid={!!errors.userLimit} />
            </Field>
          </FormSection>
        </DrawerBody>
        <FormActions className="in-drawer">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="success" loading={pending}>
            <Plus /> Add agency
          </Button>
        </FormActions>
      </form>
    </FormDrawer>
  )
}
