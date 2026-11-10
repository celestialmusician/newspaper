import { KeyRound, LogOut, Palette, Pencil } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { CustomerDialog } from '@/components/CustomerDialog'
import { AppearancePanel } from '@/components/fx/Appearance'
import { PinInput } from '@/components/PinInput'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardBody, CardHeader, DemoNote, KeyValue, PageHeader } from '@/components/ui/misc'
import { Field, Input } from '@/components/ui/form'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { fullAddressLine } from '@/domain/locations'
import { ROLE_LABEL } from '@/domain/types'
import { errorMessage, useActor, useData, useRun } from '@/hooks/app'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { formatMobile, isIndianMobile } from '@/lib/utils'
import { auth } from '@/services/api'
import { toast } from 'sonner'

export default function Profile() {
  const db = useData()
  const actor = useActor()
  const navigate = useNavigate()
  const [edit, setEdit] = React.useState(false)
  const [pin, setPin] = React.useState(false)
  const name = userName(db, actor.userId)
  const user = actor.role === 'admin' ? (db.admins.find((a) => a.id === actor.userId) ?? db.admins[0]!) : actor.role === 'agent' ? db.agents.find((a) => a.id === actor.userId)! : actor.role === 'executive' ? db.executives.find((e) => e.id === actor.userId)! : db.customers.find((c) => c.id === actor.userId)!
  const cred = db.credentials[`${actor.role}:${user.mobile}`]
  const customer = actor.role === 'customer' ? db.customers.find((c) => c.id === actor.userId) : undefined
  // Administrator, agency owner and delivery boy edit their own profile; staff users work under the owner's profile.
  const canEditSelf = actor.role !== 'customer' && !actor.staffId
  const executive = actor.role === 'executive' ? db.executives.find((e) => e.id === actor.userId) : undefined
  React.useEffect(() => {
    if (window.location.hash === '#appearance') document.getElementById('appearance')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <>
      <PageHeader kicker="Account" title="My profile" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-6 text-center">
          <Avatar name={name} size={84} className="mx-auto text-3xl" />
          <div className="mt-3 font-display text-2xl font-semibold text-primary">{name}</div>
          <Badge tone="navy" className="mt-1">
            {ROLE_LABEL[actor.role]}
          </Badge>
          <div className="mt-2 text-[14px] text-muted-foreground">{formatMobile(user.mobile)}</div>
          <div className="mt-5 flex flex-col gap-2">
            {(customer || canEditSelf) && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> {customer ? 'Edit my details' : 'Edit profile'}
              </Button>
            )}
            <Button variant="outline" onClick={() => setPin(true)}>
              <KeyRound /> Change MPIN
            </Button>
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => {
                auth.logout()
                navigate('/login')
              }}
            >
              <LogOut /> Sign out
            </Button>
          </div>
          <div className="mt-4 text-[12px] text-muted-foreground">Last sign-in {fmtDateTime(cred?.lastLoginAt)}</div>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            {customer ? (
              <KeyValue
                items={[
                  ['Customer ID', customer.code],
                  ['Email', customer.email ?? '—'],
                  ['WhatsApp', customer.whatsapp ? formatMobile(customer.whatsapp) : '—'],
                  ['Alternate mobile', customer.altMobile ? formatMobile(customer.altMobile) : '—'],
                  ['Address', `${customer.houseName}, ${fullAddressLine(db, customer.areaId)}`],
                  ['Landmark', customer.landmark ?? '—'],
                  ['Agent', userName(db, customer.agentId)],
                  ['Registered', fmtDate(customer.registeredOn)],
                ]}
              />
            ) : (
              <KeyValue
                items={[
                  ['Name', name],
                  ['Mobile', formatMobile(user.mobile)],
                  ...(executive ? [['Alternate mobile', executive.altMobile ? `${formatMobile(executive.altMobile)} · ${executive.altMobileRelation}` : '—'] as [string, string]] : []),
                  ...('code' in user ? [['Code', user.code] as [string, string]] : []),
                  ...('agencyName' in user ? [['Agency', user.agencyName] as [string, string]] : []),
                  ...('areaIds' in user ? [['Areas', user.areaIds.map((id) => db.locations.find((l) => l.id === id)?.name).join(', ')] as [string, string]] : []),
                  ...('joiningDate' in user ? [['Joined', fmtDate(user.joiningDate)] as [string, string]] : []),
                  ['Status', user.status],
                ]}
              />
            )}
            {!customer && !canEditSelf && <DemoNote className="mt-4">Staff user details are managed by the agency owner.</DemoNote>}
          </CardBody>
        </Card>
        <Card id="appearance" className="scroll-mt-24 lg:col-start-2">
          <CardHeader icon={Palette} title="Appearance" description="Light or dark mode, colour theme and animation level. Saved on this device." />
          <CardBody>
            <AppearancePanel className="max-w-xl" />
          </CardBody>
        </Card>
      </div>
      {customer && <CustomerDialog open={edit} onOpenChange={setEdit} customer={customer} />}
      {edit && canEditSelf && <EditProfile onClose={() => setEdit(false)} name={name} mobile={user.mobile} email={'email' in user ? (user.email ?? '') : ''} />}
      {pin && <ChangeMpin onClose={() => setPin(false)} mobile={user.mobile} />}
    </>
  )
}

