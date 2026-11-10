import { Check, ChevronRight } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Form guidance: counts the required Field tiles (`.fld[data-req]`) inside a part of the page and
 * keeps the count live with a MutationObserver, so pages need no extra state.
 */
interface Stats {
  total: number
  done: number
  errors: number
  next: HTMLElement | null
}
const EMPTY: Stats = { total: 0, done: 0, errors: 0, next: null }

function read(root: Element): Stats {
  let done = 0
  let next: HTMLElement | null = null
  const req = root.querySelectorAll<HTMLElement>('.fld[data-req]')
  req.forEach((f) => {
    if (f.dataset.state === 'done') done++
    else next ??= f
  })
  return { total: req.length, done, errors: root.querySelectorAll('.fld[data-state="error"]').length, next }
}

function useFieldStats(root: () => Element | null | undefined) {
  const [s, set] = React.useState<Stats>(EMPTY)
  React.useEffect(() => {
    const el = root()
    if (!el) return
    const update = () =>
      set((p) => {
        const n = read(el)
        return n.total === p.total && n.done === p.done && n.errors === p.errors && n.next === p.next ? p : n
      })
    update()
    const mo = new MutationObserver(update)
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'data-req'] })
    return () => mo.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return s
}

const smooth = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

/** Moves the reader to a field tile and puts the caret in it. */
function goToField(tile: Element | null) {
  if (!tile) return
  tile.scrollIntoView({ block: 'center', behavior: smooth() })
  const c = tile.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), button:not(:disabled)')
  c?.focus({ preventScroll: true })
  tile.classList.remove('fld-flash')
  void (tile as HTMLElement).offsetWidth
  tile.classList.add('fld-flash')
}

const labelOf = (tile: Element | null) => tile?.querySelector('.fld-label')?.textContent?.trim() ?? ''

/**
 * "3 of 5 required filled · Next: Mobile". Sits in a form's footer (DialogFooter and FormActions
 * add it on their own). Hidden when the form has no required fields. After a save attempt that
 * leaves errors, it takes the reader to the first one.
 */
export function FormProgress({ className }: { className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null)
  const scope = () => ref.current?.closest('form, [role="dialog"], [data-form-scope]') ?? ref.current?.parentElement?.parentElement
  const s = useFieldStats(scope)

  // A save that ends in errors: go to the first one.
  React.useEffect(() => {
    const root = scope()
    if (!root) return
    let at = 0
    const arm = (e: Event) => {
      if (e.type === 'submit' || (e.target as Element).closest?.('button[type="submit"], .form-actions button, [data-form-footer] button')) at = performance.now()
    }
    const mo = new MutationObserver(() => {
      if (!at || performance.now() - at > 1200) return
      const bad = root.querySelector('.fld[data-state="error"]')
      if (!bad) return
      at = 0
      goToField(bad)
    })
    mo.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-state'] })
    root.addEventListener('submit', arm, true)
    root.addEventListener('click', arm, true)
    return () => {
      mo.disconnect()
      root.removeEventListener('submit', arm, true)
      root.removeEventListener('click', arm, true)
    }
  }, [])

  const complete = s.total > 0 && s.done === s.total
  return (
    <div ref={ref} className={cn('form-progress', !s.total && 'hidden', className)} aria-live="polite">
      {s.total > 0 && (
        <>
          <span className={cn('fp-dial', complete && 'is-done')} style={{ '--p': s.done / s.total } as React.CSSProperties} aria-hidden>
            {complete && <Check className="size-3" strokeWidth={3.2} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold leading-tight text-foreground">
              {complete ? 'All required fields filled' : `${s.done} of ${s.total} required filled`}
            </span>
            {s.errors > 0 ? (
              <span className="block text-[12px] font-medium text-destructive">
                {s.errors === 1 ? '1 field needs a fix' : `${s.errors} fields need a fix`}
              </span>
            ) : !complete && s.next ? (
              <button type="button" className="fp-next" onClick={() => goToField(s.next)}>
                <span className="truncate">Next: {labelOf(s.next)}</span>
                <ChevronRight className="size-3.5 shrink-0" />
              </button>
            ) : (
              <span className="block text-[12px] text-muted-foreground">Ready to save</span>
            )}
          </span>
        </>
      )}
    </div>
  )
}

/** Footer of a form on a page card: progress on the left, the buttons on the right. Sticks to the bottom while the form is long. */
export function FormActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('form-actions', className)} data-form-footer>
      <FormProgress />
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * A numbered part of a long form ("1 Basic details", "2 Contact"). The number turns into a tick
 * once every required field in the part is filled, and a rule joins the parts like a column rule.
 * Grid classes in `className` should use container variants (`@xl:`, `@2xl:`) so they follow the form's width.
 */
export function FormSection({
  n,
  title,
  description,
  children,
  className,
}: {
  n: number
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const ref = React.useRef<HTMLElement>(null)
  const s = useFieldStats(() => ref.current)
  const complete = s.total > 0 && s.done === s.total
  return (
    <div className="form-sec-wrap">
      <section ref={ref} className="form-sec" data-done={complete || undefined} data-error={s.errors > 0 || undefined}>
        <span className="form-sec-num" aria-hidden>
          {complete ? <Check className="size-3.5" strokeWidth={3} /> : n}
        </span>
        <div className="min-w-0">
          <header className="form-sec-head">
            <div className="min-w-0">
              <h4 className="font-display text-[15px] font-semibold leading-tight text-primary">{title}</h4>
              {description && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>}
            </div>
            {s.total > 0 && (
              <span className={cn('form-sec-count', complete && 'is-done')}>
                {s.done}/{s.total}
              </span>
            )}
          </header>
          {/* Columns follow the width of the form (container query), not the screen: the same form fits a side column, a dialog and a full page. */}
          <div className={cn('grid gap-3 @xl:grid-cols-2', className)}>{children}</div>
        </div>
      </section>
    </div>
  )
}
