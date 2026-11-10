import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { Tabs as T } from 'radix-ui'
import * as React from 'react'
import { RollNumber } from '@/components/fx/RollNumber'
import { cn, formatINR, initials } from '@/lib/utils'
import { Button } from './button'

// ---------------- Card ----------------
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('reveal3d glass-card rounded-2xl border', className)} {...props} />
}
export function CardHeader({ title, description, action, className, icon: Icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string; icon?: LucideIcon }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="press-line flex items-center gap-2.5 font-display text-[17px] font-semibold leading-tight tracking-[-0.015em] text-primary">
          {Icon && (
            <span className="chip-3d grid size-9 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white">
              <Icon className="idle-icon size-[15px]" />
            </span>
          )}
          {title}
        </h3>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
export const CardBody = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn('p-5', className)} {...p} />

// ---------------- Badge ----------------
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap ring-1 ring-inset', {
  variants: {
    tone: {
      neutral: 'bg-muted text-foreground/75 ring-border',
      navy: 'bg-primary/8 text-primary ring-primary/15',
      success: 'bg-success/10 text-success ring-success/20',
      warning: 'bg-warning/10 text-warning ring-warning/25',
      danger: 'bg-destructive/10 text-destructive ring-destructive/20',
      info: 'bg-info/10 text-info ring-info/20',
      accent: 'bg-masthead/10 text-masthead ring-masthead/20',
      violet: 'bg-[var(--chart-4)]/12 text-[var(--chart-4)] ring-[var(--chart-4)]/25 dark:text-violet-300',
    },
  },
  defaultVariants: { tone: 'neutral' },
})
export type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>
export function Badge({ className, tone, dot, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants> & { dot?: boolean }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {props.children}
    </span>
  )
}

const STATUS_TONE: Record<string, Tone> = {
  active: 'success',
  inactive: 'neutral',
  archived: 'neutral',
  paused: 'warning',
  cancelled: 'danger',
  expired: 'neutral',
  delivered: 'success',
  scheduled: 'info',
  pending: 'warning',
  missed: 'danger',
  holiday: 'violet',
  paid: 'success',
  partial: 'warning',
  unpaid: 'danger',
  overdue: 'danger',
  open: 'danger',
  in_progress: 'warning',
  resolved: 'success',
  queued: 'info',
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
      {label ?? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())}
    </Badge>
  )
}

// ---------------- Skeleton / loading ----------------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('type-skel', className)} aria-hidden />
}
export function PageSkeleton() {
  return (
    <div className="space-y-6 p-1">
      <Skeleton className="h-9 w-64" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  )
}

// ---------------- Avatar ----------------
// Deep two-colour gradients (white initials stay readable on both ends).
const AVATAR_BG = [
  'linear-gradient(135deg,#4f46e5,#0891b2)',
  'linear-gradient(135deg,#e11d48,#ea580c)',
  'linear-gradient(135deg,#9333ea,#db2777)',
  'linear-gradient(135deg,#047857,#0d9488)',
  'linear-gradient(135deg,#b45309,#dc2626)',
  'linear-gradient(135deg,#1d4ed8,#7c3aed)',
  'linear-gradient(135deg,#0e7490,#2563eb)',
]
export function Avatar({ name, size = 36, className }: { name: string; size?: number; className?: string }) {
  const bg = AVATAR_BG[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length]
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-display font-semibold tracking-tight text-white', className)}
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}

export function Progress({ value, className, tone = 'primary' }: { value: number; className?: string; tone?: 'primary' | 'success' | 'warning' | 'masthead' }) {
  const bg = {
    primary: 'bg-brand-gradient',
    success: 'bg-[linear-gradient(90deg,#10b981,#14b8a6)]',
    warning: 'bg-[linear-gradient(90deg,#f59e0b,#f97316)]',
    masthead: 'bg-[linear-gradient(90deg,#f43f5e,#ef4444)]',
  }[tone]
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

// ---------------- Tabs ----------------
export const Tabs = T.Root
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn('scrollbar-thin -mx-1 flex gap-1 overflow-x-auto border-b border-border px-1', className)} {...props} />
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'relative -mb-px shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-primary after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:origin-left after:scale-x-0 after:bg-primary after:transition-transform after:duration-300 after:ease-out-expo data-[state=active]:after:scale-x-100',
        className,
      )}
      {...props}
    />
  )
}
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof T.Content>) => <T.Content className={cn('animate-unfold pt-5 outline-none', className)} {...p} />

