import { ArrowLeft, ArrowRight, Bike, CheckCircle2, ChevronRight, KeyRound, MessageSquareText, ShieldCheck, Store, UserRound, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CustomerFormFields, customerToValues, useCustomerForm, valuesToInput, type CustomerFormValues, type CustomerPart } from '@/components/CustomerForm'
import { queueWelcome } from '@/components/fx/Appearance'
import { Keypad, PinInput } from '@/components/PinInput'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { DemoNote } from '@/components/ui/misc'
import { errorMessage, useData } from '@/hooks/app'
import { rules, useForm } from '@/hooks/form'
import { cn } from '@/lib/utils'
import { accountRequests, ApiError, auth } from '@/services/api'
import { AuthLayout } from './AuthLayout'

type Step = 'details' | 'otp' | 'mpin' | 'confirm'
type Who = '' | 'customer' | 'agent' | 'executive'

const TYPES: { id: Exclude<Who, ''>; icon: LucideIcon; title: string; text: string; tag: string }[] = [
  { id: 'customer', icon: UserRound, title: 'Customer / Subscriber', text: 'Papers and magazines at your door.', tag: 'Free · 2 minutes' },
  { id: 'agent', icon: Store, title: 'Agency Owner', text: 'Routes, billing and collections.', tag: 'Verified by NewsRound' },
  { id: 'executive', icon: Bike, title: 'Delivery Executive', text: 'Your login comes from your agency.', tag: 'Added by your agency' },
]

/** The customer details form is a short flow of single screens, so the sign-in card never needs to scroll. */
const PARTS: CustomerPart[] = ['personal', 'location', 'house', 'map']
const PART_KEYS: Record<CustomerPart, (keyof CustomerFormValues)[]> = {
  personal: ['name', 'mobile', 'altMobile', 'whatsapp', 'email'],
  location: ['areaId'],
  house: ['houseName', 'address'],
  map: ['lat'],
}
const STAGES = ['Personal details', 'Your area', 'House details', 'Map location', 'Verify mobile', 'Create MPIN']

