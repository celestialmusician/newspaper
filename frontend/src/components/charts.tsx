import * as React from 'react'
import { cn, formatINR, formatNum } from '@/lib/utils'

/**
 * Lightweight charts: a key-figure strip and a hand-drawn SVG line chart.
 * No chart library: the whole module is a few kilobytes and follows the theme through CSS variables.
 */

/** Validated categorical order; light and dark steps live in index.css (--chart-*), so charts follow the theme. */
export const SERIES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

/** ₹ in Indian short form for axes and end labels: ₹950, ₹12.4k, ₹3.2L, ₹1.1Cr. */
export function compactINR(v: number) {
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  const f = (n: number) => (n >= 100 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString())
  if (a >= 1e7) return `${s}₹${f(a / 1e7)}Cr`
  if (a >= 1e5) return `${s}₹${f(a / 1e5)}L`
  if (a >= 1e3) return `${s}₹${f(a / 1e3)}k`
  return `${s}₹${Math.round(a)}`
}

/** Whole-number share, or a dash when there is nothing to divide by. */
export const sharePct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—')

// ---------------- Key figures ----------------

export interface Kpi {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  /** Status ink for the value (outstanding, missed…). */
  tone?: 'good' | 'warning' | 'critical'
}

const TONE_TEXT = { good: 'text-success', warning: 'text-warning', critical: 'text-destructive' } as const

/** A row of headline numbers, newspaper "figures" style: kicker label, big tabular number, short footnote. */
export function KpiStrip({ items, className }: { items: Kpi[]; className?: string }) {
  const hasHint = items.some((k) => k.hint !== undefined)
  return (
    <dl className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border/70 ring-1 ring-border/70', items.length >= 4 ? 'sm:grid-cols-4' : items.length === 3 ? 'sm:grid-cols-3' : '', className)}>
      {items.map((k) => (
        // Labels may wrap to two lines; the figures sit on one baseline across the row.
        <div key={k.label} className="flex min-w-0 flex-col bg-card px-4 py-3">
          <dt className="kicker line-clamp-2 flex-1 text-[10.5px] leading-[1.3] text-muted-foreground">{k.label}</dt>
          <dd className={cn('tabular mt-1 truncate font-display text-[22px] font-semibold leading-tight text-primary', k.tone && TONE_TEXT[k.tone])} title={typeof k.value === 'string' ? k.value : undefined}>
            {k.value}
          </dd>
          {hasHint && <dd className="mt-0.5 truncate text-[12px] text-muted-foreground">{k.hint ?? ' '}</dd>}
        </div>
      ))}
    </dl>
  )
}

// ---------------- Line chart ----------------

export interface SeriesDef {
  key: string
  name: string
  color?: string
}

/** Round axis maximum and step (1, 2, 2.5 or 5 × 10ⁿ) for about four gridlines. */
function niceScale(max: number) {
  if (!(max > 0)) return { top: 1, step: 0.25 }
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  return { top: Math.ceil(max / step) * step, step }
}

const PAD = { top: 14, bottom: 26 }

/**
 * Thin-line trend chart (2px lines, recessive grid, one y axis from zero).
 * One series gets a soft area under the line; two or more get a legend and labels at the line ends.
 * Hover / touch shows a crosshair with every series' value for that point.
 */
