import { create } from 'zustand'
import { nowISO } from '@/lib/dates'
import { uid } from '@/lib/utils'
import { ApiError, deliveries, payments, type MarkInput, type PaymentInput } from './api'
import { getSession } from './store'

/**
 * Offline-first queue for field work (delivery marks + cash collection).
 * Each operation carries an idempotency key generated at the moment of the tap,
 * so replays after reconnect — or double taps — can never create duplicates.
 * Only ids / amounts are queued: no payment credentials, no addresses.
 */

export type QueueItem =
  | { id: string; kind: 'delivery'; payload: MarkInput; createdAt: string; error?: string; label: string }
  | { id: string; kind: 'payment'; payload: PaymentInput; createdAt: string; error?: string; label: string }

interface NetState {
  browserOnline: boolean
  forcedOffline: boolean
  queue: QueueItem[]
  syncing: boolean
  lastSync: string | null
}

const qKey = () => `nap.queue.${getSession()?.userId ?? 'anon'}`
const loadQueue = (): QueueItem[] => {
  try {
    return JSON.parse(localStorage.getItem(qKey()) ?? '[]') as QueueItem[]
  } catch {
    return []
  }
}
const saveQueue = (q: QueueItem[]) => {
  try {
    localStorage.setItem(qKey(), JSON.stringify(q))
  } catch {
    /* ignore */
  }
}

export const useNetwork = create<NetState>(() => ({
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  forcedOffline: false,
  queue: loadQueue(),
  syncing: false,
  lastSync: null,
}))

export const isOnline = () => {
  const s = useNetwork.getState()
  return s.browserOnline && !s.forcedOffline
}

function setQueue(q: QueueItem[]) {
  saveQueue(q)
  useNetwork.setState({ queue: q })
}

export function reloadQueue() {
  useNetwork.setState({ queue: loadQueue() })
}

function queueDelivery(payload: MarkInput, label: string): 'queued' {
  // Latest tap wins for the same delivery slot while offline.
  const q = useNetwork.getState().queue.filter((x) => !(x.kind === 'delivery' && x.payload.subscriptionId === payload.subscriptionId && x.payload.date === payload.date))
  setQueue([...q, { id: uid('q'), kind: 'delivery', payload: { ...payload, fromOffline: true }, createdAt: nowISO(), label }])
  return 'queued'
}

function queuePayment(input: PaymentInput, label: string): 'queued' {
  if (useNetwork.getState().queue.some((x) => x.kind === 'payment' && x.payload.idempotencyKey === input.idempotencyKey)) return 'queued'
  setQueue([...useNetwork.getState().queue, { id: uid('q'), kind: 'payment', payload: { ...input, fromOffline: true }, createdAt: nowISO(), label }])
  return 'queued'
}

export async function markDelivery(input: Omit<MarkInput, 'idempotencyKey'>, label: string): Promise<'done' | 'queued'> {
  const payload: MarkInput = { ...input, idempotencyKey: uid('dlv') }
  if (!isOnline()) return queueDelivery(payload, label)
  try {
    await deliveries.mark(payload)
  } catch (e) {
    // Signal says online but the server is unreachable: keep the tap, sync later.
    if (e instanceof ApiError && e.code === 'network') return queueDelivery(payload, label)
    throw e
  }
  return 'done'
}

export async function collectPayment(input: PaymentInput, label: string): Promise<'done' | 'queued'> {
  if (!isOnline()) return queuePayment(input, label)
  try {
    await payments.collect(input)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'network') return queuePayment(input, label)
    throw e
  }
  return 'done'
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const st = useNetwork.getState()
  if (st.syncing || !isOnline() || !st.queue.length || !getSession()) return { synced: 0, failed: 0 }
  useNetwork.setState({ syncing: true })
  let synced = 0
  let failed = 0
  const remaining: QueueItem[] = []
  for (const item of st.queue) {
    try {
      if (item.kind === 'delivery') await deliveries.mark(item.payload)
      else await payments.collect(item.payload)
      synced++
    } catch (e) {
      failed++
      remaining.push({ ...item, error: e instanceof Error ? e.message : 'Sync failed — will retry.' })
    }
  }
  setQueue(remaining)
  useNetwork.setState({ syncing: false, lastSync: nowISO() })
  return { synced, failed }
}

export function discardQueued(id: string) {
  setQueue(useNetwork.getState().queue.filter((x) => x.id !== id))
}

export function setForcedOffline(v: boolean) {
  useNetwork.setState({ forcedOffline: v })
  if (!v) void flushQueue()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useNetwork.setState({ browserOnline: true })
    void flushQueue()
  })
  window.addEventListener('offline', () => useNetwork.setState({ browserOnline: false }))
}