function ChangeMpin({ onClose, mobile }: { onClose: () => void; mobile: string }) {
  const actor = useActor()
  const [step, setStep] = React.useState<'otp' | 'new' | 'confirm'>('otp')
  const [code, setCode] = React.useState('')
  const [demo, setDemo] = React.useState('')
  const [token, setToken] = React.useState('')
  const [first, setFirst] = React.useState('')
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    void auth.requestOtp(actor.role, mobile).then((r) => setDemo(r.demoOtp))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const next = async (v: string) => {
    setErr('')
    try {
      if (step === 'otp') {
        const r = await auth.verifyOtp(actor.role, mobile, v)
        setToken(r.otpToken)
        setStep('new')
      } else if (step === 'new') {
        setFirst(v)
        setStep('confirm')
      } else {
        if (v !== first) throw new Error('MPINs do not match.')
        await auth.setMpin(actor.role, mobile, v, token)
        toast.success('MPIN changed')
        onClose()
      }
    } catch (e) {
      setErr(errorMessage(e))
    }
    setCode('')
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Change MPIN" description={step === 'otp' ? `Enter the OTP sent to +91 ${mobile}` : step === 'new' ? 'Choose a new 4-digit MPIN' : 'Confirm the new MPIN'}>
        {step === 'otp' && <DemoNote className="mb-4">Simulated OTP: <b className="tracking-widest">{demo}</b></DemoNote>}
        <PinInput key={step} length={step === 'otp' ? 6 : 4} masked={step !== 'otp'} value={code} onChange={setCode} onComplete={next} autoFocus label="Code" invalid={!!err} />
        {err && <p className="mt-3 text-center text-[13px] font-medium text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditProfile({ onClose, name, mobile, email }: { onClose: () => void; name: string; mobile: string; email: string }) {
  const { run, pending } = useRun()
  const [v, setV] = React.useState({ name, mobile, email })
  const [touched, setTouched] = React.useState(false)
  const errors = {
    name: v.name.trim() ? '' : 'Enter your name.',
    mobile: isIndianMobile(v.mobile) ? '' : 'Enter a valid 10-digit mobile number.',
    email: !v.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim()) ? '' : 'Enter a valid email address.',
  }
  const dirty = v.name.trim() !== name || v.mobile !== mobile || v.email.trim() !== email
  const save = async () => {
    setTouched(true)
    if (errors.name || errors.mobile || errors.email) return
    if (await run(() => auth.updateProfile(v), 'Profile saved')) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Edit profile" description="Your name, mobile number and email.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Field label="Name" required error={touched ? errors.name : undefined}>
            <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus autoComplete="name" />
          </Field>
          <Field label="Mobile" required error={touched ? errors.mobile : undefined} hint={v.mobile !== mobile ? 'You sign in with the new number. Your MPIN stays the same.' : undefined}>
            <Input value={v.mobile} inputMode="numeric" autoComplete="tel-national" onChange={(e) => setV({ ...v, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
          </Field>
          <Field label="Email" error={touched ? errors.email : undefined}>
            <Input value={v.email} type="email" autoComplete="email" onChange={(e) => setV({ ...v, email: e.target.value })} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !dirty}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
