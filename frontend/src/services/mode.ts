/**
 * `mock` — the in-browser demo server (services/api.ts), no backend needed.
 * `http` — the Django API (backend/); set VITE_API_MODE=http (see `npm run dev:api`).
 */
export const API_MODE: 'mock' | 'http' = import.meta.env.VITE_API_MODE === 'http' ? 'http' : 'mock'
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api'
