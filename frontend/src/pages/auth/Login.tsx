import { ArrowLeft, ArrowRight, KeyRound, MessageSquareText, ShieldCheck, Smartphone, UsersRound } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { queueWelcome } from '@/components/fx/Appearance'
import { Keypad, PinInput } from '@/components/PinInput'
import { Button } from '@/components/ui/button'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { DemoNote } from '@/components/ui/misc'
import { ROLE_LABEL, type Role } from '@/domain/types'
import { errorMessage, useData } from '@/hooks/app'
import { isIndianMobile } from '@/lib/utils'
import { ApiError, auth } from '@/services/api'
import { AuthLayout } from './AuthLayout'

type Step = 'identify' | 'mpin' | 'otp' | 'create' | 'confirm'
type Purpose = 'first' | 'reset'

/** Wizard progress kept for this tab (never the PIN itself), so a reload resumes where the user was. */
const FLOW_KEY = 'nap.login'
interface Flow {
  step: Step
  purpose: Purpose
  role: Role | ''
  mobile: string
  name: string
  otpToken: string
  demoOtp: string
}
function loadFlow(): Partial<Flow> {
  try {
    const f = JSON.parse(sessionStorage.getItem(FLOW_KEY) ?? '{}') as Partial<Flow>
    // The first MPIN entry is only held in memory, so a reload on "confirm" restarts at "create".
    return f.step === 'confirm' ? { ...f, step: 'create' } : f
  } catch {
    return {}
  }
}
const clearFlow = () => {
  try {
    sessionStorage.removeItem(FLOW_KEY)
  } catch {
    /* ignore */
  }
}
const hour = new Date().getHours()
const GREETING = hour < 12 ? 'Good morning.' : hour < 17 ? 'Good afternoon.' : 'Good evening.'

const ROLES: Role[] = ['admin', 'agent', 'executive', 'customer']
const AGENCY_KEY = 'nap.agency'

