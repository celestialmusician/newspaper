import { eachDay, todayISO } from '@/lib/dates'
import { round2, sum } from '@/lib/utils'
import type { DB } from './db'
import { activeDiscounts, discountAmount, resolvePrice } from './pricing'
import { isPausedOn, matchesFrequency, qtyOn } from './schedule'
import type { ID, ISODate, Invoice, InvoiceLine, InvoiceStatus, Payment } from './types'

/**
 * Automatic invoice generation.
 * Quantity comes from the generated schedule (frequency × window − paused days).
 * Holidays / strikes are deliberately NOT deducted: subscriptions bill at the fixed rate;
 * any concession is an explicit, approved adjustment.
 * Each line snapshots unit/agent/purchase price so later price edits never alter history.
 */

export interface InvoiceDraft {
  lines: InvoiceLine[]
  subtotal: number
  discount: number
  discountNotes: string[]
  handlingCharge: number
  currentBill: number
  previousBalance: number
}

export function invoiceRemaining(inv: Invoice) {
  return round2(Math.max(0, inv.currentBill - inv.paid))
}

export function invoiceStatus(currentBill: number, paid: number): InvoiceStatus {
  if (paid <= 0.004) return currentBill <= 0 ? 'paid' : 'unpaid'
  return paid + 0.004 >= currentBill ? 'paid' : 'partial'
}

export function customerOutstanding(db: Pick<DB, 'invoices'>, customerId: ID) {
  return sum(db.invoices.filter((i) => i.customerId === customerId).map(invoiceRemaining))
}

export function isOverdue(inv: Invoice, today = todayISO()) {
  return inv.dueDate < today && invoiceRemaining(inv) > 0
}

export function draftInvoice(db: DB, customerId: ID, from: ISODate, to: ISODate): InvoiceDraft {
  const customer = db.customers.find((c) => c.id === customerId)
  if (!customer) throw new Error('Customer not found')
  const subs = db.subscriptions.filter((s) => s.customerId === customerId)
  const lines: InvoiceLine[] = []
  const lineDiscounts: { subId: ID; amount: number }[] = []
  const discounts = activeDiscounts(db, customerId, from, to)
  const discountNotes: string[] = []

  for (const sub of subs) {
    const product = db.products.find((p) => p.id === sub.productId)
    if (!product) continue
    // Group billable dates by resolved price so a mid-period price change is billed correctly.
    const segments = new Map<string, { deliveries: number; copies: number; unit: number; agent: number; purchase: number }>()
    // Customers flagged Sub-agent are billed at the sub-agent rate unless the agency switched that off in Rate Setting.
    const subAgentRate = !!customer.subAgent && db.agents.find((a) => a.id === customer.agentId)?.subAgentBilling !== false
    for (const date of eachDay(from, to)) {
      if (!matchesFrequency(sub, date) || isPausedOn(sub, date)) continue
      const price = resolvePrice(db, sub.productId, date, customer.agentId)
      if (!price) continue
      const unit = subAgentRate ? price.agentPrice : price.customerPrice
      const k = `${unit}|${price.agentPrice}|${price.purchasePrice}`
      const seg = segments.get(k) ?? { deliveries: 0, copies: 0, unit, agent: price.agentPrice, purchase: price.purchasePrice }
      seg.deliveries++
      seg.copies += qtyOn(sub, date)
      segments.set(k, seg)
    }
    let subTotal = 0
    for (const seg of segments.values()) {
      const quantity = seg.copies
      const amount = round2(quantity * seg.unit)
      subTotal += amount
      lines.push({
        subscriptionId: sub.id,
        productId: product.id,
        productName: product.name,
        quantity,
        deliveries: seg.deliveries,
        unitPrice: seg.unit,
        agentPrice: seg.agent,
        purchasePrice: seg.purchase,
        amount,
      })
    }
    for (const d of discounts.filter((d) => d.subscriptionId === sub.id)) {
      const amt = discountAmount(d, subTotal)
      if (amt > 0) {
        lineDiscounts.push({ subId: sub.id, amount: amt })
        discountNotes.push(`${product.name}: ${d.kind === 'percentage' ? `${d.value}%` : `₹${d.value}`} (${d.category})`)
      }
    }
  }

  const subtotal = sum(lines.map((l) => l.amount))
  let discount = sum(lineDiscounts.map((d) => d.amount))
  for (const d of discounts.filter((d) => d.subscriptionId === null)) {
    const amt = discountAmount(d, round2(subtotal - discount))
    if (amt > 0) {
      discount = round2(discount + amt)
      discountNotes.push(`Bill: ${d.kind === 'percentage' ? `${d.value}%` : `₹${d.value}`} (${d.category})`)
    }
  }
  // The customer's own handling charge wins; otherwise the agency's default for that month (Handling Charge Setting).
  const monthDefault = db.handlingCharges?.find((h) => h.agentId === customer.agentId && h.month === from.slice(0, 7))?.amount ?? 0
  const handlingCharge = lines.length ? customer.handlingCharge || monthDefault : 0
  const currentBill = round2(subtotal - discount + handlingCharge)
  const previousBalance = customerOutstanding(db, customerId)
  return { lines, subtotal, discount, discountNotes, handlingCharge, currentBill, previousBalance }
}

