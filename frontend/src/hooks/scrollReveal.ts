import * as React from 'react'
import { useRichMotion } from '@/app/theme'

const SELECTOR = '.row-drop, .press-line'

/**
 * Scroll reveal for list rows (`.row-drop`) and card headlines (`.press-line`) inside `root`.
 * Each element is marked `data-in` the first time it enters the screen; the CSS in index.css
 * animates that change. Elements that are already on screen when they appear (first paint,
 * a new page of a table, search results) are marked at once so they never flash.
 * Off when effects are "lite" or the reader prefers reduced motion: then nothing is hidden.
 */
export function useScrollReveal(root: React.RefObject<HTMLElement | null>) {
  const rich = useRichMotion()
  React.useEffect(() => {
    const host = root.current
    if (!rich || !host || typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return
    const html = document.documentElement
    html.dataset.reveal = ''
    const timers = new Set<number>()

    const show = (el: HTMLElement, i: number) => {
      el.style.setProperty('--ri', String(Math.min(i, 8)))
      el.dataset.in = ''
      // Once settled, drop the staggered transition so hover effects respond at once.
      const t = window.setTimeout(() => {
        el.dataset.in = 'done'
        el.style.removeProperty('--ri')
        timers.delete(t)
      }, 1500 + i * 60)
      timers.add(t)
    }

    // A headline hidden by clip-path never reports as intersecting, so its parent is watched instead.
    const watched = new Map<Element, HTMLElement[]>()
    const io = new IntersectionObserver(
      (entries) => {
        let i = 0
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.unobserve(e.target)
          for (const el of watched.get(e.target) ?? []) show(el, i++)
          watched.delete(e.target)
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.1 },
    )

    const track = (el: HTMLElement) => {
      if (el.dataset.in !== undefined) return
      const r = el.getBoundingClientRect()
      // Visible already (or laid out off to the side, like the desktop table on a phone): show now.
      if (r.height && r.bottom > 0 && r.top < window.innerHeight) {
        el.dataset.in = 'done'
        return
      }
      const target = el.classList.contains('press-line') && el.parentElement ? el.parentElement : el
      const list = watched.get(target)
      if (list) list.push(el)
      else {
        watched.set(target, [el])
        io.observe(target)
      }
    }
    const scan = (node: ParentNode) => {
      if (node instanceof HTMLElement && node.matches(SELECTOR)) track(node)
      node.querySelectorAll<HTMLElement>(SELECTOR).forEach(track)
    }

    scan(host)
    const mo = new MutationObserver((records) => {
      for (const rec of records) rec.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n))
    })
    mo.observe(host, { childList: true, subtree: true })

    return () => {
      mo.disconnect()
      io.disconnect()
      watched.clear()
      timers.forEach((t) => window.clearTimeout(t))
      delete html.dataset.reveal
      host.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
        el.dataset.in = 'done'
        el.style.removeProperty('--ri')
      })
    }
  }, [root, rich])
}