export default function Login() {
  const navigate = useNavigate()
  const db = useData()
  const [saved] = React.useState(loadFlow)
  const [step, setStep] = React.useState<Step>(saved.step ?? 'identify')
  const [purpose, setPurpose] = React.useState<Purpose>(saved.purpose ?? 'first')
  const [role, setRole] = React.useState<Role | ''>(saved.role ?? '')
  const [mobile, setMobile] = React.useState(saved.mobile ?? '')
  const [name, setName] = React.useState(saved.name ?? '')
  const [code, setCode] = React.useState('')
  const [mpin, setMpin] = React.useState('')
  const [otpToken, setOtpToken] = React.useState(saved.otpToken ?? '')
  const [demoOtp, setDemoOtp] = React.useState(saved.demoOtp ?? '')
  const [cooldown, setCooldown] = React.useState(0)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // Staff users and delivery boys sign in with agency code + username + password instead of mobile + MPIN.
  // The Create Account page links here with ?staff=1 for delivery executives.
  const [staffMode, setStaffMode] = React.useState(() => new URLSearchParams(window.location.search).get('staff') === '1')
  const [agency, setAgency] = React.useState(() => {
    try {
      return localStorage.getItem(AGENCY_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

  const onStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!agency.trim() || !username.trim() || !password) return setError('Enter the agency code, your username and your password.')
    setBusy(true)
    try {
      const r = await auth.loginWithPassword(agency, username, password)
      try {
        localStorage.setItem(AGENCY_KEY, agency.trim())
      } catch {
        /* ignore */
      }
      clearFlow()
      queueWelcome(r.name.split(' ')[0] || 'back', `Signed in as ${r.kind} · ${r.agencyName}`)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => {
    try {
      if (step === 'identify') sessionStorage.removeItem(FLOW_KEY)
      else sessionStorage.setItem(FLOW_KEY, JSON.stringify({ step, purpose, role, mobile, name, otpToken, demoOtp } satisfies Flow))
    } catch {
      /* ignore */
    }
  }, [step, purpose, role, mobile, name, otpToken, demoOtp])

  /** Session is set by the API call; land on the user's own home screen with a welcome. */
  const enter = (text: string) => {
    clearFlow()
    queueWelcome(name.split(' ')[0] || 'back', text)
    navigate('/', { replace: true })
  }

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
    const r = await auth.requestOtp(role as Role, mobile)
    setDemoOtp(r.demoOtp)
    setCooldown(r.cooldown)
    if (!r.reused) toast.message(`Demo SMS → +91 ${mobile}`, { description: `Your NewsRound OTP is ${r.demoOtp}` })
  }

  const onContinue = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!role) return setError('Please select your account type first.')
    if (!isIndianMobile(mobile)) return setError('Enter your 10-digit mobile number (starts with 6, 7, 8 or 9).')
    setBusy(true)
    try {
      const r = await auth.lookup(role, mobile)
      setName(r.name)
      if (r.hasMpin) go('mpin')
      else {
        setPurpose('first')
        await sendOtp()
        go('otp')
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (otp = code) => {
    if (otp.length !== 6) return
    setBusy(true)
    setError('')
    try {
      const r = await auth.verifyOtp(role as Role, mobile, otp)
      setOtpToken(r.otpToken)
      go('create')
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const loginMpin = async (pin = code) => {
    if (pin.length !== 4) return
    setBusy(true)
    setError('')
    try {
      await auth.loginWithMpin(role as Role, mobile, pin)
      enter(`Signed in as ${ROLE_LABEL[role as Role]}`)
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const confirmMpin = async (pin = code) => {
    if (pin.length !== 4) return
    if (pin !== mpin) {
      setError('MPINs do not match. Please enter the same 4 digits again.')
      setCode('')
      return
    }
    setBusy(true)
    try {
      await auth.setMpin(role as Role, mobile, pin, otpToken)
      enter(purpose === 'reset' ? 'MPIN reset — you are signed in' : 'Your MPIN is set — you are signed in')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'expired') {
        // Verification lapsed (e.g. the app sat idle): send a fresh code instead of a dead end.
        await sendOtp()
        go('otp')
        setError('Your verification expired. We sent a new OTP — enter it to finish setting your MPIN.')
      } else {
        setError(errorMessage(err))
        go('create')
      }
    } finally {
      setBusy(false)
    }
  }

  const forgot = async () => {
    setPurpose('reset')
    setBusy(true)
    try {
      await sendOtp()
      go('otp')
    } finally {
      setBusy(false)
    }
  }

  const keypad = (len: number, done: (v: string) => void) => (
    <Keypad
      className="mt-6 sm:hidden [@media(max-height:760px)]:mt-3"
      onDigit={(d) => {
        if (code.length >= len) return
        const v = code + d
        setCode(v)
        if (v.length === len) void done(v)
      }}
      onBackspace={() => setCode((c) => c.slice(0, -1))}
    />
  )

  // Sample accounts (demo mode only — the live server sends them only when OTP_DEMO_MODE is on).
  const demo = (
    [
      ['admin', db.admins[0]],
      ['agent', db.agents[0]],
      ['executive', db.executives[0]],
      ['customer', db.customers[0]],
    ] as const
  ).flatMap(([role, u]) => (u ? [{ role: role as Role, name: u.name, mobile: u.mobile }] : []))

  return (
    <AuthLayout>
      <div key={step} className="animate-unfold origin-top">
          {step === 'identify' && staffMode && (
            <form onSubmit={onStaffSubmit} noValidate data-auth-step="staff">
              <BackLink onClick={() => { setStaffMode(false); setError(''); setPassword('') }} />
              <StepHeader icon={UsersRound} title="Staff sign-in" text="For staff users and delivery boys created by an agency." />
              <div className="space-y-4 [@media(max-height:760px)]:space-y-3">
                <Field label="Agency code or mobile" required htmlFor="agency">
                  <Input id="agency" value={agency} onChange={(e) => setAgency(e.target.value)} autoComplete="organization" autoCapitalize="characters" placeholder="AG-01" className="h-12 text-base" aria-invalid={!!error} />
                </Field>
                <Field label="Username" required htmlFor="username">
                  <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" className="h-12 text-base" aria-invalid={!!error} />
                </Field>
                <Field label="Password" required htmlFor="password">
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="h-12 text-base" aria-invalid={!!error} />
                </Field>
                {error && <p className="rounded-lg bg-destructive/8 px-3 py-2.5 text-[13.5px] font-medium text-destructive" role="alert">{error}</p>}
                <Button type="submit" size="lg" className="w-full" loading={busy}>
                  Sign in <ArrowRight />
                </Button>
              </div>
              <p className="mt-4 text-center text-[12.5px] text-muted-foreground">Forgot your password? Ask the agency owner to set a new one in Settings › User.</p>
            </form>
          )}

          {step === 'identify' && !staffMode && (
            <form onSubmit={onContinue} noValidate data-auth-step="identify">
              <div className="mb-5 [@media(max-height:760px)]:mb-3">
                <div className="mb-2 inline-flex items-center gap-2 kicker text-masthead">
                  <span className="size-2 bg-brand-gradient" /> Sign in
                </div>
                <h2 className="font-serif text-[28px] font-semibold leading-tight text-primary sm:text-[32px]">{GREETING}</h2>
                <p className="mt-1 text-[14px] text-muted-foreground">Pick your account type, then enter your mobile number.</p>
              </div>
              <div className="space-y-4 [@media(max-height:760px)]:space-y-3">
                <Field label="Account type" required htmlFor="role">
                  <NativeSelect id="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="h-12 text-base" aria-invalid={!!error && !role}>
                    <option value="" disabled>
                      Select Account Type
                    </option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Mobile number" required htmlFor="mobile">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-muted-foreground">+91</span>
                    <Input
                      id="mobile"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      inputMode="numeric"
                      autoComplete="tel-national"
                      placeholder="99999 99999"
                      className="h-12 pl-13 text-lg tracking-wide"
                      aria-invalid={!!error && !!role}
                    />
                  </div>
                </Field>
                {error && <p className="rounded-lg bg-destructive/8 px-3 py-2.5 text-[13.5px] font-medium text-destructive">{error}</p>}
                <Button type="submit" size="lg" className="w-full" loading={busy}>
                  Continue <ArrowRight />
                </Button>
              </div>
              <p className="mt-4 text-center text-[14px] text-muted-foreground">
                New User?{' '}
                <Link to="/register" className="font-bold text-masthead hover:underline">
                  Create Account
                </Link>
              </p>
              <p className="mt-1 text-center text-[13px] text-muted-foreground">
                Staff user or delivery boy?{' '}
                <button type="button" onClick={() => { setStaffMode(true); setError('') }} className="font-bold text-masthead hover:underline">
                  Sign in with username
                </button>
              </p>

              {demo.length > 0 && <div className="mt-4 rounded-xl border border-dashed border-border p-3">
                <div className="mb-2 flex items-center gap-2 kicker text-muted-foreground">
                  <span className="rounded bg-brand-gradient px-1.5 py-px text-[10px] text-white">Demo</span> Sample accounts
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {demo.map((d) => (
                    <button
                      type="button"
                      key={d.role}
                      onClick={() => {
                        setRole(d.role)
                        setMobile(d.mobile)
                        setError('')
                      }}
                      className="min-w-0 rounded-lg border border-transparent bg-muted/60 px-2.5 py-1.5 text-left transition-[transform,background-color,border-color,box-shadow] duration-300 ease-out-expo hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--brand)_30%,transparent)] hover:bg-accent hover:shadow-card active:scale-[0.98]"
                    >
                      <div className="truncate text-[11px] font-semibold text-muted-foreground">{ROLE_LABEL[d.role]}</div>
                      <div className="truncate text-[12.5px] font-semibold" title={d.name}>
                        <span className="tabular">{d.mobile}</span> <span className="font-normal text-muted-foreground">· {d.name.split(' ')[0]}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <p className="mt-2 hidden text-[11.5px] text-muted-foreground sm:block [@media(max-height:760px)]:hidden">Tap one to fill the form. First sign-in uses a demo OTP, then a 4-digit MPIN.</p>
              </div>}
            </form>
          )}

          {step === 'mpin' && (
            <div>
              <BackLink onClick={() => go('identify')} />
              <StepHeader icon={KeyRound} title={`Hello, ${name.split(' ')[0]}`} text={`Enter your 4-digit MPIN for ${ROLE_LABEL[role as Role]} · +91 ${mobile}`} />
              <PinInput keypad length={4} value={code} onChange={setCode} onComplete={loginMpin} masked autoFocus invalid={!!error} label="MPIN" />
              {error && <p className="mt-4 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
              {keypad(4, loginMpin)}
              <Button size="xl" className="mt-6 w-full [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" loading={busy} disabled={code.length !== 4} onClick={() => void loginMpin()}>
                Sign in
              </Button>
              <button className="mt-4 w-full text-center text-[14px] font-semibold text-masthead hover:underline [@media(max-height:760px)]:mt-2" onClick={forgot} disabled={busy}>
                Forgot MPIN?
              </button>
            </div>
          )}

          {step === 'otp' && (
            <div>
              <BackLink onClick={() => go(purpose === 'reset' ? 'mpin' : 'identify')} />
              <StepHeader icon={MessageSquareText} title={purpose === 'reset' ? 'Reset your MPIN' : 'Verify your number'} text={`We sent a 6-digit code to +91 ${mobile}.`} />
              <DemoNote className="mb-5 [@media(max-height:760px)]:mb-3">
                OTP service is simulated. Your code is <b className="tabular tracking-widest">{demoOtp}</b>{' '}
                <button className="ml-1 font-bold underline" onClick={() => { setCode(demoOtp); void verify(demoOtp) }}>
                  Autofill
                </button>
              </DemoNote>
              <PinInput keypad length={6} value={code} onChange={setCode} onComplete={verify} autoFocus invalid={!!error} label="One-time password" />
              {error && <p className="mt-4 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
              {keypad(6, verify)}
              <Button size="xl" className="mt-6 w-full [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>
                Verify OTP
              </Button>
              <div className="mt-4 text-center text-[14px] [@media(max-height:760px)]:mt-2">
                {cooldown > 0 ? (
                  <span className="text-muted-foreground">Resend OTP in {cooldown}s</span>
                ) : (
                  <button className="font-semibold text-masthead hover:underline" onClick={() => void sendOtp()}>
                    Resend OTP
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'create' && (
            <div>
              <StepHeader icon={ShieldCheck} title="Create your MPIN" text="Choose 4 digits you will remember. You'll use this MPIN every time you sign in." />
              <PinInput keypad length={4} value={code} onChange={setCode} onComplete={(v) => { setMpin(v); go('confirm') }} masked autoFocus invalid={!!error} label="New MPIN" />
              {error && <p className="mt-4 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
              {keypad(4, (v) => { setMpin(v); go('confirm') })}
              <Button size="xl" className="mt-6 w-full [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" disabled={code.length !== 4} onClick={() => { setMpin(code); go('confirm') }}>
                Continue
              </Button>
            </div>
          )}

          {step === 'confirm' && (
            <div>
              <BackLink onClick={() => go('create')} />
              <StepHeader icon={Smartphone} title="Confirm MPIN" text="Enter the same 4 digits again." />
              <PinInput keypad length={4} value={code} onChange={setCode} onComplete={confirmMpin} masked autoFocus invalid={!!error} label="Confirm MPIN" />
              {error && <p className="mt-4 text-center text-[13.5px] font-medium text-destructive">{error}</p>}
              {keypad(4, confirmMpin)}
              <Button size="xl" className="mt-6 w-full [@media(max-height:760px)]:mt-3 [@media(max-height:760px)]:h-12" loading={busy} disabled={code.length !== 4} onClick={() => void confirmMpin()}>
                {purpose === 'reset' ? 'Reset MPIN & sign in' : 'Save MPIN & continue'}
              </Button>
            </div>
          )}
      </div>
    </AuthLayout>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-6 [@media(max-height:760px)]:mb-2 inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Back
    </button>
  )
}

function StepHeader({ icon: Icon, title, text }: { icon: React.ElementType; title: string; text: string }) {
  return (
    <div className="mb-7 text-center [@media(max-height:760px)]:mb-4">
      <span className="animate-pop relative mx-auto mb-4 [@media(max-height:760px)]:hidden grid size-16 place-items-center rounded-2xl bg-brand-gradient text-white shadow-[0_12px_28px_-12px_var(--glow)]">
        <span className="absolute inset-x-1.5 top-1 h-1/2 rounded-t-xl bg-gradient-to-b from-white/30 to-transparent" />
        <Icon className="relative size-7" />
      </span>
      <h2 className="font-serif text-[26px] font-semibold text-primary [@media(max-height:760px)]:text-[22px]">{title}</h2>
      <p className="mt-1 text-[14.5px] text-muted-foreground">{text}</p>
    </div>
  )
}
