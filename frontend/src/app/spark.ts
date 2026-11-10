import { useTheme } from './theme'

/**
 * Ink splash on primary buttons, adapted from React Bits "ClickSpark" (MIT, reactbits.dev).
 * One shared canvas for the whole app, made on the first click and only drawn while a splash
 * is alive; one delegated listener, so buttons need no wrapper. Strokes fly out in the
 * palette's two inks and drops fall like a flicked pen. Off for "lite" effects and reduced motion.
 * Any element can opt in with `data-spark`; `.btn-3d` (filled buttons) splash by default.
 */
export function initSpark() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const DURATION = 520
  const COUNT = 9
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  let ratio = 1
  let raf = 0
  type Burst = { x: number; y: number; start: number; inks: [string, string]; angles: number[] }
  const bursts: Burst[] = []

  const size = () => {
    if (!canvas || !ctx) return
    ratio = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(window.innerWidth * ratio)
    canvas.height = Math.round(window.innerHeight * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  const ensure = () => {
    if (canvas) return true
    canvas = document.createElement('canvas')
    canvas.className = 'ink-spark no-print'
    canvas.setAttribute('aria-hidden', 'true')
    document.body.appendChild(canvas)
    ctx = canvas.getContext('2d')
    size()
    window.addEventListener('resize', size, { passive: true })
    return !!ctx
  }

  const draw = (now: number) => {
    raf = 0
    if (!ctx || !canvas) return
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio)
    for (let b = bursts.length - 1; b >= 0; b--) {
      const burst = bursts[b]!
      const t = (now - burst.start) / DURATION
      if (t >= 1) {
        bursts.splice(b, 1)
        continue
      }
      const out = 1 - Math.pow(1 - t, 3)
      ctx.globalAlpha = 1 - t * t
      burst.angles.forEach((a, i) => {
        const cos = Math.cos(a)
        const sin = Math.sin(a)
        ctx!.strokeStyle = ctx!.fillStyle = burst.inks[i % 2]!
        if (i % 3 === 2) {
          // A drop: flies out, then falls.
          const r = 8 + 26 * out
          ctx!.beginPath()
          ctx!.arc(burst.x + cos * r, burst.y + sin * r + 60 * t * t, 2.4 * (1 - t) + 0.6, 0, Math.PI * 2)
          ctx!.fill()
        } else {
          // A stroke: a short pen line that runs out and thins.
          const r1 = 6 + 24 * out
          const r2 = r1 + 12 * (1 - t)
          ctx!.lineWidth = 2.2 * (1 - t) + 0.4
          ctx!.lineCap = 'round'
          ctx!.beginPath()
          ctx!.moveTo(burst.x + cos * r1, burst.y + sin * r1)
          ctx!.lineTo(burst.x + cos * r2, burst.y + sin * r2)
          ctx!.stroke()
        }
      })
    }
    ctx.globalAlpha = 1
    if (bursts.length) raf = requestAnimationFrame(draw)
  }

  document.addEventListener(
    'click',
    (e) => {
      if (reduce.matches || useTheme.getState().effects === 'lite') return
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.btn-3d, [data-spark]')
      if (!el || el.matches(':disabled, [aria-disabled="true"]') || !ensure()) return
      let { clientX: x, clientY: y } = e
      // Keyboard press: splash from the middle of the button.
      if (e.detail === 0) {
        const r = el.getBoundingClientRect()
        x = r.left + r.width / 2
        y = r.top + r.height / 2
      }
      const css = getComputedStyle(document.documentElement)
      const inks: [string, string] = [css.getPropertyValue('--brand').trim() || '#4f46e5', css.getPropertyValue('--brand-2').trim() || '#0891b2']
      const turn = Math.random() * Math.PI
      bursts.push({ x, y, start: performance.now(), inks, angles: Array.from({ length: COUNT }, (_, i) => turn + (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.35) })
      if (bursts.length > 12) bursts.shift()
      raf ||= requestAnimationFrame(draw)
    },
    { passive: true, capture: true },
  )
}
