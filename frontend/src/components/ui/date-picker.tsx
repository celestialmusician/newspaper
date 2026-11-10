import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Popover as PP } from 'radix-ui'
import * as React from 'react'
import { addDaysISO, fmtDate, fmtMonth, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { fieldBase } from './field-style'

/**
 * Themed calendar for `<Input type="date">` and `<Input type="month">`.
 * Same props as the native input (value as ISO text, min, max, onChange(e.target.value)), so every
 * existing form keeps working. The panel unfolds like newsprint, days rise in row by row, and the
 * month slides in the direction you navigate.
 */
type PickerProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const monthKey = (y: number, m: number) => `${y}-${pad(m + 1)}`
const dim = (y: number, m: number) => new Date(y, m + 1, 0).getDate()
const parse = (s: string) => {
  const r = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s)
  return r ? { y: +r[1]!, m: +r[2]! - 1, d: r[3] ? +r[3] : 1 } : null
}

type View = 'days' | 'months' | 'years'

function Picker({ mode, value, min, max, onChange, disabled, id, name, className, placeholder, required, autoFocus, ...rest }: PickerProps & { mode: 'date' | 'month' }) {
  const v = value == null ? '' : String(value)
  const lo = min == null ? '' : String(min)
  const hi = max == null ? '' : String(max)
  const today = todayISO()

  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<View>('days')
  const [cur, setCur] = React.useState({ y: 2000, m: 0 })
  const [focus, setFocus] = React.useState('')
  const [dir, setDir] = React.useState(1)
  const [yearBase, setYearBase] = React.useState(2000)
  const gridRef = React.useRef<HTMLDivElement>(null)

  const emit = (next: string) => {
    const t = { value: next, name, id }
    onChange?.({ target: t, currentTarget: t } as unknown as React.ChangeEvent<HTMLInputElement>)
  }

  const dayOk = (iso: string) => !(lo && iso < lo) && !(hi && iso > hi)
  const monthOk = (y: number, m: number) => !(lo && monthKey(y, m) < lo.slice(0, 7)) && !(hi && monthKey(y, m) > hi.slice(0, 7))
  const yearOk = (y: number) => !(lo && y < +lo.slice(0, 4)) && !(hi && y > +hi.slice(0, 4))

  const onOpenChange = (o: boolean) => {
    if (o) {
      let base = v || (mode === 'date' ? today : today.slice(0, 7))
      if (lo && base.slice(0, lo.length) < lo) base = lo
      if (hi && base.slice(0, hi.length) > hi) base = hi
      const p = parse(base) ?? parse(today)!
      setCur({ y: p.y, m: p.m })
      setFocus(mode === 'date' ? ymd(p.y, p.m, p.d) : '')
      setView(mode === 'month' ? 'months' : 'days')
      setYearBase(p.y - (p.y % 12))
      setDir(1)
    }
    setOpen(o)
  }

  const pick = (iso: string) => {
    if (!dayOk(iso)) return
    emit(iso)
    setOpen(false)
  }

  const goMonth = (delta: number) => {
    setDir(delta)
    setCur((c) => {
      const t = c.y * 12 + c.m + delta
      return { y: Math.floor(t / 12), m: ((t % 12) + 12) % 12 }
    })
  }

  // Move keyboard focus onto the highlighted day.
  React.useEffect(() => {
    if (!open || view !== 'days' || !focus) return
    const t = setTimeout(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-d="${focus}"]`)?.focus({ preventScroll: true }), 0)
    return () => clearTimeout(t)
  }, [open, view, focus, cur])

  const moveFocus = (iso: string, delta: number) => {
    const next = addDaysISO(iso, delta)
    const p = parse(next)!
    setDir(next > iso ? 1 : -1)
    setCur({ y: p.y, m: p.m })
    setFocus(next)
  }

  const onGridKey = (e: React.KeyboardEvent) => {
    if (!focus) return
    const k = e.key
    if (k === 'ArrowLeft') moveFocus(focus, -1)
    else if (k === 'ArrowRight') moveFocus(focus, 1)
    else if (k === 'ArrowUp') moveFocus(focus, -7)
    else if (k === 'ArrowDown') moveFocus(focus, 7)
    else if (k === 'PageUp' || k === 'PageDown') {
      const p = parse(focus)!
      const step = (k === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1)
      const t = p.y * 12 + p.m + step
      const y = Math.floor(t / 12)
      const m = ((t % 12) + 12) % 12
      setDir(step)
      setCur({ y, m })
      setFocus(ymd(y, m, Math.min(p.d, dim(y, m))))
    } else if (k === 'Home') moveFocus(focus, -((new Date(parse(focus)!.y, parse(focus)!.m, parse(focus)!.d).getDay() + 6) % 7))
    else if (k === 'End') moveFocus(focus, 6 - ((new Date(parse(focus)!.y, parse(focus)!.m, parse(focus)!.d).getDay() + 6) % 7))
    else if (k === 'Enter' || k === ' ') pick(focus)
    else return
    e.preventDefault()
  }

  const label = v ? (mode === 'date' ? fmtDate(v) : fmtMonth(`${v}-01`)) : ''
  const cells = React.useMemo(() => {
    const lead = (new Date(cur.y, cur.m, 1).getDay() + 6) % 7
    const n = dim(cur.y, cur.m)
    return Array.from({ length: 42 }, (_, i) => {
      const d = i - lead + 1
      return d >= 1 && d <= n ? d : 0
    })
  }, [cur])

  const title = view === 'days' ? `${MONTHS[cur.m]} ${cur.y}` : view === 'months' ? String(cur.y) : `${yearBase} – ${yearBase + 11}`
  const prev = () => (view === 'days' ? goMonth(-1) : view === 'months' ? (setDir(-1), setCur((c) => ({ ...c, y: c.y - 1 }))) : setYearBase((b) => b - 12))
  const next = () => (view === 'days' ? goMonth(1) : view === 'months' ? (setDir(1), setCur((c) => ({ ...c, y: c.y + 1 }))) : setYearBase((b) => b + 12))
  const canToday = mode === 'date' ? dayOk(today) : monthOk(+today.slice(0, 4), +today.slice(5, 7) - 1)

  return (
    <PP.Root open={open} onOpenChange={onOpenChange}>
      <PP.Trigger asChild disabled={disabled}>
        <button
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
          id={id}
          type="button"
          autoFocus={autoFocus}
          aria-haspopup="dialog"
          className={cn(fieldBase, 'group h-11 cursor-pointer items-center justify-between gap-2 text-left data-[state=open]:border-masthead/60 data-[state=open]:ring-4 data-[state=open]:ring-ring/15', className)}
        >
          <span className={cn('truncate tabular', !label && 'text-muted-foreground/70')}>{label || placeholder || (mode === 'date' ? 'Select date' : 'Select month')}</span>
          <CalendarDays className="size-4 shrink-0 text-muted-foreground transition-colors duration-300 group-data-[state=open]:text-masthead" />
        </button>
      </PP.Trigger>
      {name && <input type="hidden" name={name} value={v} />}
      <PP.Portal>
        <PP.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="sel-pop glass-pop z-50 max-h-[var(--radix-popover-content-available-height)] w-[296px] max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-2xl border p-3 text-popover-foreground shadow-pop outline-none"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button type="button" onClick={prev} aria-label={view === 'days' ? 'Previous month' : view === 'months' ? 'Previous year' : 'Previous years'} className="cal-nav">
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView((x) => (x === 'days' ? 'months' : x === 'months' ? 'years' : mode === 'month' ? 'months' : 'days'))}
              disabled={mode === 'month' && view === 'months'}
              aria-live="polite"
              className="rounded-lg px-2.5 py-1 font-serif text-[17px] font-semibold text-primary transition-colors hover:bg-accent disabled:pointer-events-none"
            >
              {title}
            </button>
            <button type="button" onClick={next} aria-label={view === 'days' ? 'Next month' : view === 'months' ? 'Next year' : 'Next years'} className="cal-nav">
              <ChevronRight className="size-4" />
            </button>
          </div>

          {view === 'days' && (
            <>
              <div className="kicker mb-1 grid grid-cols-7 text-center text-[10px] text-muted-foreground" aria-hidden>
                {DOW.map((d) => (
                  <span key={d} className={d === 'Sun' ? 'text-masthead' : ''}>
                    {d}
                  </span>
                ))}
              </div>
              <div key={`${cur.y}-${cur.m}`} ref={gridRef} role="group" aria-label={`${MONTHS[cur.m]} ${cur.y}`} onKeyDown={onGridKey} className="cal-grid grid grid-cols-7 gap-0.5" style={{ ['--dir' as string]: dir }}>
                {cells.map((d, i) => {
                  if (!d) return <span key={i} />
                  const iso = ymd(cur.y, cur.m, d)
                  const ok = dayOk(iso)
                  return (
                    <button
                      key={i}
                      type="button"
                      data-d={iso}
                      tabIndex={iso === focus ? 0 : -1}
                      aria-pressed={iso === v}
                      aria-disabled={!ok || undefined}
                      aria-label={`${d} ${MONTHS[cur.m]} ${cur.y}`}
                      style={{ ['--r' as string]: Math.floor(i / 7) }}
                      onClick={() => pick(iso)}
                      onFocus={() => setFocus(iso)}
                      className={cn('cal-day', iso === v && 'is-sel', iso === today && 'is-today', (i % 7) === 6 && 'is-sun')}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          {view === 'months' && (
            <div key={`m-${cur.y}`} className="cal-grid grid grid-cols-3 gap-1.5 py-1" style={{ ['--dir' as string]: dir }}>
              {MONTHS.map((name, i) => {
                const ok = monthOk(cur.y, i)
                const sel = mode === 'month' ? v === monthKey(cur.y, i) : v.startsWith(monthKey(cur.y, i))
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={sel}
                    aria-disabled={!ok || undefined}
                    style={{ ['--r' as string]: Math.floor(i / 3) }}
                    onClick={() => {
                      if (!ok) return
                      if (mode === 'month') {
                        emit(monthKey(cur.y, i))
                        setOpen(false)
                      } else {
                        setCur({ y: cur.y, m: i })
                        setFocus(ymd(cur.y, i, Math.min(parse(focus || today)!.d, dim(cur.y, i))))
                        setView('days')
                      }
                    }}
                    className={cn('cal-day cal-wide', sel && 'is-sel', monthKey(cur.y, i) === today.slice(0, 7) && 'is-today')}
                  >
                    {name.slice(0, 3)}
                  </button>
                )
              })}
            </div>
          )}

          {view === 'years' && (
            <div key={`y-${yearBase}`} className="cal-grid grid grid-cols-3 gap-1.5 py-1" style={{ ['--dir' as string]: dir }}>
              {Array.from({ length: 12 }, (_, i) => yearBase + i).map((y, i) => {
                const ok = yearOk(y)
                return (
                  <button
                    key={y}
                    type="button"
                    aria-pressed={y === cur.y}
                    aria-disabled={!ok || undefined}
                    style={{ ['--r' as string]: Math.floor(i / 3) }}
                    onClick={() => {
                      if (!ok) return
                      setCur((c) => ({ ...c, y }))
                      setView('months')
                    }}
                    className={cn('cal-day cal-wide', y === cur.y && 'is-sel', y === +today.slice(0, 4) && 'is-today')}
                  >
                    {y}
                  </button>
                )
              })}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <button
              type="button"
              disabled={!canToday}
              onClick={() => {
                if (mode === 'date') pick(today)
                else {
                  emit(today.slice(0, 7))
                  setOpen(false)
                }
              }}
              className="rounded-lg px-2.5 py-1 text-[13px] font-bold text-masthead transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
            >
              {mode === 'date' ? 'Today' : 'This month'}
            </button>
            {v && !required && mode === 'date' && (
              <button
                type="button"
                onClick={() => {
                  emit('')
                  setOpen(false)
                }}
                className="rounded-lg px-2.5 py-1 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </PP.Content>
      </PP.Portal>
    </PP.Root>
  )
}

export function DatePicker(props: PickerProps) {
  return <Picker mode="date" {...props} />
}

export function MonthPicker(props: PickerProps) {
  return <Picker mode="month" {...props} />
}
