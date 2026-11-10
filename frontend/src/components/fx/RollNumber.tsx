import * as React from 'react'
import { useRichMotion } from '@/app/theme'

/**
 * Odometer figure, adapted from React Bits "CountUp" (roll mode, MIT, reactbits.dev).
 * Every digit is a 0–9 strip that rolls to its place like a press counter; commas, ₹ and
 * other marks stay put. Pure CSS transitions on transform (no per-frame JS), so a dashboard
 * full of figures costs nothing after the first roll. A changed value rolls from the old one.
 * Plain text for "lite" effects and reduced motion. Screen readers get the value once.
 */
export function RollNumber({ value }: { value: string }) {
  const rich = useRichMotion()
  const [armed, setArmed] = React.useState(false)
  React.useEffect(() => {
    if (!rich) return
    // Two frames: the strips paint at 0 first, then roll to the value.
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => setArmed(true))))
    return () => cancelAnimationFrame(id)
  }, [rich])

  if (!rich) return <>{value}</>
  const chars = [...value]
  let place = 0
  const cols = chars
    .map((c, i) => ({ c, key: chars.length - i }))
    .reverse()
    .map((x) => ({ ...x, place: /\d/.test(x.c) ? place++ : -1 }))
    .reverse()
  return (
    <span className="roll">
      <span className="sr-only">{value}</span>
      {cols.map(({ c, key, place }) =>
        place < 0 ? (
          <span key={key} aria-hidden className="roll-mark">
            {c}
          </span>
        ) : (
          <span key={key} aria-hidden className="roll-col" style={{ ['--d' as string]: armed ? Number(c) : 0, ['--k' as string]: place }}>
            <span>
              {DIGITS.map((d) => (
                <i key={d}>{d}</i>
              ))}
            </span>
          </span>
        ),
      )}
    </span>
  )
}
const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
