import { Delete } from 'lucide-react'
import * as React from 'react'
import { cn } from '@/lib/utils'

/** Segmented numeric code input (OTP / MPIN). Opens the numeric keypad on phones. */
export function PinInput({
  length,
  value,
  onChange,
  onComplete,
  masked,
  autoFocus,
  invalid,
  label,
}: {
  length: number
  value: string
  onChange: (v: string) => void
  onComplete?: (v: string) => void
  masked?: boolean
  autoFocus?: boolean
  invalid?: boolean
  label: string
}) {
  const ref = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  const set = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length) onComplete?.(clean)
  }
  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        inputMode="numeric"
        autoComplete={masked ? 'off' : 'one-time-code'}
        pattern="\d*"
        maxLength={length}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className={cn('flex justify-center gap-2 sm:gap-3', invalid && 'animate-[shake_0.4s_ease-in-out]')}>
        {Array.from({ length }).map((_, i) => {
          const ch = value[i]
          const active = i === Math.min(value.length, length - 1)
          const next = i === value.length
          return (
            <div
              key={i}
              className={cn(
                'grid h-14 min-w-0 max-w-14 flex-1 place-items-center rounded-xl border-2 [@media(max-height:760px)]:h-12 bg-card font-display text-[28px] font-semibold text-primary transition-[border-color,box-shadow,transform] duration-200 ease-out-expo sm:h-16 sm:max-w-15',
                invalid ? 'border-destructive/70' : ch ? 'border-rule' : active ? '-translate-y-0.5 border-[var(--brand)] shadow-[0_12px_28px_-12px_var(--glow)] ring-4 ring-ring/15' : 'border-input',
              )}
            >
              {ch ? masked ? <span className="animate-pop size-3.5 rounded-full bg-primary" /> : <span className="animate-pop">{ch}</span> : next ? <span aria-hidden className="pin-caret" /> : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Large on-screen keypad — easier for elderly users and gloves-on delivery staff. */
export function Keypad({ onDigit, onBackspace, className }: { onDigit: (d: string) => void; onBackspace: () => void; className?: string }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']
  return (
    <div className={cn('mx-auto grid max-w-[300px] grid-cols-3 gap-2.5 [@media(max-height:760px)]:gap-2', className)}>
      {keys.map((k, i) =>
        k === '' ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (k === 'del' ? onBackspace() : onDigit(k))}
            aria-label={k === 'del' ? 'Delete' : k}
            className="glass-tint grid h-14 [@media(max-height:760px)]:h-11 place-items-center rounded-xl border font-display text-[22px] font-semibold text-primary transition-[transform,background-color] duration-100 active:scale-90 active:bg-accent"
          >
            {k === 'del' ? <Delete className="size-5" /> : k}
          </button>
        ),
      )}
    </div>
  )
}
