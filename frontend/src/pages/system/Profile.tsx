import { KeyRound, LogOut, Palette, Pencil } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { CustomerDialog } from '@/components/CustomerDialog'
import { AppearancePanel } from '@/components/fx/Appearance'
import { PinInput } from '@/components/PinInput'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Card, CardBody, CardHeader, DemoNote, KeyValue, PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { fullAddressLine } from '@/domain/locations'
import { ROLE_LABEL } from '@/domain/types'
import { errorMessage, useActor, useData } from '@/hooks/app'
import { fmtDate, fmtDateTime } from '@/lib/dates'
import { formatMobile } from '@/lib/utils'
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
            {customer && (
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit my details
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
            {!customer && <DemoNote className="mt-4">Staff profile details are managed by the Super Administrator.</DemoNote>}
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
