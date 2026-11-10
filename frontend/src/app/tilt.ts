import { useTheme } from './theme'

/**
 * Pointer-driven card effects from one passive listener:
 * - 3D tilt for every `[data-tilt]` element;
 * - a "reading lamp" on every `.glass-card`: a soft pool of brand light that follows the pointer
 *   (adapted from React Bits "SpotlightCard", MIT, reactbits.dev).
 * Writes CSS variables on the single hovered element(s), at most once per frame; the look lives
 * in CSS (index.css), so React never re-renders. Skipped on touch screens, in "lite" effects mode
 * and under prefers-reduced-motion.
 */
export function initTilt(max = 7) {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  let el: HTMLElement | null = null
  let lamp: HTMLElement | null = null
  // Measured once per hover (and after scrolling), not per frame: the tilt itself changes the box.
  let rect: DOMRect | null = null
  let lampRect: DOMRect | null = null
  let frame = 0
  let x = 0
  let y = 0

  const reset = (t: HTMLElement) => {
    t.style.removeProperty('--rx')
    t.style.removeProperty('--ry')
  }
  const paint = () => {
    frame = 0
    if (lamp) {
      const r = (lampRect ??= lamp.getBoundingClientRect())
      lamp.style.setProperty('--sx', `${(x - r.left).toFixed(0)}px`)
      lamp.style.setProperty('--sy', `${(y - r.top).toFixed(0)}px`)
    }
    if (!el) return
    const r = (rect ??= el.getBoundingClientRect())
    const px = (x - r.left) / r.width
    const py = (y - r.top) / r.height
    el.style.setProperty('--rx', `${((0.5 - py) * max).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${((px - 0.5) * max).toFixed(2)}deg`)
    el.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`)
    el.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`)
  }

  document.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' || !fine.matches || reduce.matches || useTheme.getState().effects === 'lite') return
      const target = e.target as Element | null
      const t = target?.closest?.<HTMLElement>('[data-tilt]') ?? null
      if (t !== el) {
        if (el) reset(el)
        el = t
        rect = null
      }
      const l = target?.closest?.<HTMLElement>('.glass-card') ?? null
      if (l !== lamp) {
        lamp = l
        lampRect = null
      }
      if (!el && !lamp) return
      x = e.clientX
      y = e.clientY
      frame ||= requestAnimationFrame(paint)
    },
    { passive: true },
  )
  window.addEventListener(
    'scroll',
    () => {
      rect = null
      lampRect = null
    },
    { passive: true, capture: true },
  )
  document.addEventListener('pointerleave', () => {
    if (el) reset(el)
    el = null
    lamp = null
  })
}
