import { Bike, FileText, HandCoins, IndianRupee, Newspaper, PackageCheck, Repeat, Route, Truck, type LucideIcon } from 'lucide-react'
import * as React from 'react'
import { useRichMotion } from '@/app/theme'
import { Logo } from '@/app/Shell'
import { Newsprint, ThemeMenu } from '@/components/fx/Appearance'
import { Paper3D } from '@/components/fx/Scene3D'
import { useData } from '@/hooks/app'
import { cn } from '@/lib/utils'

const FEATURES: [LucideIcon, string][] = [
  [Repeat, 'Subscriptions'],
  [Route, 'Routes'],
  [FileText, 'Billing'],
  [HandCoins, 'Collections'],
]
/** House position along the road, and when its paper is thrown (fractions of one 14s ride). */
const HOUSES: [number, number][] = [
  [0.12, 0.09],
  [0.3, 0.27],
  [0.48, 0.44],
  [0.66, 0.62],
  [0.84, 0.8],
]
/** Three houses for the small lane in the phone header. */
const MINI_HOUSES: [number, number][] = [
  [0.2, 0.1],
  [0.5, 0.32],
  [0.8, 0.54],
]
const CITIES = ['Thiruvananthapuram', 'Kollam', 'Kochi', 'Kottayam', 'Kozhikode']

/** Sample activity shown on the sign-in page: generic, no customer data. */
const FEED: [LucideIcon, string, string][] = [
  [Newspaper, 'Papers sorted', 'Bundles packed for the morning round'],
  [Truck, 'Out for delivery', 'Delivery boy left the stand'],
  [PackageCheck, 'Delivered', 'Left at the doorstep'],
  [Repeat, 'New subscription', 'Daily copy added to a route'],
  [IndianRupee, 'Bill settled', 'Receipt is ready'],
  [HandCoins, 'Cash collected', 'Entered at the counter'],
  [Route, 'Route complete', 'Every house on the round done'],
]
const FEED_MS = 3400

/**
 * Live activity ticker: a new line slides in every few seconds and pushes the older ones down.
 * One timer, one small state, transform-only motion; it stands still for reduced motion / lite effects.
 */
