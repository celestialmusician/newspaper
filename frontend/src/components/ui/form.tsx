import { AlertCircle, Check, ChevronDown } from 'lucide-react'
import { Popover as PP } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/lib/utils'

import { Combobox } from './combobox'
import { DatePicker, MonthPicker } from './date-picker'
import { fieldBase } from './field-style'

/** Text field. `type="date"` and `type="month"` open the themed calendar instead of the browser's picker. */
export function Input({ className, type, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  if (type === 'date') return <DatePicker className={className} {...props} />
  if (type === 'month') return <MonthPicker className={className} {...props} />
  return <input type={type} className={cn(fieldBase, 'h-11', className)} {...props} />
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'min-h-[84px] py-2.5', className)} {...props} />
}

interface SelectOpt {
  value: string
  label: React.ReactNode
  text: string
  disabled?: boolean
}

function textOf(n: React.ReactNode): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (React.isValidElement(n)) return textOf((n.props as { children?: React.ReactNode }).children)
  return ''
}

/** Reads <option> children so every existing call site keeps its markup. */
function collectOptions(children: React.ReactNode, out: SelectOpt[] = []): SelectOpt[] {
  React.Children.forEach(children, (c) => {
    if (!React.isValidElement(c)) return
    const p = c.props as { value?: string | number; disabled?: boolean; children?: React.ReactNode }
    if (c.type === 'option') {
      const text = textOf(p.children)
      out.push({ value: p.value == null ? text : String(p.value), label: p.children, text, disabled: p.disabled })
    } else if (c.type === 'optgroup' || c.type === React.Fragment) collectOptions(p.children, out)
  })
  return out
}

/**
 * Themed dropdown. Same props as a native <select> (value, onChange(e.target.value), <option> children),
 * but the list is drawn in the theme and unfolds like a sheet of newsprint: the panel folds open from the
 * field, a masthead rule draws across the top and the options rise in one by one.
 */
