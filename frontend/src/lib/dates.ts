import { addDays, differenceInCalendarDays, endOfMonth, format, parseISO, startOfMonth, getDaysInMonth } from 'date-fns'
import type { ISODate } from '@/domain/types'

export const toISO = (d: Date): ISODate => format(d, 'yyyy-MM-dd')
export const fromISO = (s: ISODate) => parseISO(s)
export const todayISO = () => toISO(new Date())
export const nowISO = () => new Date().toISOString()

export const addDaysISO = (s: ISODate, n: number) => toISO(addDays(fromISO(s), n))
export const diffDays = (a: ISODate, b: ISODate) => differenceInCalendarDays(fromISO(a), fromISO(b))
export const monthStartISO = (s: ISODate) => toISO(startOfMonth(fromISO(s)))
export const monthEndISO = (s: ISODate) => toISO(endOfMonth(fromISO(s)))
export const daysInMonth = (s: ISODate) => getDaysInMonth(fromISO(s))
export const weekday = (s: ISODate) => fromISO(s).getDay()
export const dayOfMonth = (s: ISODate) => fromISO(s).getDate()

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = []
  const n = diffDays(to, from)
  for (let i = 0; i <= n; i++) out.push(addDaysISO(from, i))
  return out
}

export const fmtDate = (s?: ISODate | null) => (s ? format(fromISO(s), 'dd MMM yyyy') : '—')
export const fmtShort = (s: ISODate) => format(fromISO(s), 'dd MMM')
export const fmtMonth = (s: ISODate) => format(fromISO(s), 'MMMM yyyy')
export const fmtDateTime = (s?: string | null) => (s ? format(new Date(s), 'dd MMM yyyy, h:mm a') : '—')
export const fmtTime = (s?: string | null) => (s ? format(new Date(s), 'h:mm a') : '—')
export const fmtWeekday = (s: ISODate) => format(fromISO(s), 'EEEE')

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const isBetween = (d: ISODate, from: ISODate, to: ISODate | null) => d >= from && (to === null || d <= to)

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`
  return format(new Date(iso), 'dd MMM')
}