// ---------------- Page scaffolding ----------------
export function PageHeader({ title, kicker, description, actions }: { title: React.ReactNode; kicker?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex animate-rise flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {kicker && (
          <div className="kicker mb-2.5 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-masthead ring-1 ring-inset ring-[color-mix(in_oklab,var(--brand)_22%,transparent)]">
            <span className="idle-dot size-1.5 rounded-full bg-brand-gradient" />
            {kicker}
          </div>
        )}
        <h1 className="animate-ink font-serif text-[32px] font-extrabold leading-[1.05] text-primary sm:text-[42px]">{title}</h1>
        {description && <p className="mt-2 max-w-3xl text-[14.5px] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export const TONE_INK = {
  navy: 'var(--grad)',
  accent: 'linear-gradient(135deg, var(--brand-2), var(--brand))',
  success: 'linear-gradient(135deg, #10b981, #0d9488)',
  warning: 'linear-gradient(135deg, #f59e0b, #ea580c)',
  danger: 'linear-gradient(135deg, #f43f5e, #dc2626)',
  info: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
} as const

/** Solid colour of each tone, for the small icon disc and the figure's tick. */
const TONE_SOLID = {
  navy: 'var(--brand)',
  accent: 'var(--brand-2)',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
  info: '#3b82f6',
} as const

/**
 * One figure as a bento tile. Tiles keep the page's own grid; on the six-figure dashboards the
 * first tile becomes the large "hero" tile (CSS, `:has()`), and on phones the grid closes up
 * without gaps. Label with a tinted icon, a large gradient figure, the hint as a status chip;
 * clickable tiles show an arrow button. Paint-light: gradients only, no blur filters.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = 'navy',
  onClick,
  index = 0,
  className,
}: {
  label: string
  value: React.ReactNode
  icon: LucideIcon
  hint?: React.ReactNode
  tone?: keyof typeof TONE_INK
  onClick?: () => void
  index?: number
  className?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={{ ['--tone' as string]: TONE_SOLID[tone], ['--i' as string]: index }}
      className={cn('stat-cell group', onClick && 'is-link', className)}
    >
      <Icon className="stat-mark" aria-hidden />
      <span className="stat-top">
        <span className="stat-icon" aria-hidden>
          <Icon />
        </span>
        <span className="stat-label">{label}</span>
        {onClick && (
          <span className="stat-go" aria-hidden>
            <ArrowUpRight />
          </span>
        )}
      </span>
      <span className="stat-value tabular">
        {typeof value === 'string' || typeof value === 'number' ? <RollNumber value={String(value)} /> : value}
      </span>
      {hint && <span className="stat-hint">{hint}</span>}
    </Comp>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="paper-toss relative mb-5">
        <div className="absolute inset-0 rotate-12 rounded-2xl bg-brand-gradient opacity-30 blur-[2px]" />
        <div className="relative grid size-16 place-items-center rounded-2xl bg-brand-gradient text-white shadow-[0_14px_30px_-12px_var(--glow)]">
          <Icon className="size-7" />
        </div>
      </div>
      <h3 className="font-display text-lg font-semibold text-primary">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-destructive/25 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="mb-3 size-7 text-destructive" />
      <h3 className="font-display text-lg font-semibold text-destructive">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>}
      {onRetry && (
        <Button variant="outline" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function KeyValue({ items, className, cols = 2 }: { items: [React.ReactNode, React.ReactNode][]; className?: string; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3.5', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="kicker text-muted-foreground">{k}</dt>
          <dd className="mt-0.5 break-words text-[14.5px] text-foreground">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Money({ value, className, tone }: { value: number; className?: string; tone?: 'auto' }) {
  return <span className={cn('tabular whitespace-nowrap font-semibold', tone === 'auto' && value > 0 && 'text-destructive', className)}>{formatINR(value)}</span>
}

export function Section({ title, children, action, className }: { title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="kicker flex flex-1 items-center gap-2.5 text-muted-foreground before:h-4 before:w-1 before:rounded-full before:bg-brand-gradient after:h-px after:flex-1 after:bg-[linear-gradient(90deg,var(--border),transparent)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function DemoNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-md border border-dashed border-masthead/45 bg-masthead/5 px-3 py-2 text-[12.5px] text-masthead', className)}>
      <span className="mt-px rounded-[3px] bg-brand-gradient px-1.5 py-px font-mono text-[9.5px] font-bold uppercase tracking-wider text-white">Demo</span>
      <span className="text-foreground/80">{children}</span>
    </div>
  )
}
