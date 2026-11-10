import { Check, Monitor, Moon, Palette as PaletteIcon, Sun } from 'lucide-react'
import * as React from 'react'
import { PALETTES, setTheme, toggleDark, useTheme, type Mode } from '@/app/theme'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlay'
import { cn } from '@/lib/utils'

const at = (e: React.MouseEvent) => ({ x: e.clientX, y: e.clientY })

/** Animated sun/moon toggle. */
export function ModeToggle({ className }: { className?: string }) {
  const dark = useTheme((s) => s.dark)
  return (
    <Button variant="ghost" size="icon" className={cn('soft-raised relative overflow-hidden rounded-full', className)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={(e) => toggleDark(at(e))}>
      <Sun className={cn('absolute size-5 transition-all duration-500', dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
      <Moon className={cn('absolute size-5 transition-all duration-500', dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} />
    </Button>
  )
}

const MODES: { id: Mode; label: string; icon: React.ElementType }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Auto', icon: Monitor },
]

/** Full appearance controls: mode and colour palette. */
export function AppearancePanel({ className }: { className?: string }) {
  const { mode, palette } = useTheme()
  return (
    <div className={cn('space-y-5', className)}>
      <div>
        <div className="kicker mb-2 text-muted-foreground">Mode</div>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={(e) => setTheme({ mode: m.id }, at(e))}
              aria-pressed={mode === m.id}
              className={cn(
                'flex h-10 items-center justify-center gap-1.5 rounded-lg text-[13px] font-semibold transition-all duration-300',
                mode === m.id ? 'bg-brand-gradient text-white shadow-[0_8px_18px_-8px_var(--glow)]' : 'text-muted-foreground hover:bg-card hover:text-foreground',
              )}
            >
              <m.icon className="size-4" /> {m.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="kicker mb-2 text-muted-foreground">Colour theme</div>
        <div className="grid grid-cols-2 gap-2">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={(e) => setTheme({ palette: p.id }, at(e))}
              aria-pressed={palette === p.id}
              className={cn(
                'press group flex items-center gap-2 rounded-xl border bg-card p-2 text-[12.5px] font-semibold',
                palette === p.id ? 'border-transparent shadow-press ring-2 ring-[var(--brand)]' : 'border-border',
              )}
            >
              <span className="relative grid size-8 shrink-0 place-items-center overflow-hidden rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}>
                {palette === p.id && <Check className="animate-pop relative size-4 text-white" strokeWidth={3} />}
              </span>
              {p.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Header button opening the appearance popover. */
export function ThemeMenu({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn('soft-raised rounded-full', className)} aria-label="Appearance and colour theme">
          <PaletteIcon className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,340px)]">
        <div className="rule-double mb-4 pb-2 font-serif text-[20px] font-semibold text-primary">Appearance</div>
        <AppearancePanel />
      </PopoverContent>
    </Popover>
  )
}

// Rising lights: [left %, duration s, delay s, sideways drift px]. Few on purpose — minimal motion.
const LIGHTS: [number, number, number, number][] = [
  [6, 22, 0, 40],
  [18, 28, 9, -30],
  [33, 19, 4, 26],
  [52, 26, 13, -44],
  [67, 21, 6, 34],
  [81, 30, 2, -24],
  [93, 24, 15, 20],
]

// Floating newspapers: [left %, size px, duration s, delay s, sideways drift px, start/end tilt deg].
const SHEETS: [number, number, number, number, number, number, number][] = [
  [8, 58, 38, 0, 70, -14, 10],
  [27, 40, 31, 17, -50, 12, -8],
  [46, 66, 44, 8, 40, -6, 18],
  [64, 46, 35, 24, -60, 16, -12],
  [84, 54, 40, 4, -40, -10, 14],
]

/** Live app backdrop: wandering gradient clouds, a slow dot grid, rising lights and folded newspapers floating up (transform/opacity only). */
export function Newsprint() {
  return (
    <div className="ambient" aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <b />
      {LIGHTS.map(([left, d, delay, x], k) => (
        <s key={k} style={{ left: `${left}%`, ['--d' as string]: `${d}s`, ['--delay' as string]: `-${delay}s`, ['--x' as string]: `${x}px` }} />
      ))}
      {SHEETS.map(([left, size, d, delay, x, r0, r1], k) => (
        <u key={k} style={{ left: `${left}%`, ['--s' as string]: `${size}px`, ['--d' as string]: `${d}s`, ['--delay' as string]: `-${delay}s`, ['--x' as string]: `${x}px`, ['--r0' as string]: `${r0}deg`, ['--r1' as string]: `${r1}deg` }} />
      ))}
    </div>
  )
}

/**
 * Idle-only: a paper boy cycles along the edge under the header and tosses a paper now and then.
 * Hidden (display: none) until the page goes idle, so it costs nothing while someone is working.
 */
export function IdleCourier({ className }: { className?: string }) {
  return (
    <div className={cn('idle-courier no-print pointer-events-none', className)} aria-hidden>
      <div className="idle-courier-ride">
        <span className="idle-paper" />
        <svg viewBox="0 0 36 24" width="36" height="24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          <g className="idle-wheel">
            <circle cx="8" cy="18" r="5" />
            <path d="M8 13v10M3 18h10" strokeWidth={0.9} />
          </g>
          <g className="idle-wheel">
            <circle cx="28" cy="18" r="5" />
            <path d="M28 13v10M23 18h10" strokeWidth={0.9} />
          </g>
          <path d="M8 18l6-8h9l5 8M14 10l4 8H8M23 10l-1.5-3.5H19" />
          <path d="M18 18l-2-7 4-3" />
          <circle cx="21.5" cy="3.2" r="2.1" fill="currentColor" stroke="none" />
          <rect x="9" y="5.5" width="6.5" height="4.5" rx="1" fill="currentColor" stroke="none" opacity={0.75} />
        </svg>
      </div>
    </div>
  )
}

const WELCOME_KEY = 'nap.welcome'
export const queueWelcome = (name: string, text: string) => {
  try {
    sessionStorage.setItem(WELCOME_KEY, JSON.stringify({ name, text }))
  } catch {
    /* ignore */
  }
}

/** One-shot animated welcome card shown right after sign-in or MPIN creation. */
export function WelcomeVeil() {
  const [data] = React.useState<{ name: string; text: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem(WELCOME_KEY)
      sessionStorage.removeItem(WELCOME_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [done, setDone] = React.useState(false)
  React.useEffect(() => {
    if (!data) return
    const t = setTimeout(() => setDone(true), 2000)
    return () => clearTimeout(t)
  }, [data])
  if (!data || done) return null
  return (
    <div className="welcome-veil pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-background/80" onAnimationEnd={(e) => e.target === e.currentTarget && setDone(true)} role="status">
      <div className="welcome-card hero-panel mx-5 flex w-full max-w-sm flex-col items-center rounded-md px-8 py-9 text-center shadow-[0_12px_28px_-12px_var(--glow)]">
        <div className="kicker mb-5 w-full border-b border-white/20 pb-2 text-white/60">Extra · Extra</div>
        <span className="grid size-16 place-items-center rounded-full bg-brand-gradient text-white">
          <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path className="check-draw" d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <div className="mt-5 font-serif text-[28px] font-semibold leading-tight">Welcome, {data.name}</div>
        <div className="mt-1 text-[14px] text-white/70">{data.text}</div>
      </div>
    </div>
  )
}