export function LineChart({
  data,
  x,
  series,
  money,
  height = 220,
  label,
  className,
}: {
  data: Record<string, unknown>[]
  x: string
  series: SeriesDef[]
  money?: boolean
  height?: number
  /** Accessible summary; defaults to the series names. */
  label?: string
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [w, setW] = React.useState(0)
  const [hover, setHover] = React.useState<number | null>(null)
  const gid = React.useId().replace(/:/g, '')

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    // Fires once on observe, then on every resize: the chart is redrawn at the real width (crisp, no scaling).
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fmt = money ? compactINR : (v: number) => formatNum(v)
  const full = money ? (v: number) => formatINR(v, true) : (v: number) => formatNum(v)
  const val = (row: Record<string, unknown>, k: string) => Number(row[k]) || 0
  const n = data.length
  const max = Math.max(0, ...data.flatMap((r) => series.map((s) => val(r, s.key))))
  const { top, step } = niceScale(max)
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)

  const multi = series.length > 1
  const padL = Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 10
  const padR = multi ? Math.max(...series.map((s) => fmt(val(data[n - 1] ?? {}, s.key)).length)) * 6.8 + 22 : 12
  const innerW = Math.max(0, w - padL - padR)
  const innerH = height - PAD.top - PAD.bottom
  const px = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const py = (v: number) => PAD.top + innerH - (v / top) * innerH
  const color = (s: SeriesDef, i: number) => s.color ?? SERIES[i % SERIES.length]!

  // Thin the x labels so they never collide (about one per 64px, always including the last point).
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / 64))))
  const xTicks = data.map((_, i) => i).filter((i) => (n - 1 - i) % every === 0)

  // End labels: nudge apart so two lines ending close together stay readable.
  const ends = multi
    ? series
        .map((s, i) => ({ s, i, y: py(val(data[n - 1] ?? {}, s.key)) }))
        .sort((a, b) => a.y - b.y)
    : []
  for (let k = 1; k < ends.length; k++) ends[k]!.y = Math.max(ends[k]!.y, ends[k - 1]!.y + 14)

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    if (n === 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const rel = (e.clientX - r.left) / Math.max(1, r.width)
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))))
  }

  const summary = label ?? `${series.map((s) => s.name).join(' and ')} by ${x}`
  const h = hover !== null ? data[hover] : null

  return (
    <div className={cn('min-w-0', className)}>
      {multi && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground" aria-hidden>
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-[3px] w-4 rounded-full" style={{ background: color(s, i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {w > 0 && n > 0 && (
          <svg width={w} height={height} role="img" aria-label={summary} className="block overflow-visible">
            <title>{summary}</title>
            {multi || (
              <defs>
                <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color(series[0]!, 0)} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={color(series[0]!, 0)} stopOpacity={0} />
                </linearGradient>
              </defs>
            )}
            {/* Recessive grid and y labels. */}
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={padL + innerW} y1={py(t)} y2={py(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={padL - 8} y={py(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--chart-axis)] text-[11px]">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {xTicks.map((i) => (
              <text key={i} x={px(i)} y={height - 6} textAnchor={n > 1 && i === n - 1 ? 'end' : n > 1 && i === 0 ? 'start' : 'middle'} className="fill-[var(--chart-axis)] text-[11px]">
                {String(data[i]![x])}
              </text>
            ))}

            {!multi && (
              <path
                d={`M${px(0)},${py(0)} ${data.map((r, i) => `L${px(i)},${py(val(r, series[0]!.key))}`).join(' ')} L${px(n - 1)},${py(0)} Z`}
                fill={`url(#a${gid})`}
              />
            )}
            {series.map((s, si) => (
              <path
                key={s.key}
                d={data.map((r, i) => `${i ? 'L' : 'M'}${px(i)},${py(val(r, s.key))}`).join(' ')}
                fill="none"
                stroke={color(s, si)}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                pathLength={1}
                className="chart-line"
              />
            ))}
            {n === 1 && series.map((s, si) => <circle key={s.key} cx={px(0)} cy={py(val(data[0]!, s.key))} r={4} fill={color(s, si)} stroke="var(--card)" strokeWidth={2} />)}

            {/* Direct labels at the line ends (value, in text ink; the dot carries the colour). */}
            {ends.map(({ s, i, y }) => (
              <g key={s.key}>
                <circle cx={px(n - 1)} cy={py(val(data[n - 1]!, s.key))} r={3} fill={color(s, i)} />
                <text x={px(n - 1) + 8} y={y} dy="0.32em" className="tabular fill-[var(--foreground)] text-[11.5px] font-semibold">
                  {fmt(val(data[n - 1]!, s.key))}
                </text>
              </g>
            ))}

            {hover !== null && h && (
              <g pointerEvents="none">
                <line x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--foreground)" strokeOpacity={0.25} />
                {series.map((s, si) => (
                  <circle key={s.key} cx={px(hover)} cy={py(val(h, s.key))} r={4.5} fill={color(s, si)} stroke="var(--card)" strokeWidth={2} />
                ))}
              </g>
            )}
            {/* Hit area larger than the marks: the whole plot. */}
            <rect x={padL} y={0} width={innerW} height={height} fill="transparent" className="touch-pan-y" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hover !== null && h && (
          <div
            className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-xl border border-border bg-popover/95 px-3 py-2 text-[12.5px] shadow-pop backdrop-blur"
            style={px(hover) > w / 2 ? { right: w - px(hover) + 10 } : { left: px(hover) + 10 }}
          >
            <div className="mb-1 font-semibold text-foreground">{String(h[x])}</div>
            {series.map((s, si) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="h-[3px] w-3 rounded-full" style={{ background: color(s, si) }} />
                <span className="text-muted-foreground">{s.name}</span>
                <span className="tabular ml-auto pl-3 font-semibold text-foreground">{full(val(h, s.key))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
