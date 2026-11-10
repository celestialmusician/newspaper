import { ChevronUp, Compass, X } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { quickLinks } from '@/app/nav'
import { TONE_INK } from '@/components/ui/misc'
import type { Role } from '@/domain/types'
import { useActor } from '@/hooks/app'
import { cn } from '@/lib/utils'

const TONES = [TONE_INK.accent, TONE_INK.success, TONE_INK.warning, TONE_INK.info, TONE_INK.danger, TONE_INK.navy] as const
type QuickLink = ReturnType<typeof quickLinks>[number]

/**
 * Quick actions, fixed at the bottom centre. Wide screens get the full glass dock; phones, the installed PWA
 * and tablets beside a sidebar get a compact glass pill (above the bottom bar on phones) that opens a grid of
 * the same actions. Portalled to <body> because the page-transition wrapper would otherwise be the
 * containing block of `fixed`.
 */
export function QuickNav() {
  const actor = useActor()
  const links = quickLinks(actor.role as Role)
  if (!links.length) return null
  // Top-menu panels have the whole width from 768px; sidebar panels only have room for the dock from 1024px.
  const wide = actor.role === 'admin' || actor.role === 'agent'
  return createPortal(
    <>
      <Dock links={links} className={wide ? 'md:flex' : 'lg:flex'} />
      {/* Phones use the bottom bar, which is the same glass dock; only sidebar roles on a narrow tablet need the pill. */}
      {!wide && <CompactQuick links={links} className="hidden md:block lg:hidden" />}
    </>,
    document.body,
  )
}

function Chip({ l, i, className }: { l: QuickLink; i: number; className?: string }) {
  return (
    <span className={cn('dock-chip chip-3d relative grid place-items-center overflow-hidden rounded-2xl text-white ring-1 ring-inset ring-white/35', className)} style={{ background: TONES[i % TONES.length] }}>
      <l.icon className="spin3d relative size-[22px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" />
    </span>
  )
}

function Dock({ links, className }: { links: QuickLink[]; className: string }) {
  return (
    <nav aria-label="Quick actions" className={cn('no-print animate-float pointer-events-none fixed inset-x-0 bottom-5 z-30 hidden justify-center transition-[left] duration-300 md:left-[var(--shell-left,0px)]', className)}>
      <ul className="dock-glass pointer-events-auto flex animate-rise items-center gap-1.5 rounded-[28px] px-3.5 py-3">
        <li aria-hidden className="mr-1 hidden items-center gap-2.5 border-r border-white/20 pr-4 xl:flex">
          <span className="grid size-9 place-items-center rounded-full bg-white/15 text-white ring-1 ring-inset ring-white/30">
            <Compass className="size-[18px]" />
          </span>
          <span className="kicker leading-[1.15] text-white/85">
            Quick
            <br />
            actions
          </span>
        </li>
        {links.map((l, i) => (
          <li key={l.to} className="relative">
            <Link to={l.to} aria-label={l.label} className="tile-dock group flex size-[58px] items-center justify-center rounded-2xl">
              <Chip l={l} i={i} className="size-12" />
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-lg bg-popover px-2.5 py-1.5 text-[12.5px] font-semibold text-popover-foreground opacity-0 shadow-pop ring-1 ring-border transition-[opacity,transform] duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
              >
                {l.label}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Phone / PWA / narrow tablet: a glass pill that opens the actions as a labelled grid. */
function CompactQuick({ links, className }: { links: QuickLink[]; className: string }) {
  const [open, setOpen] = React.useState(false)
  const id = React.useId()
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className={cn('quick-compact no-print', className)}>
      {open && <button type="button" aria-label="Close quick actions" className="fixed inset-0 z-40 animate-[fade-in_0.2s_ease-out] bg-black/35" onClick={() => setOpen(false)} />}
      {/* Above the phone bottom bar (60px + safe area); at the bottom edge on tablets, centred on the content. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(60px+env(safe-area-inset-bottom)+12px)] z-40 flex flex-col items-center px-4 md:bottom-[calc(20px+env(safe-area-inset-bottom))] md:left-[var(--shell-left,0px)]">
        {open && (
          <div id={id} role="menu" aria-label="Quick actions" className="dock-glass pointer-events-auto mb-3 origin-bottom animate-[pop-in_0.22s_var(--ease-out-expo)] w-[min(100%,380px)] rounded-[26px] p-3">
            <ul className="grid grid-cols-4 gap-x-1 gap-y-2.5">
              {links.map((l, i) => (
                <li key={l.to}>
                  <Link role="menuitem" to={l.to} onClick={() => setOpen(false)} className="group flex min-h-[98px] flex-col items-center gap-1.5 rounded-2xl px-0.5 pt-1.5 text-center active:scale-95 active:bg-white/10">
                    <Chip l={l} i={i} className="size-12" />
                    {/* The grid is narrow, so the "CRM ·" section prefix is dropped and labels may take three lines. */}
                    <span className="line-clamp-3 text-[11px] font-semibold leading-[1.2] text-white/90">{l.label.replace(/^CRM · /, '')}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="dock-glass pointer-events-auto flex h-12 items-center gap-2.5 rounded-full pl-1.5 pr-4 text-[13.5px] font-semibold text-white active:scale-95"
        >
          <span className="grid size-9 place-items-center rounded-full bg-white/15 ring-1 ring-inset ring-white/30">
            {open ? <X className="size-[18px]" /> : <Compass className="size-[18px]" />}
          </span>
          Quick actions
          <ChevronUp className={cn('size-4 text-white/70 transition-transform duration-300', open && 'rotate-180')} />
        </button>
      </div>
    </div>
  )
}