export default function Register() {
  const db = useData()
  const navigate = useNavigate()
  const [who, setWho] = React.useState<Who>('')
  const form = useCustomerForm(customerToValues(), { staff: false, requireAgent: false })
  const [step, setStep] = React.useState<Step>('details')
  const [sub, setSub] = React.useState(0)
  const [code, setCode] = React.useState('')
  const [mpin, setMpin] = React.useState('')
  const [demoOtp, setDemoOtp] = React.useState('')
  const [token, setToken] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(0)
  const [registered, setRegistered] = React.useState(false)

  React.useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const go = (s: Step) => {
    setError('')
    setCode('')
    setStep(s)
  }

  const sendOtp = async () => {
    const r = await auth.requestOtp('customer', form.values.mobile)
    setDemoOtp(r.demoOtp)
    setCooldown(r.cooldown)
    if (!r.reused) toast.message(`Demo SMS → +91 ${form.values.mobile}`, { description: `Your NewsRound OTP is ${r.demoOtp}` })
  }

  const lastPart = sub === PARTS.length - 1

  const nextPart = () => {
    if (!form.checkKeys(PART_KEYS[PARTS[sub]!])) {
      toast.error('Please fix the highlighted fields.')
      return
    }
    setSub((s) => Math.min(s + 1, PARTS.length - 1))
  }

  const submitDetails = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lastPart) return nextPart()
    if (!form.check()) {
      // A field on an earlier screen is wrong: take the user back to it.
      const bad = form.peek()
      const at = PARTS.findIndex((p) => PART_KEYS[p].some((k) => bad[k]))
      if (at >= 0) setSub(at)
      toast.error('Please fix the highlighted fields.')
      return
    }
    if (db.customers.some((c) => c.mobile === form.values.mobile)) {
      toast.error('This mobile number already has an account. Please sign in instead.')
      setSub(0)
      return
    }
    setBusy(true)
    await sendOtp()
    setBusy(false)
    go('otp')
  }

  const verify = async (otp = code) => {
    if (otp.length !== 6) return
    setBusy(true)
    try {
      const r = await auth.verifyOtp('customer', form.values.mobile, otp)
      if (!registered) {
        await auth.registerCustomer(valuesToInput(form.values))
        setRegistered(true)
      }
      setToken(r.otpToken)
      go('mpin')
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const finish = async (pin = code) => {
    if (pin.length !== 4) return
    if (pin !== mpin) {
      setError('MPINs do not match. Enter the same 4 digits again.')
      setCode('')
      return
    }
    setBusy(true)
    try {
      await auth.setMpin('customer', form.values.mobile, pin, token)
      queueWelcome(form.values.name.split(' ')[0] ?? '', 'Your account is ready — you are signed in')
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'expired') {
        await sendOtp()
        go('otp')
        setError('Your verification expired. We sent a new OTP — enter it to finish.')
      } else {
        // go() clears the error, so show it after the step change.
        go('mpin')
        setError(errorMessage(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const keypad = (len: number, done: (v: string) => void) => (
    <Keypad
      className="keypad-slim mt-3 sm:hidden"
      onDigit={(d) => {
        if (code.length >= len) return
        const v = code + d
        setCode(v)
        if (v.length === len) void done(v)
      }}
      onBackspace={() => setCode((c) => c.slice(0, -1))}
    />
  )

  const stage = step === 'details' ? sub : step === 'otp' ? 4 : 5
  const part = PARTS[sub]!

  return (
    <AuthLayout>
      <div key={`${who}:${step}:${sub}`} className="fit-16 animate-unfold origin-top">
        {/* 1. Who is creating the account */}
        {!who && (
          <div data-auth-step="identify">
            <div className="mb-4 [@media(max-height:760px)]:mb-3">
              <div className="mb-2 inline-flex items-center gap-2 kicker text-masthead">
                <span className="size-2 bg-brand-gradient" /> New account
              </div>
              <h2 className="font-serif text-[28px] font-semibold leading-tight text-primary sm:text-[32px]">Create an account</h2>
              <p className="mt-1 text-[14px] text-muted-foreground">Choose who is signing up.</p>
            </div>
            <div role="radiogroup" aria-label="Who is creating the account?" className="space-y-2.5 [@media(max-height:760px)]:space-y-2">
              {TYPES.map((t, i) => (
                <TypeTile key={t.id} {...t} index={i} onPick={() => setWho(t.id)} />
              ))}
            </div>
            <p className="mt-4 text-center text-[14px] text-muted-foreground [@media(max-height:760px)]:mt-3">
              Already registered?{' '}
              <Link to="/login" className="font-bold text-masthead hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        )}

        {/* 2. Customer: details parts, then OTP, MPIN, confirm */}
        {who === 'customer' && step === 'details' && (
          <form onSubmit={submitDetails} noValidate data-auth-step="customer">
            <Progress stage={stage} />
            <div className="slim">
              <CustomerFormFields form={form} staff={false} showAgent={false} only={part} />
            </div>
            <div className="mt-4 flex gap-2.5 [@media(max-height:760px)]:mt-3">
              <Button type="button" variant="outline" size="lg" onClick={() => (sub > 0 ? setSub((s) => s - 1) : setWho(''))}>
                <ArrowLeft /> Back
              </Button>
              <Button type="submit" size="lg" className="flex-1" loading={busy}>
                {lastPart ? 'Verify mobile' : 'Next'} <ArrowRight />
              </Button>
            </div>
          </form>
        )}

        {who === 'customer' && step === 'otp' && (
          <div data-auth-step="otp">
            <Progress stage={stage} />
            {!registered && <BackLink onClick={() => go('details')} label="Edit details" />}
            <StepHeader icon={MessageSquareText} title="Verify your number" text={`Enter the 6-digit code sent to +91 ${form.values.mobile}.`} />
            <DemoNote className="mb-4 [@media(max-height:760px)]:mb-3">
              Simulated OTP: <b className="tabular tracking-widest">{demoOtp}</b>
              <button
                className="ml-2 font-bold underline"
                onClick={() => {
                  setCode(demoOtp)
                  void verify(demoOtp)
                }}
              >
                Autofill
              </button>
            </DemoNote>
            <PinInput keypad length={6} value={code} onChange={setCode} onComplete={verify} autoFocus invalid={!!error} label="OTP" />
            {error && <p className="mt-3 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
            {keypad(6, verify)}
            <Button size="xl" className="mt-4 w-full max-sm:h-12 [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>
              Verify & create account
            </Button>
            <div className="mt-3 text-center text-[14px]">
              {cooldown > 0 ? <span className="text-muted-foreground">Resend OTP in {cooldown}s</span> : <button className="font-semibold text-masthead" onClick={() => void sendOtp()}>Resend OTP</button>}
            </div>
          </div>
        )}

        {who === 'customer' && step === 'mpin' && (
          <div data-auth-step="mpin">
            <Progress stage={stage} />
            <StepHeader icon={ShieldCheck} title="Create a 4-digit MPIN" text="You'll use this to sign in from now on." />
            <PinInput keypad length={4} value={code} onChange={setCode} onComplete={(v) => { setMpin(v); go('confirm') }} masked autoFocus invalid={!!error} label="MPIN" />
            {error && <p className="mt-3 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
            {keypad(4, (v) => { setMpin(v); go('confirm') })}
            <Button size="xl" className="mt-4 w-full max-sm:h-12 [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" disabled={code.length !== 4} onClick={() => { setMpin(code); go('confirm') }}>
              Continue <ArrowRight />
            </Button>
          </div>
        )}

        {who === 'customer' && step === 'confirm' && (
          <div data-auth-step="confirm">
            <Progress stage={stage} />
            <BackLink onClick={() => go('mpin')} />
            <StepHeader icon={KeyRound} title="Confirm MPIN" text="Enter the same 4 digits again." />
            <PinInput keypad length={4} value={code} onChange={setCode} onComplete={finish} masked autoFocus invalid={!!error} label="Confirm MPIN" />
            {error && <p className="mt-3 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
            {keypad(4, finish)}
            <Button size="xl" className="mt-4 w-full max-sm:h-12 [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" loading={busy} disabled={code.length !== 4} onClick={() => void finish()}>
              Finish
            </Button>
          </div>
        )}

        {who === 'agent' && <AgencyRegistration onBack={() => setWho('')} />}
        {who === 'executive' && <ExecutiveInfo onBack={() => setWho('')} />}
      </div>
    </AuthLayout>
  )
}

/** One account-type choice: gradient chip, title, line of help, tag and an arrow that slides on hover. */
function TypeTile({ id, icon: Icon, title, text, tag, index, onPick }: { id: string; icon: LucideIcon; title: string; text: string; tag: string; index: number; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={false}
      data-type={id}
      onClick={onPick}
      style={{ animationDelay: `${120 + index * 90}ms` }}
      className="group animate-card3d relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl border border-border bg-card/70 p-3 text-left shadow-card transition-[transform,box-shadow,border-color] duration-300 hover:-translate-y-0.5 hover:border-masthead/50 hover:shadow-press focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/20 active:scale-[0.985] [@media(max-height:760px)]:p-2.5"
    >
      <span className="absolute inset-y-0 left-0 w-1 origin-center scale-y-0 bg-brand-gradient transition-transform duration-300 group-hover:scale-y-100" />
      <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-[0_10px_22px_-10px_var(--glow)] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3 [@media(max-height:760px)]:size-10">
        <span className="absolute inset-x-1 top-0.5 h-1/2 rounded-t-lg bg-gradient-to-b from-white/30 to-transparent" />
        <Icon className="relative size-6 [@media(max-height:760px)]:size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px] font-bold leading-tight text-foreground">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground [@media(max-height:700px)]:hidden">{text}</span>
        <span className="kicker mt-1.5 inline-block rounded-full bg-accent px-2 py-0.5 text-[9.5px] text-masthead">{tag}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-[transform,color] duration-300 group-hover:translate-x-1 group-hover:text-masthead" />
    </button>
  )
}

/** Top row on every sign-up screen: which kind of account, and a way to change it. */
function TypeBar({ icon: Icon, label, onChange }: { icon: LucideIcon; label: string; onChange?: () => void }) {
  return (
    <div className="mb-2.5 flex items-center justify-between [@media(max-height:760px)]:mb-2">
      <span className="inline-flex items-center gap-2 kicker text-masthead">
        <span className="grid size-6 place-items-center rounded-md bg-brand-gradient text-white">
          <Icon className="size-3.5" />
        </span>
        {label}
      </span>
      {onChange && (
        <button type="button" onClick={onChange} className="text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          Change type
        </button>
      )}
    </div>
  )
}

/** Six thin bars for the whole customer sign-up: four detail screens, verify, MPIN. */
function Progress({ stage }: { stage: number }) {
  return (
    <div className="mb-3" role="progressbar" aria-valuemin={1} aria-valuemax={STAGES.length} aria-valuenow={stage + 1} aria-label={`Step ${stage + 1} of ${STAGES.length}: ${STAGES[stage]}`}>
      <div className="flex gap-1.5">
        {STAGES.map((s, i) => (
          <span key={s} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span className={cn('absolute inset-0 origin-left rounded-full bg-brand-gradient transition-transform duration-500 ease-out', i <= stage ? 'scale-x-100' : 'scale-x-0')} />
          </span>
        ))}
      </div>
      <div className="kicker mt-1.5 flex justify-between text-muted-foreground">
        <span>{STAGES[stage]}</span>
        <span className="tabular">
          {stage + 1} / {STAGES.length}
        </span>
      </div>
    </div>
  )
}

/** Agency sign-up: goes to the administrator's Account Verification list, no account exists until it is accepted. */
function AgencyRegistration({ onBack }: { onBack: () => void }) {
  const form = useForm(
    { agencyName: '', ownerName: '', mobile: '', email: '', state: '', district: '', city: '' },
    (v) => ({
      agencyName: rules.required(v.agencyName, 'Agency name') ?? (v.agencyName.trim().length < 3 ? 'Enter the full agency name.' : undefined),
      ownerName: rules.required(v.ownerName, 'Owner name') ?? (v.ownerName.trim().length < 3 ? 'Enter the full name.' : undefined),
      mobile: rules.mobile(v.mobile),
      email: rules.required(v.email, 'Email') ?? rules.email(v.email),
      state: rules.required(v.state, 'State'),
      district: rules.required(v.district, 'District'),
      city: rules.required(v.city, 'City'),
    }),
  )
  const { values: v, set, errors } = form
  const [busy, setBusy] = React.useState(false)
  const [sent, setSent] = React.useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.check()) {
      toast.error('Please fix the highlighted fields.')
      return
    }
    setBusy(true)
    try {
      const r = await accountRequests.submit({ agencyName: v.agencyName, ownerName: v.ownerName, mobile: v.mobile, email: v.email, location: ['India', v.state, v.district, v.city].map((x) => x.trim()).join(' / ') })
      setSent(r.accountNo)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <div className="text-center" data-auth-step="agent-sent">
        <span className="animate-pop relative mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-success text-white shadow-[0_12px_28px_-12px_var(--glow)]">
          <CheckCircle2 className="size-8" />
        </span>
        <h2 className="font-serif text-[26px] font-semibold text-primary">Request sent</h2>
        <p className="mt-2 text-[14.5px] text-muted-foreground">
          Your registration number is <b className="font-mono text-foreground">{sent}</b>. The administrator will verify your agency and call you. After approval, sign in with +91 {v.mobile} and create your MPIN with an OTP.
        </p>
        <Button size="lg" className="mt-6 w-full" asChild>
          <Link to="/login">
            Back to sign in <ArrowRight />
          </Link>
        </Button>
      </div>
    )

  return (
    <form onSubmit={submit} noValidate data-auth-step="agent">
      <TypeBar icon={Store} label="Agency sign-up" onChange={onBack} />
      <div className="mb-4 [@media(max-height:760px)]:mb-3">
        <h2 className="font-serif text-[26px] font-semibold leading-tight text-primary [@media(max-height:760px)]:text-[22px]">Register your agency</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">The NewsRound administrator verifies your details, then opens your account.</p>
      </div>
      <div className="slim grid grid-cols-2 content-start gap-x-3 gap-y-3">
        <Field label="Agency name" required htmlFor="agencyName" error={errors.agencyName} className="col-span-2">
          <Input id="agencyName" value={v.agencyName} onChange={(e) => set('agencyName', e.target.value)} aria-invalid={!!errors.agencyName} autoComplete="organization" />
        </Field>
        <Field label="Owner name" required htmlFor="ownerName" error={errors.ownerName} className="col-span-2">
          <Input id="ownerName" value={v.ownerName} onChange={(e) => set('ownerName', e.target.value)} aria-invalid={!!errors.ownerName} autoComplete="name" />
        </Field>
        <Field label="Mobile number" required htmlFor="agMobile" error={errors.mobile} className="col-span-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-muted-foreground">+91</span>
            <Input id="agMobile" value={v.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="tel-national" placeholder="98470 12345" className="pl-12 tracking-wide" aria-invalid={!!errors.mobile} />
          </div>
        </Field>
        <Field label="Email" required htmlFor="agEmail" error={errors.email} className="col-span-2">
          <Input id="agEmail" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} autoComplete="email" />
        </Field>
        <Field label="State" required htmlFor="agState" error={errors.state}>
          <Input id="agState" value={v.state} onChange={(e) => set('state', e.target.value)} aria-invalid={!!errors.state} placeholder="Kerala" />
        </Field>
        <Field label="District" required htmlFor="agDistrict" error={errors.district}>
          <Input id="agDistrict" value={v.district} onChange={(e) => set('district', e.target.value)} aria-invalid={!!errors.district} />
        </Field>
        <Field label="City" required htmlFor="agCity" error={errors.city} className="col-span-2">
          <Input id="agCity" value={v.city} onChange={(e) => set('city', e.target.value)} aria-invalid={!!errors.city} />
        </Field>
      </div>
      <div className="mt-5 flex gap-2.5 [@media(max-height:760px)]:mt-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button type="submit" size="lg" className="flex-1" loading={busy}>
          Send for verification <ArrowRight />
        </Button>
      </div>
    </form>
  )
}

/** Delivery executives cannot self-register: their agency adds them and gives a username and password. */
function ExecutiveInfo({ onBack }: { onBack: () => void }) {
  const steps = [
    ['Ask your agency', 'Your agency owner adds you under Master, Delivery Boys with your name, mobile, username and password.'],
    ['Get your login', 'The agent tells you the agency code, your username and your password.'],
    ['Sign in', 'On the sign-in page choose "Sign in with username" and enter them.'],
  ]
  return (
    <div data-auth-step="executive">
      <TypeBar icon={Bike} label="Delivery executive" onChange={onBack} />
      <div className="mb-4 [@media(max-height:760px)]:mb-3">
        <h2 className="font-serif text-[26px] font-semibold leading-tight text-primary [@media(max-height:760px)]:text-[22px]">Get your delivery login</h2>
        <p className="mt-1 text-[14px] text-muted-foreground">Your distribution agency creates delivery executive accounts.</p>
      </div>
      <ol className="relative space-y-4 [@media(max-height:760px)]:space-y-3">
        <span aria-hidden className="absolute bottom-4 left-4 top-4 w-px bg-border" />
        {steps.map(([t, d], i) => (
          <li key={t} style={{ animationDelay: `${150 + i * 110}ms` }} className="animate-rise relative flex gap-3.5">
            <span className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-[13px] font-bold text-white shadow-[0_8px_18px_-8px_var(--glow)]">{i + 1}</span>
            <div>
              <div className="font-bold text-foreground">{t}</div>
              <p className="text-[13.5px] leading-snug text-muted-foreground">{d}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex gap-2.5 [@media(max-height:760px)]:mt-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button size="lg" className="flex-1" asChild>
          <Link to="/login?staff=1">
            <KeyRound /> Username sign-in
          </Link>
        </Button>
      </div>
    </div>
  )
}

function BackLink({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground hover:text-foreground [@media(max-height:760px)]:mb-2">
      <ArrowLeft className="size-4" /> {label}
    </button>
  )
}

function StepHeader({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="mb-5 text-center [@media(max-height:760px)]:mb-3">
      <span className="animate-pop relative mx-auto mb-3 grid size-16 place-items-center rounded-2xl bg-brand-gradient text-white shadow-[0_12px_28px_-12px_var(--glow)] [@media(max-height:860px)]:hidden">
        <span className="absolute inset-x-1.5 top-1 h-1/2 rounded-t-xl bg-gradient-to-b from-white/30 to-transparent" />
        <Icon className="relative size-7" />
      </span>
      <h2 className="font-serif text-[26px] font-semibold text-primary [@media(max-height:760px)]:text-[22px]">{title}</h2>
      <p className="mt-1 text-[14.5px] text-muted-foreground">{text}</p>
    </div>
  )
}
