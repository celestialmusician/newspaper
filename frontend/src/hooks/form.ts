import * as React from 'react'

export type Errors<T> = Partial<Record<keyof T, string>>

/** Tiny form state helper: values, per-field errors, and submit-time validation. */
export function useForm<T extends Record<string, unknown>>(initial: T, validate: (v: T) => Errors<T>) {
  const [values, setValues] = React.useState<T>(initial)
  const [errors, setErrors] = React.useState<Errors<T>>({})
  const [submitted, setSubmitted] = React.useState(false)

  const set = React.useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e))
  }, [])

  const patch = React.useCallback((p: Partial<T>) => setValues((v) => ({ ...v, ...p })), [])

  const check = () => {
    const e = validate(values)
    const clean = Object.fromEntries(Object.entries(e).filter(([, m]) => m)) as Errors<T>
    setErrors(clean)
    setSubmitted(true)
    return Object.keys(clean).length === 0
  }

  /** Current validation result without touching the shown errors. */
  const peek = () => Object.fromEntries(Object.entries(validate(values)).filter(([, m]) => m)) as Errors<T>

  /** Validate and show errors for these fields only (one step of a multi-step form). */
  const checkKeys = (keys: (keyof T)[]) => {
    const clean = Object.fromEntries(Object.entries(peek()).filter(([k]) => keys.includes(k as keyof T))) as Errors<T>
    setErrors(clean)
    return Object.keys(clean).length === 0
  }

  const reset = (v: T = initial) => {
    setValues(v)
    setErrors({})
    setSubmitted(false)
  }

  return { values, set, patch, errors, check, peek, checkKeys, reset, submitted, setValues }
}

export const rules = {
  required: (v: unknown, label: string) => (v === undefined || v === null || (typeof v === 'string' && !v.trim()) ? `${label} is required.` : undefined),
  mobile: (v: string, required = true) => (!v ? (required ? 'Mobile number is required.' : undefined) : /^[6-9]\d{9}$/.test(v) ? undefined : 'Enter a valid 10-digit Indian mobile number.'),
  email: (v?: string) => (!v ? undefined : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? undefined : 'Enter a valid email address.'),
  positive: (v: number, label: string) => (Number.isFinite(v) && v > 0 ? undefined : `${label} must be greater than zero.`),
  nonNegative: (v: number, label: string) => (Number.isFinite(v) && v >= 0 ? undefined : `${label} cannot be negative.`),
}
