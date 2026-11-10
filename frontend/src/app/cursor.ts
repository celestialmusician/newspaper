import { useTheme } from './theme'

/**
 * Fountain-pen cursor: the mouse pointer becomes the nib of an editor's pen, in the palette's
 * inks with a white outline and a shadow so it reads on any background (light, dark, or a
 * filled brand button). The nib's tip is the exact click point.
 * - Moving: the pen leans with the stroke, as if writing, and settles back upright.
 * - Over a button, link, tab or option: a bold ring wraps the control (its shape and corner
 *   radius, pulled slightly towards the pointer) and the nib dips, ready to sign.
 * - Over a big clickable block (table row, tilt card): the nib dips; no ring, no label.
 * - Press: the nib presses down; release leaves a spreading ink blot at the tip.
 * - Over text fields and the map the system cursor comes back (caret, grab hand).
 *
 * Cost: one pointer listener, a few fixed elements moved with the `translate` / `rotate`
 * properties, and a frame loop that stops once everything has settled. Mouse and trackpad only;
 * under prefers-reduced-motion (and before the first mouse move) the normal pointer is used,
 * so the page is never left without a cursor.
 */
export function initCursor() {
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const html = document.documentElement
  const PAD_X = 6
  const PAD_Y = 5
  const MAGNET = 0.14
  const INTERACTIVE =
    'a[href], button:not(:disabled), [role="button"]:not([aria-disabled="true"]), [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], [role="switch"], [role="checkbox"], select, summary, label[for], input[type="checkbox"], input[type="radio"], .sel-opt, .cal-day, tr.cursor-pointer, [data-tilt]'
  const NATIVE =
    'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"]), textarea, [contenteditable=""], [contenteditable="true"], .leaflet-container, iframe'
  /** Above this size a target is not wrapped (the ring would frame half the page); the nib only dips. */
  const WRAP_MAX_W = 340
  const WRAP_MAX_H = 72

  let pen: HTMLDivElement | null = null
  let ring: HTMLDivElement | null = null
  let blot: HTMLDivElement | null = null

  const ptr = { x: -200, y: -200 }
  const r = { x: -200, y: -200, w: 30, h: 30, rad: 15 }
  let lean = 0
  let hover: HTMLElement | null = null
  let mode: 'free' | 'wrap' | 'dip' | 'native' = 'free'
  let hoverDirty = false
  let active = false
  let raf = 0
  let last = 0
  let lastMove = 0
  let velocity = 0

  const build = () => {
    if (pen) return
    pen = document.createElement('div')
    pen.className = 'cur-pen no-print'
    // Nib drawn pointing up, turned 45° so the tip points up-left like an arrow; tip at (5, 5).
    pen.innerHTML =
      '<svg viewBox="0 0 32 32" width="32" height="32"><defs><linearGradient id="cur-ink" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="var(--brand)"/><stop offset="1" stop-color="var(--brand-2)"/></linearGradient></defs>' +
      '<g transform="rotate(-45 16 16)">' +
      '<path class="cur-nib" d="M16 1C17.6 6 21.6 10 22.2 15L21 23H11L9.8 15C10.4 10 14.4 6 16 1Z"/>' +
      '<path d="M16 4.5V13.6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>' +
      '<circle cx="16" cy="15.4" r="1.7" fill="#fff"/>' +
      '<rect class="cur-grip" x="10.2" y="23" width="11.6" height="7" rx="1.6"/>' +
      '</g></svg>'
    ring = document.createElement('div')
    ring.className = 'cur-ring no-print'
    blot = document.createElement('div')
    blot.className = 'cur-blot no-print'
    for (const el of [pen, ring, blot]) el.setAttribute('aria-hidden', 'true')
    document.body.append(blot, ring, pen)
    blot.addEventListener('animationend', () => blot!.classList.remove('is-on'))
  }

  const setActive = (on: boolean) => {
    if (on === active) return
    active = on
    html.classList.toggle('ink-cursor', on)
    pen?.classList.toggle('is-on', on)
    ring?.classList.toggle('is-on', on)
  }

  /** Work out what the pointer is over: wrap a control, dip over a big one, step aside, or roam free. */
  const classify = (el: Element | null) => {
    hoverDirty = false
    // A label laid over its text field (floating labels) counts as the field.
    const control = el?.closest?.('label')?.control
    if (el?.closest?.(NATIVE) || control?.matches(NATIVE)) {
      hover = null
      mode = 'native'
    } else {
      const t = el?.closest?.<HTMLElement>(INTERACTIVE) ?? null
      hover = t
      if (!t) mode = 'free'
      else {
        const b = t.getBoundingClientRect()
        mode = b.width > WRAP_MAX_W || b.height > WRAP_MAX_H ? 'dip' : 'wrap'
      }
    }
    if (!ring || !pen) return
    ring.dataset.mode = mode
    pen.dataset.mode = mode
    html.classList.toggle('ink-native', mode === 'native')
  }

  const frame = (now: number) => {
    raf = 0
    if (!ring || !pen) return
    if (hoverDirty) classify(document.elementFromPoint(ptr.x, ptr.y))
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000))
    last = now
    // Ring target: around the control (wrap), otherwise resting hidden on the tip.
    let tx = ptr.x
    let ty = ptr.y
    let tw = 30
    let th = 30
    let trad = 15
    if (mode === 'wrap' && hover?.isConnected) {
      const b = hover.getBoundingClientRect()
      const cx = b.left + b.width / 2
      const cy = b.top + b.height / 2
      tx = cx + (ptr.x - cx) * MAGNET
      ty = cy + (ptr.y - cy) * MAGNET
      tw = b.width + PAD_X * 2
      th = b.height + PAD_Y * 2
      const br = parseFloat(getComputedStyle(hover).borderTopLeftRadius) || 0
      trad = Math.min(th / 2, br + Math.min(PAD_X, PAD_Y))
    }
    const k = 1 - Math.exp(-dt / (mode === 'wrap' ? 0.09 : 0.07))
    const ks = 1 - Math.exp(-dt / 0.11)
    r.x += (tx - r.x) * k
    r.y += (ty - r.y) * k
    r.w += (tw - r.w) * ks
    r.h += (th - r.h) * ks
    r.rad += (trad - r.rad) * ks
    // The pen leans with horizontal speed (px/s), up to 16°, and eases back when still.
    velocity *= Math.exp(-dt / 0.08)
    const targetLean = Math.max(-16, Math.min(16, velocity * 0.012))
    lean += (targetLean - lean) * (1 - Math.exp(-dt / 0.09))

    pen.style.translate = `${ptr.x}px ${ptr.y}px`
    pen.style.rotate = `${lean.toFixed(2)}deg`
    ring.style.translate = `${(r.x - r.w / 2).toFixed(1)}px ${(r.y - r.h / 2).toFixed(1)}px`
    ring.style.width = `${r.w.toFixed(1)}px`
    ring.style.height = `${r.h.toFixed(1)}px`
    ring.style.borderRadius = `${r.rad.toFixed(1)}px`

    const settled =
      Math.abs(tx - r.x) < 0.1 && Math.abs(ty - r.y) < 0.1 && Math.abs(tw - r.w) < 0.1 && Math.abs(th - r.h) < 0.1 && Math.abs(lean) < 0.05
    // Keep following a wrapped control for a moment: it may still be moving (its own hover lift).
    if (!settled || (mode === 'wrap' && now - lastMove < 600)) raf = requestAnimationFrame(frame)
  }
  const wake = () => {
    if (raf) return
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const usable = (e: PointerEvent) => e.pointerType === 'mouse' && fine.matches && !reduce.matches && useTheme.getState().effects !== 'lite'

  document.addEventListener(
    'pointermove',
    (e) => {
      if (!usable(e)) {
        setActive(false)
        return
      }
      build()
      const now = performance.now()
      if (active && now > lastMove) velocity = (velocity + ((e.clientX - ptr.x) / Math.max(8, now - lastMove)) * 1000) / 2
      ptr.x = e.clientX
      ptr.y = e.clientY
      lastMove = now
      if (!active) {
        // First move: start the ring on the pointer, not flying in from a corner.
        r.x = ptr.x
        r.y = ptr.y
        classify(e.target as Element)
      } else hoverDirty = true
      setActive(true)
      wake()
    },
    { passive: true },
  )
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!active || !usable(e)) return
      pen?.classList.add('is-down')
      ring?.classList.add('is-down')
    },
    { passive: true },
  )
  document.addEventListener(
    'pointerup',
    () => {
      if (!pen || !ring || !blot || !pen.classList.contains('is-down')) return
      pen.classList.remove('is-down')
      ring.classList.remove('is-down')
      // Ink blot where the nib touched the page.
      blot.classList.remove('is-on')
      blot.style.translate = `${ptr.x}px ${ptr.y}px`
      void blot.offsetWidth
      blot.classList.add('is-on')
    },
    { passive: true },
  )
  // Content can move under a still pointer (scrolling, a menu opening): look again next frame.
  const recheck = () => {
    if (!active) return
    hoverDirty = true
    lastMove = performance.now()
    wake()
  }
  window.addEventListener('scroll', recheck, { passive: true, capture: true })
  document.addEventListener('click', recheck, { passive: true, capture: true })
  html.addEventListener('pointerleave', () => {
    pen?.classList.remove('is-on')
    ring?.classList.remove('is-on')
  })
  html.addEventListener('pointerenter', () => {
    if (!active) return
    pen?.classList.add('is-on')
    ring?.classList.add('is-on')
  })
  // Reduced motion switched on mid-session: hand the pointer back at once.
  reduce.addEventListener('change', () => reduce.matches && setActive(false))
}