function LiveFeed({ rows, className, listClassName }: { rows: number; className?: string; listClassName?: string }) {
  const rich = useRichMotion()
  const [tick, setTick] = React.useState(rows)
  const [now, setNow] = React.useState(() => new Date())
  React.useEffect(() => {
    if (!rich) return
    const id = window.setInterval(() => {
      if (document.hidden) return
      setTick((t) => t + 1)
      setNow(new Date())
    }, FEED_MS)
    return () => window.clearInterval(id)
  }, [rich])
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  // rows + 1 lines are rendered; the list slides down one line per tick and the extra one is clipped.
  const lines = Array.from({ length: rows + 1 }, (_, k) => tick - k)
  return (
    <div aria-hidden className={cn('rounded-2xl bg-white/[0.09] p-3 ring-1 ring-inset ring-white/15', className)}>
      <div className="kicker mb-2 flex items-center justify-between text-white/70">
        <span className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-70" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
          </span>
          Live feed
        </span>
        <span className="tabular">{time}</span>
      </div>
      <div className={cn('feed-window overflow-hidden', listClassName)} style={{ ['--rows' as string]: rows }}>
        <div key={tick} className="feed-slide flex flex-col gap-2">
          {lines.map((n, k) => {
            const [Icon, title, sub] = FEED[((n % FEED.length) + FEED.length) % FEED.length]!
            return (
              <div key={n} style={{ opacity: k === 0 ? 1 : Math.max(0.35, 0.8 - k * 0.22) }} className="flex h-11 shrink-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-[#11142a] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)]">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold leading-tight">{title}</span>
                  <span className="block truncate text-[11.5px] text-white/65">{sub}</span>
                </span>
                <span className="kicker shrink-0 text-[10px] text-white/50">{k === 0 ? 'Now' : `${Math.round((k * FEED_MS) / 1000)}s`}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Floating glass notification: the outer node enters once, the inner one bobs forever (transform only). */
function LiveCard({ icon: Icon, title, sub, className, delay, bob }: { icon: LucideIcon; title: string; sub: string; className?: string; delay: number; bob: string }) {
  return (
    <div style={{ animationDelay: `${delay}ms` }} className={cn('animate-card3d absolute z-10', className)}>
      <div style={{ ['--d' as string]: bob, ['--delay' as string]: `-${delay}ms` }} className="float-card flex items-center gap-3 rounded-2xl bg-white/[0.13] py-2.5 pl-2.5 pr-4 ring-1 ring-inset ring-white/25 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)]">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-[#11142a] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.5)]">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block whitespace-nowrap text-[13px] font-bold leading-tight">{title}</span>
          <span className="block whitespace-nowrap text-[11.5px] text-white/65">{sub}</span>
        </span>
      </div>
    </div>
  )
}

/** Sign-in side panel: all motion is transform / opacity so it stays on the compositor. */
function LiveStage({ agency }: { agency: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute right-0 top-1/2 hidden aspect-square w-[300px] -translate-y-1/2 min-[1640px]:block min-[1900px]:w-[400px]">
      {[0, -2.4, -4.8].map((d) => (
        <span key={d} className="pulse-ring" style={{ ['--delay' as string]: `${d}s` }} />
      ))}
      <div className="absolute inset-0 grid place-items-center">
        <Paper3D size={250} masthead={agency} className="origin-center scale-[0.9] min-[1900px]:scale-[1.12] [@media(max-height:760px)]:hidden" />
        <span className="float-card hidden size-24 place-items-center rounded-3xl bg-white/15 font-display text-[52px] font-extrabold ring-1 ring-inset ring-white/30 [@media(max-height:760px)]:grid">N</span>
      </div>
      <LiveCard icon={Truck} title="Out for delivery" sub="Morning round is live" delay={450} bob="7s" className="left-0 top-[4%]" />
      <LiveCard icon={PackageCheck} title="Delivered" sub="Left at the doorstep" delay={700} bob="8s" className="right-0 top-[40%]" />
      <LiveCard icon={IndianRupee} title="Bill settled" sub="Receipt is ready" delay={950} bob="6.5s" className="left-2 bottom-[2%]" />
    </div>
  )
}

/** A paper boy cycles past the houses and tosses a rolled paper to each door; the house lights up when it lands. */
function Lane({ className, houses = HOUSES }: { className?: string; houses?: [number, number][] }) {
  return (
    <div aria-hidden className={cn('lane relative h-14 shrink-0 overflow-hidden', className)}>
      <div className="absolute inset-x-0 bottom-[10px] border-t-2 border-dashed border-white/25" />
      {houses.map(([x, t]) => (
        <React.Fragment key={x}>
          <span className="lane-house absolute bottom-[18px] text-white" style={{ left: `${x * 100}%`, ['--delay' as string]: `${(t + 0.08) * 14}s` }}>
            <svg viewBox="0 0 24 24" className="size-5 -translate-x-1/2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5.5 10v9.5h13V10" />
              <path d="M10 19.5v-5h4v5" />
            </svg>
          </span>
          <span className="lane-paper absolute bottom-[24px] h-[6px] w-[11px] rounded-[2px] bg-white" style={{ left: `${x * 100}%`, ['--delay' as string]: `${t * 14}s` }} />
        </React.Fragment>
      ))}
      <div className="lane-truck absolute bottom-[6px] left-0">
        <span className="lane-pedal grid size-9 place-items-center rounded-xl bg-white text-[#11142a] shadow-[0_10px_22px_-8px_rgba(0,0,0,0.6)]">
          <Bike className="size-[20px]" strokeWidth={2} />
        </span>
      </div>
    </div>
  )
}

/**
 * Sign-in front page, always exactly one screen tall: the page itself never scrolls.
 * Sections shrink with the viewport height; on very small phones only the form card scrolls internally.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const db = useData()
  const date = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const line = 'block animate-rise'
  return (
    <div className="auth-root relative grid h-dvh overflow-hidden lg:grid-cols-[1.15fr_minmax(0,1fr)]">
      <Newsprint />
      {/* Phone / tablet: the whole screen is the live gradient, the sign-in card floats on it. */}
      <div aria-hidden className="grad-deep absolute inset-0 lg:hidden">
        <div className="live-dots" />
      </div>
      <aside className="grad-deep relative hidden min-h-0 flex-col gap-4 overflow-hidden px-10 py-7 text-white lg:flex xl:px-14 [@media(max-height:760px)]:gap-2 [@media(max-height:760px)]:py-5">
        <div className="live-dots" />

        <div className="flex shrink-0 items-center justify-between">
          <Logo light />
          <span className="kicker rounded-full bg-white/10 px-3 py-1 text-white/75 ring-1 ring-inset ring-white/15">{date}</span>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center">
          <LiveStage agency={db.settings.agencyName} />
          <div className="relative z-10 max-w-[28rem]">
            <div className="kicker mb-5 inline-flex animate-rise items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-white/85 ring-1 ring-inset ring-white/15 [@media(max-height:760px)]:mb-3">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-300" />
              </span>
              Live for {db.settings.agencyName}
            </div>
            <h1 className="font-serif text-[46px] font-extrabold leading-[1.02] xl:text-[58px] [@media(max-height:760px)]:text-[38px]">
              <span className={line} style={{ animationDelay: '60ms' }}>Every paper,</span>
              <span className={cn(line, 'bg-[linear-gradient(100deg,#ffffff,color-mix(in_oklab,var(--brand-2)_35%,#ffffff))] bg-clip-text text-transparent')} style={{ animationDelay: '160ms' }}>
                every doorstep,
              </span>
              <span className={line} style={{ animationDelay: '260ms' }}>every rupee.</span>
            </h1>
            <p className="mt-5 max-w-md animate-rise text-[15.5px] leading-relaxed text-white/70 [animation-delay:340ms] [@media(max-height:760px)]:mt-3 [@media(max-height:700px)]:hidden">
              One place for every subscription, route, bill and collection, built for agents, delivery executives and readers.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 [@media(max-height:760px)]:hidden">
              {FEATURES.map(([Icon, label], i) => (
                <span
                  key={label}
                  style={{ animationDelay: `${430 + i * 70}ms` }}
                  className="animate-rise inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white/90 ring-1 ring-inset ring-white/15 transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-white/20"
                >
                  <Icon className="size-3.5" /> {label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <Lane className="[@media(max-height:700px)]:hidden" />

        {/* Three lines on tall screens, one when the height is tight. */}
        <LiveFeed rows={3} className="shrink-0 animate-card3d" listClassName="h-[148px] [@media(max-height:760px)]:h-11" />

        <div className="ticker shrink-0 overflow-hidden pt-1 text-white/50" style={{ ['--ticker-duration' as string]: '34s' }}>
          <div className="ticker-track kicker">
            {[0, 1].map((k) => (
              <div key={k} aria-hidden={k === 1 || undefined} className="flex shrink-0 items-center">
                {CITIES.map((c) => (
                  <span key={c} className="flex items-center">
                    <span className="px-4">{c}</span>
                    <span className="size-1 rounded-full bg-white/40" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="relative flex h-dvh min-h-0 min-w-0 flex-col">
        {/* Phone / tablet: compact masthead bar */}
        <div className="relative shrink-0 text-white lg:hidden [&_button]:text-white [&_button:hover]:bg-white/10">
          <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))]">
            <Logo light />
            {/* Small live lane between the logo and the toggles: costs no height, so it stays on every step. */}
            <div aria-hidden className="relative mx-2 hidden h-[34px] min-w-0 flex-1 overflow-hidden min-[360px]:block [@media(max-height:520px)]:!hidden">
              <Lane houses={MINI_HOUSES} className="absolute left-0 top-0 w-[150px] origin-top-left scale-[0.62]" />
            </div>
            <div className="flex items-center">
              <ThemeMenu />
            </div>
          </div>
          {/* Tall phones and tablets have room for the 3D paper. */}
          <div className="pointer-events-none hidden justify-center pb-3 [@media(min-height:1100px)]:flex">
            <Paper3D size={190} masthead={db.settings.agencyName} />
          </div>
        </div>
        <div className="absolute right-5 top-5 z-10 hidden items-center gap-1 lg:flex">
          <ThemeMenu />
        </div>
        {/* lg: top padding keeps a tall card clear of the light/dark and colour buttons in the corner. */}
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:pt-16 [@media(max-height:760px)]:py-2 [@media(max-height:760px)]:lg:pt-14">
          <div className="glass-card scrollbar-thin relative z-10 max-h-full w-full max-w-[460px] animate-drop3d overflow-y-auto overscroll-contain rounded-2xl border p-5 shadow-pop sm:p-7 [@media(max-height:760px)]:!p-4">{children}</div>
        </div>
        <div className="mx-auto w-full max-w-[460px] shrink-0 px-4 text-white sm:px-6 lg:hidden">
          <LiveFeed rows={1} className="auth-foot-feed mb-1 py-2" listClassName="h-11" />
          <Lane className="auth-foot-lane mb-[max(0.5rem,env(safe-area-inset-bottom))]" />
        </div>
      </section>
    </div>
  )
}
