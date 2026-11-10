import * as React from 'react'
import { useData } from '@/hooks/app'
import { cn } from '@/lib/utils'
import { Paper3D } from './Scene3D'

export interface TickerItem {
  label: string
  value: React.ReactNode
  tone?: 'good' | 'bad' | 'warn'
}

/** Scrolling news-wire strip. The track is rendered twice so the loop is seamless. */
export function Ticker({ items, className }: { items: TickerItem[]; className?: string }) {
  if (!items.length) return null
  const run = (hidden?: boolean) => (
    <ul className="flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-2 whitespace-nowrap px-5 text-[13px]">
          <span className="kicker text-muted-foreground">{it.label}</span>
          <span className={cn('tabular font-semibold', it.tone === 'good' && 'text-success', it.tone === 'bad' && 'text-destructive', it.tone === 'warn' && 'text-warning')}>{it.value}</span>
          <span aria-hidden className="ml-3 size-1.5 rounded-full bg-brand-gradient" />
        </li>
      ))}
    </ul>
  )
  return (
    <div className={cn('flex items-stretch overflow-hidden rounded-full bg-white/50 p-1 ring-1 ring-inset ring-[var(--glass-border)] dark:bg-white/[0.04]', className)}>
      <span className="kicker flex shrink-0 items-center gap-1.5 rounded-full bg-brand-gradient px-3 text-white shadow-[0_6px_16px_-8px_var(--glow)]">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-white" />
        </span>
        Live
      </span>
      <div className="ticker min-w-0 flex-1 py-1.5" tabIndex={0} aria-label="Today at a glance">
        <div className="ticker-track" style={{ ['--ticker-duration' as string]: `${Math.max(24, items.length * 6)}s` }}>
          {run()}
          {run(true)}
        </div>
      </div>
    </div>
  )
}

/** Dashboard hero: gradient-washed glass card with chips, a big headline, a live ticker and a turning 3D paper. */
export function DashboardHero({
  kicker,
  title,
  description,
  actions,
  children,
  ticker,
  className,
}: {
  kicker?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  ticker?: TickerItem[]
  className?: string
}) {
  const db = useData()
  const now = new Date()
  const date = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const short = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return (
    <section className={cn('hero-mesh mb-6 animate-rise rounded-3xl p-5 sm:p-7', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="kicker inline-flex min-w-0 items-center gap-2 rounded-full bg-brand-gradient px-3 py-1 text-white shadow-[0_6px_16px_-8px_var(--glow)]">
          <span className="truncate">{kicker}</span>
        </span>
        <span className="kicker rounded-full bg-white/60 px-3 py-1 text-muted-foreground ring-1 ring-inset ring-[var(--glass-border)] dark:bg-white/[0.06]">
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{date}</span>
        </span>
      </div>
      <div className="grid grid-cols-1 items-center gap-4 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-8">
        <div className="min-w-0">
          <h1 className="animate-ink font-serif text-[34px] font-extrabold leading-[1.02] text-primary sm:text-[46px] lg:text-[56px]">{title}</h1>
          {description && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p>}
          {children && <div className="mt-4">{children}</div>}
          {actions && <div className="mt-5 flex flex-wrap gap-2 [&_a]:min-w-0">{actions}</div>}
        </div>
        <div className="scroll-tip -my-8 hidden md:block">
          <Paper3D size={250} masthead={db.settings.agencyName} />
        </div>
      </div>
      {ticker && <Ticker items={ticker} className="mt-5" />}
    </section>
  )
}
