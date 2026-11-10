import * as React from 'react'
import { toast } from 'sonner'
import { agentsFor, can, customersFor, executivesFor, routesFor, type Action, type Actor } from '@/domain/access'
import { canOpen } from '@/domain/staff'
import type { RollAction } from '@/domain/types'
import { ApiError } from '@/services/api'
import { useDB, useSession } from '@/services/store'

export const useData = () => useDB((s) => s.db)

export function useActor(): Actor {
  const s = useSession((x) => x.session)
  if (!s) throw new Error('No session')
  return { role: s.role, userId: s.userId, ...(s.staffId ? { staffId: s.staffId } : {}) }
}

export function useCan(action: Action, verb?: RollAction) {
  const db = useData()
  const actor = useActor()
  return can(db, actor, action, verb)
}

/** For staff users: which pages their User Roll opens (owners and everyone else: all pages their role has). */
export function useCanOpen() {
  const db = useData()
  const { staffId } = useActor()
  return React.useCallback((path: string) => canOpen(db, { staffId }, path), [db, staffId])
}

/** Everything the current user may see, already scoped by role. */
export function useScope() {
  const db = useData()
  const actor = useActor()
  return React.useMemo(() => {
    const customers = customersFor(db, actor)
    const ids = new Set(customers.map((c) => c.id))
    return {
      db,
      actor,
      customers,
      customerIds: ids,
      routes: routesFor(db, actor),
      executives: executivesFor(db, actor),
      agents: agentsFor(db, actor),
      subscriptions: db.subscriptions.filter((s) => ids.has(s.customerId)),
      invoices: db.invoices.filter((i) => ids.has(i.customerId)),
      payments: db.payments.filter((p) => ids.has(p.customerId)),
      complaints: db.complaints.filter((c) => ids.has(c.customerId)),
    }
  }, [db, actor.role, actor.userId]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function errorMessage(e: unknown) {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong. Please try again.'
}

/**
 * Wraps an API call with pending state + success / error toasts.
 * Resolves to the result (or `true` for void calls) on success, `undefined` on failure.
 */
export function useRun() {
  const [pending, setPending] = React.useState(false)
  const run = React.useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<(T extends void ? true : T) | undefined> => {
    setPending(true)
    try {
      const r = await fn()
      if (success) toast.success(typeof success === 'function' ? success(r) : success)
      return (r === undefined ? true : r) as T extends void ? true : T
    } catch (e) {
      toast.error(errorMessage(e))
      return undefined
    } finally {
      setPending(false)
    }
  }, [])
  return { run, pending }
}

/** Brief skeleton on first mount so screens don't flash — mirrors real network latency. */
export function useWarmup(ms = 260) {
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    const t = setTimeout(() => setReady(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return ready
}

export function useMediaQuery(q: string) {
  const [m, setM] = React.useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  React.useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

export function useMyNotifications() {
  const db = useData()
  const actor = useActor()
  return React.useMemo(
    () => db.notifications.filter((n) => n.to === actor.userId || n.to === `role:${actor.role}`).sort((a, b) => b.at.localeCompare(a.at)),
    [db.notifications, actor.userId, actor.role],
  )
}
