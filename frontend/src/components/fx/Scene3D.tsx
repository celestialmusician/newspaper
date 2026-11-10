import * as React from 'react'
import { useRichMotion } from '@/app/theme'
import { cn } from '@/lib/utils'

/** One printed page: masthead rule, headline bars, a photo block and text columns (CSS shapes only). */
function Page({ variant = 'front', masthead }: { variant?: 'front' | 'inside' | 'back'; masthead?: string }) {
  return (
    <div className="flex h-full flex-col p-[7%] text-[#1b1814]">
      {variant === 'front' ? (
        <>
          <div className="truncate text-center font-serif text-[clamp(9px,1.9cqw,15px)] font-bold leading-none">{masthead}</div>
          <div className="mt-[4%] border-t-[3px] border-double border-[#1b1814]" />
          <div className="mt-[5%] h-[6%] w-[90%] rounded-[1px] bg-[#1b1814]" />
          <div className="mt-[3%] h-[6%] w-[62%] rounded-[1px] bg-[#1b1814]" />
          <div className="mt-[6%] grid flex-1 grid-cols-[1.4fr_minmax(0,1fr)] gap-[6%]">
            <div className="rounded-[2px] bg-[var(--brand)] opacity-85 [background-image:radial-gradient(rgba(255,255,255,.35)_1px,transparent_1.3px)] [background-size:5px_5px]" />
            <div className="col-lines opacity-80" />
          </div>
          <div className="col-lines mt-[6%] h-[16%] opacity-70" />
        </>
      ) : variant === 'inside' ? (
        <>
          <div className="h-[2px] bg-[#1b1814]" />
          <div className="mt-[6%] h-[5%] w-[75%] bg-[#1b1814]" />
          <div className="mt-[6%] grid flex-1 grid-cols-2 gap-[8%]">
            <div className="col-lines opacity-75" />
            <div className="flex flex-col gap-[8%]">
              <div className="h-[40%] rounded-[2px] bg-[var(--brand-2)] opacity-70" />
              <div className="col-lines flex-1 opacity-75" />
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="h-[2px] bg-[#1b1814]" />
          <div className="col-lines mt-[8%] flex-1 opacity-60" />
          <div className="mt-[8%] h-[22%] rounded-[2px] border-2 border-[#1b1814] p-[6%]">
            <div className="h-[30%] w-[70%] bg-[var(--brand)]" />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Pure-CSS 3D broadsheet lying on a bundle of papers; the right-hand page keeps turning.
 * Pointer parallax tilts the rig. Only transforms animate, so it stays on the compositor.
 */
export function Paper3D({ className, size = 360, masthead = 'The Morning Round' }: { className?: string; size?: number; masthead?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const rich = useRichMotion()
  // Off screen (scrolled away, collapsed hero): pause the page turn so it costs nothing.
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => el.toggleAttribute('data-paused', !e!.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  React.useEffect(() => {
    const el = ref.current
    if (!el || !rich) return
    let raf = 0
    const move = (e: PointerEvent) => {
      if (el.hasAttribute('data-paused')) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--px', String(e.clientX / window.innerWidth - 0.5))
        el.style.setProperty('--py', String(e.clientY / window.innerHeight - 0.5))
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move)
    }
  }, [rich])
  const h = size * 0.68
  return (
    <div ref={ref} aria-hidden className={cn('paper3d pointer-events-none relative select-none', className)} style={{ width: size, height: h * 1.12 }}>
      <div className="rig" style={{ top: h * 0.06, bottom: h * 0.06 }}>
        <div className="bob [container-type:inline-size]">
          <div className="shadow" />
          <div className="stack">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="ply" style={{ ['--i' as string]: i + 1 }} />
            ))}
          </div>
          <div className="spread">
            <div className="leaf left shadow-[inset_-14px_0_18px_-14px_rgba(0,0,0,0.35)]">
              <Page variant="inside" />
            </div>
            <div className="leaf right shadow-[inset_14px_0_18px_-14px_rgba(0,0,0,0.3)]">
              <Page variant="back" />
            </div>
            <div className="turn">
              <div className="face">
                <Page variant="front" masthead={masthead} />
              </div>
              <div className="face back">
                <Page variant="inside" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
