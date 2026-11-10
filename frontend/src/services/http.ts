/**
 * REST transport for the Django API (backend/). Used by services/remote.ts when
 * VITE_API_MODE=http. Adds the JWT, refreshes it once on 401, and turns DRF error
 * bodies into the same ApiError the demo server throws, so screens behave identically.
 */
import { ApiError } from './api'
import { API_BASE } from './mode'
import { getSession, setSession } from './store'

/** First human-readable message in a DRF error body ({detail} or {field: [msg]}). */
function messageOf(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    if (typeof b.detail === 'string') return b.detail
    for (const v of Object.values(b)) {
      if (typeof v === 'string') return v
      if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
      if (v && typeof v === 'object') {
        const inner = messageOf(v, status)
        if (inner) return inner
      }
    }
  }
  if (status >= 500) return 'The server had a problem. Please try again in a moment.'
  return `Request failed (${status}).`
}

function codeOf(status: number, message: string) {
  if (/verification expired/i.test(message)) return 'expired'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  return 'invalid'
}

let refreshing: Promise<boolean> | null = null
async function refreshToken(): Promise<boolean> {
  const s = getSession()
  if (!s?.refresh) return false
  refreshing ??= fetch(`${API_BASE}/auth/refresh/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: s.refresh }) })
    .then(async (r) => {
      if (!r.ok) return false
      const t = (await r.json()) as { access: string; refresh?: string }
      const cur = getSession()
      if (cur) setSession({ ...cur, token: t.access, refresh: t.refresh ?? cur.refresh })
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

export interface HttpInit extends Omit<RequestInit, 'body'> {
  json?: unknown
  /** Use this bearer token instead of the session's (during sign-in). */
  token?: string
}

export async function http<T>(path: string, init: HttpInit = {}, retried = false): Promise<T> {
  const { json, token, ...rest } = init
  const headers = new Headers(rest.headers)
  const bearer = token ?? getSession()?.token
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  if (json !== undefined) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : undefined })
  } catch {
    throw new ApiError('Cannot reach the NewsRound server. Check your connection and try again.', 'network')
  }
  if (res.status === 401 && !token && !retried && (await refreshToken())) return http<T>(path, init, true)
  const body = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    const msg = messageOf(body, res.status)
    if (res.status === 401 && !token) setSession(null) // session expired everywhere: back to sign-in
    throw new ApiError(msg, codeOf(res.status, msg))
  }
  return body as T
}