export function NativeSelect({ className, children, value, onChange, disabled, id, name, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const uid = React.useId()
  const [open, setOpen] = React.useState(false)
  const [active, setActive] = React.useState(-1)
  const listRef = React.useRef<HTMLUListElement>(null)
  const typed = React.useRef({ s: '', t: 0 })

  const opts = collectOptions(children)
  const cur = value == null ? '' : String(value)
  const selected = opts.find((o) => o.value === cur)
  const isPlaceholder = !selected || (selected.value === '' && !!selected.disabled)
  const list = opts.filter((o) => !(o.value === '' && o.disabled))

  const pick = (o: SelectOpt) => {
    if (o.disabled) return
    setOpen(false)
    if (o.value === cur) return
    const t = { value: o.value, name, id }
    onChange?.({ target: t, currentTarget: t } as unknown as React.ChangeEvent<HTMLSelectElement>)
  }

  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < list.length; i += dir) if (!list[i]!.disabled) return i
    return from
  }

  const onOpenChange = (next: boolean) => {
    if (next) {
      const at = list.findIndex((o) => o.value === cur)
      setActive(at >= 0 ? at : step(-1, 1))
    }
    setOpen(next)
  }

  // Keep the highlighted row inside the scroll area.
  React.useEffect(() => {
    const ul = listRef.current
    const el = ul?.children[active] as HTMLElement | undefined
    if (!ul || !el) return
    if (el.offsetTop < ul.scrollTop) ul.scrollTop = el.offsetTop - 4
    else if (el.offsetTop + el.offsetHeight > ul.scrollTop + ul.clientHeight) ul.scrollTop = el.offsetTop + el.offsetHeight - ul.clientHeight + 4
  }, [active, open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key
    if (k === 'ArrowDown') setActive((a) => step(a, 1))
    else if (k === 'ArrowUp') setActive((a) => step(a, -1))
    else if (k === 'Home') setActive(step(-1, 1))
    else if (k === 'End') setActive(step(list.length, -1))
    else if (k === 'Enter' || k === ' ') {
      const o = list[active]
      if (o) pick(o)
    } else if (k === 'Tab') setOpen(false)
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now()
      typed.current.s = (now - typed.current.t < 600 ? typed.current.s : '') + k.toLowerCase()
      typed.current.t = now
      const from = typed.current.s.length === 1 ? active + 1 : active
      const hit = [...list.slice(from), ...list.slice(0, from)].find((o) => !o.disabled && o.text.toLowerCase().startsWith(typed.current.s))
      if (hit) setActive(list.indexOf(hit))
    } else return
    e.preventDefault()
  }

  return (
    <PP.Root open={open} onOpenChange={onOpenChange}>
      <PP.Trigger asChild disabled={disabled}>
        <button
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${uid}-list`}
          onKeyDown={(e) => {
            if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
              e.preventDefault()
              onOpenChange(true)
            }
          }}
          className={cn(fieldBase, 'group h-11 cursor-pointer items-center justify-between gap-2 text-left data-[state=open]:border-masthead/60 data-[state=open]:ring-4 data-[state=open]:ring-ring/15', className)}
        >
          <span className={cn('truncate', isPlaceholder && 'text-muted-foreground/70')}>{selected ? selected.label : ' '}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-[transform,color] duration-300 ease-spring group-data-[state=open]:rotate-180 group-data-[state=open]:text-masthead" />
        </button>
      </PP.Trigger>
      {name && <input type="hidden" name={name} value={cur} />}
      <PP.Portal>
        <PP.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            listRef.current?.focus({ preventScroll: true })
          }}
          className="sel-pop glass-pop z-50 overflow-hidden rounded-2xl border p-1.5 text-popover-foreground shadow-pop outline-none"
          style={{ width: 'max(var(--radix-popover-trigger-width), 11rem)', maxWidth: 'calc(100vw - 16px)' }}
        >
          <ul
            ref={listRef}
            id={`${uid}-list`}
            role="listbox"
            tabIndex={-1}
            aria-activedescendant={active >= 0 ? `${uid}-${active}` : undefined}
            onKeyDown={onKeyDown}
            className="sel-list relative max-h-[min(18rem,var(--radix-popover-content-available-height))] overflow-y-auto overflow-x-hidden overscroll-contain px-0.5 outline-none"
          >
            {list.map((o, i) => (
              <li
                key={`${o.value}-${i}`}
                id={`${uid}-${i}`}
                role="option"
                aria-selected={o.value === cur}
                aria-disabled={o.disabled || undefined}
                data-active={i === active}
                style={{ '--i': Math.min(i, 9) } as React.CSSProperties}
                onMouseMove={() => !o.disabled && i !== active && setActive(i)}
                onClick={() => pick(o)}
                className="sel-opt"
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === cur && (
                  <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-masthead" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path className="check-draw" d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </li>
            ))}
          </ul>
        </PP.Content>
      </PP.Portal>
    </PP.Root>
  )
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-semibold text-foreground/85', className)} {...props} />
}

interface FieldProps {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: string
  required?: boolean
  className?: string
  htmlFor?: string
  children: React.ReactNode
}

/** Controls a Field can wire up: it gives them an id (so the label opens them), the hint/error as their description, and reads their value. */
const CONTROLS = new Set<unknown>([Input, Textarea, NativeSelect, Combobox, DatePicker, MonthPicker, 'input', 'textarea', 'select'])

type Wiring = { id: string; describedBy?: string; required?: boolean; found?: React.ReactElement }

/** Finds the first control inside the Field (also when it sits in a wrapper, like the +91 prefix) and wires it. */
function wire(node: React.ReactNode, w: Wiring): React.ReactNode {
  return React.Children.map(node, (child) => {
    if (w.found || !React.isValidElement(child)) return child
    const p = child.props as Record<string, unknown> & { children?: React.ReactNode }
    if (CONTROLS.has(child.type)) {
      w.found = child
      if (typeof p.id === 'string') w.id = p.id
      return React.cloneElement(child, {
        id: w.id,
        'aria-describedby': [p['aria-describedby'], w.describedBy].filter(Boolean).join(' ') || undefined,
        'aria-required': p['aria-required'] ?? (w.required || undefined),
      } as Record<string, unknown>)
    }
    if (p.children == null || typeof child.type !== 'string') return child
    const next = wire(p.children, w)
    return w.found ? React.cloneElement(child, undefined, next) : child
  })
}

/**
 * Form field as a "tile": the label sits inside the box, above the value, so it never disappears
 * and the whole tile is one click target. The top-right corner says where the field stands:
 * "Required" until it is filled, a tick once it is, a warning when it has an error.
 * The hint or error sits under the tile. Forms count the tiles to show progress (FormProgress).
 */
export function Field({ label, hint, error, required, className, htmlFor, children }: FieldProps) {
  const uid = React.useId()
  const msgId = error || hint ? `${uid}-msg` : undefined
  const w: Wiring = { id: htmlFor ?? `${uid}-ctl`, describedBy: msgId, required }
  const body = wire(children, w)
  const value = (w.found?.props as { value?: unknown } | undefined)?.value
  const filled = value != null && String(value).trim() !== ''
  const state = error ? 'error' : required ? (filled ? 'done' : 'todo') : filled ? 'filled' : 'empty'

  // Clicks on the tile's padding go to the control (label clicks already do).
  const onTileClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t.closest('a, button, input, textarea, select, label[for], [role], [tabindex]')) return
    const c = e.currentTarget.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])')
    if (!c) return
    if (c.tagName === 'BUTTON' && c.hasAttribute('aria-haspopup')) c.click()
    else c.focus()
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="fld" data-state={state} data-req={required || undefined} data-labelled={label ? '' : undefined} onClick={onTileClick}>
        {label && (
          <div className="fld-head">
            <label htmlFor={w.found || htmlFor ? w.id : undefined} className="fld-label">
              {label}
            </label>
            {state === 'error' ? (
              <AlertCircle className="fld-icon size-4 shrink-0 text-destructive" aria-hidden />
            ) : state === 'done' ? (
              <span className="fld-ok" aria-hidden>
                <Check className="size-3" strokeWidth={3.2} />
              </span>
            ) : state === 'todo' ? (
              <span className="fld-tag">Required</span>
            ) : null}
          </div>
        )}
        <div className="fld-body">{body}</div>
      </div>
      {error ? (
        <p id={msgId} role="alert" className="fld-msg is-error">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="fld-msg">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2.5 text-sm', className)}>
      <input type="checkbox" className="size-[18px] cursor-pointer rounded accent-[var(--brand)]" {...props} />
      {label}
    </label>
  )
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-3 text-sm', disabled && 'opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-300', checked ? 'bg-brand-gradient' : 'bg-input')}
      >
        <span className={cn('absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-300 ease-spring', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
      {label}
    </label>
  )
}

/** Segmented toggle for small option sets (weekdays, views). */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
  multiple,
}: {
  value: T | T[]
  onChange: (v: T) => void
  options: { value: T; label: React.ReactNode }[]
  className?: string
  multiple?: boolean
}) {
  const isOn = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v)
  return (
    <div className={cn('inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1', className)} role={multiple ? 'group' : 'radiogroup'}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role={multiple ? 'checkbox' : 'radio'}
          aria-checked={isOn(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-9 rounded-lg px-3 text-[13px] font-semibold transition-all',
            isOn(o.value) ? 'bg-card text-primary shadow-card ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
