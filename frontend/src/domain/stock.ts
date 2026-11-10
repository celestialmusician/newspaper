import type { DB } from './db'
import { demandByProduct } from './schedule'
import type { ID, ISODate, StockEntry } from './types'

/**
 * Stock ledger maths.
 *   Available  = opening + received
 *   Remaining  = opening + received − distributed + returned − damaged
 * "Distributed" is derived from delivered records, so a copy is never deducted twice.
 */
export const available = (e: StockEntry) => e.opening + e.received
export const remaining = (e: StockEntry) => e.opening + e.received - e.distributed + e.returned - e.damaged

export function entriesOn(db: DB, date: ISODate, agentId?: ID) {
  return Object.values(db.stock).filter((e) => e.date === date && (!agentId || e.agentId === agentId))
}

export interface StockAlert {
  entry: StockEntry
  demand: number
  shortBy: number
  productName: string
  agentName: string
}

/** Low stock = copies on hand below today's scheduled demand, or remaining below the product threshold. */
export function lowStock(db: DB, date: ISODate, agentId?: ID): StockAlert[] {
  const out: StockAlert[] = []
  const agents = agentId ? db.agents.filter((a) => a.id === agentId) : db.agents
  for (const a of agents) {
    const custIds = new Set(db.customers.filter((c) => c.agentId === a.id).map((c) => c.id))
    const demand = demandByProduct(db, db.subscriptions.filter((s) => custIds.has(s.customerId)), date)
    for (const e of entriesOn(db, date, a.id)) {
      const prod = db.products.find((p) => p.id === e.productId)
      if (!prod) continue
      const need = demand.get(e.productId) ?? 0
      const shortBy = need - (available(e) + e.returned - e.damaged)
      const rem = remaining(e)
      if (shortBy > 0 || (rem < prod.lowStockThreshold && prod.type !== 'Newspaper')) {
        out.push({ entry: e, demand: need, shortBy: Math.max(0, shortBy), productName: prod.name, agentName: a.name })
      }
    }
  }
  return out
}

export function previousRemaining(db: DB, date: ISODate, productId: ID, agentId: ID) {
  const prev = Object.values(db.stock)
    .filter((e) => e.productId === productId && e.agentId === agentId && e.date < date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]
  return prev ? remaining(prev) : 0
}
