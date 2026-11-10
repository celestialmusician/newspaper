import { KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Field, Input } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/misc'
import { useForm } from '@/hooks/form'
import { useRun } from '@/hooks/app'
import { auth } from '@/services/api'
import { FormCard } from '@/pages/console/shared'

const blank = { oldPin: '', newPin: '', confirmPin: '' }
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4)

/** Change Password — this app signs in with a 4-digit MPIN, so the three fields take the old, new and repeated MPIN. */
export default function ChangePassword() {
  const { run, pending } = useRun()
  const navigate = useNavigate()
  const form = useForm(blank, (v) => ({
    oldPin: /^\d{4}$/.test(v.oldPin) ? undefined : 'Enter your current 4-digit MPIN.',
    newPin: /^\d{4}$/.test(v.newPin) ? undefined : 'The new MPIN must be exactly 4 digits.',
    confirmPin: v.confirmPin === v.newPin ? undefined : 'The two MPINs do not match.',
  }))
  const { values: v, set, errors } = form
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(() => auth.changeMpin(v.oldPin, v.newPin), 'MPIN changed')
    if (ok) {
      form.reset(blank)
      navigate('/')
    }
  }
  return (
    <>
      <PageHeader kicker="Settings" title="Change Password" description="Change the MPIN you sign in with." />
      <div className="max-w-md">
        <FormCard title="Change Password" icon={KeyRound} onSubmit={save} pending={pending} submitLabel="Change Password">
          <Field label="Old MPIN" required error={errors.oldPin}>
            <Input type="password" inputMode="numeric" autoComplete="current-password" value={v.oldPin} onChange={(e) => set('oldPin', digits(e.target.value))} aria-invalid={!!errors.oldPin} />
          </Field>
          <Field label="New MPIN" required error={errors.newPin}>
            <Input type="password" inputMode="numeric" autoComplete="new-password" value={v.newPin} onChange={(e) => set('newPin', digits(e.target.value))} aria-invalid={!!errors.newPin} />
          </Field>
          <Field label="Confirm MPIN" required error={errors.confirmPin}>
            <Input type="password" inputMode="numeric" autoComplete="new-password" value={v.confirmPin} onChange={(e) => set('confirmPin', digits(e.target.value))} aria-invalid={!!errors.confirmPin} />
          </Field>
        </FormCard>
      </div>
    </>
  )
}