/**
 * FIFO allocation of a payment across the customer's open invoices (oldest first).
 * Returns allocations; throws if amount exceeds outstanding.
 */
export function allocatePayment(db: Pick<DB, 'invoices'>, customerId: ID, amount: number) {
  const open = db.invoices
    .filter((i) => i.customerId === customerId && invoiceRemaining(i) > 0)
    .sort((a, b) => (a.issuedOn < b.issuedOn ? -1 : 1))
  const outstanding = sum(open.map(invoiceRemaining))
  if (amount - outstanding > 0.004) throw new Error(`Amount exceeds outstanding balance (${outstanding.toFixed(2)}).`)
  let left = round2(amount)
  const allocations: Payment['allocations'] = []
  for (const inv of open) {
    if (left <= 0) break
    const take = round2(Math.min(left, invoiceRemaining(inv)))
    allocations.push({ invoiceId: inv.id, amount: take })
    left = round2(left - take)
  }
  return allocations
}

// ---------- Settlement ----------

export interface AgentSettlement {
  agentId: ID
  purchaseValue: number
  agentValue: number
  customerValue: number
  agencyMargin: number
  agentMargin: number
  customerCollections: number
  agentCollections: number // collected in person by agent / their executives
  remitted: number
  outstandingAgentBalance: number
  customerOutstanding: number
}

export function agentSettlement(db: DB, agentId: ID, from?: ISODate, to?: ISODate): AgentSettlement {
  const inRange = (d: ISODate) => (!from || d >= from) && (!to || d <= to)
  const invs = db.invoices.filter((i) => i.agentId === agentId && inRange(i.periodStart))
  // Titles an agency created itself are bought directly from the publisher, so they never enter the settlement with the main agency.
  const owned = new Set(db.products.filter((p) => p.ownerId).map((p) => p.id))
  const lines = invs.flatMap((i) => i.lines).filter((l) => !owned.has(l.productId))
  const purchaseValue = sum(lines.map((l) => l.quantity * l.purchasePrice))
  const agentValue = sum(lines.map((l) => l.quantity * l.agentPrice))
  const customerValue = sum(lines.map((l) => l.amount))
  const pays = db.payments.filter((p) => p.agentId === agentId && inRange(p.date))
  const customerCollections = sum(pays.map((p) => p.amount))
  const agentCollections = sum(pays.filter((p) => p.method === 'Cash' || p.method === 'Agent Collection' || p.method === 'Delivery Executive Collection').map((p) => p.amount))
  const remitted = sum(db.remittances.filter((r) => r.agentId === agentId && inRange(r.date)).map((r) => r.amount))
  return {
    agentId,
    purchaseValue,
    agentValue,
    customerValue,
    agencyMargin: round2(agentValue - purchaseValue),
    agentMargin: round2(customerValue - agentValue),
    customerCollections,
    agentCollections,
    remitted,
    outstandingAgentBalance: round2(agentValue - remitted),
    customerOutstanding: sum(invs.map(invoiceRemaining)),
  }
}
