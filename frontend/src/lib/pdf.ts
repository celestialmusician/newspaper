import type { DB } from '@/domain/db'
import { customerOutstanding, invoiceRemaining } from '@/domain/billing'
import { fullAddressLine } from '@/domain/locations'
import type { ID } from '@/domain/types'
import { fmtDate, fmtDateTime } from './dates'
import { round2 } from './utils'

// jsPDF's core fonts have no ₹ glyph — use "Rs." in PDFs.
const rs = (v: number) => `Rs. ${round2(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const NAVY: [number, number, number] = [20, 33, 61]
const RED: [number, number, number] = [194, 65, 12]

async function load() {
  const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  return { jsPDF, autoTable: autoTable.default }
}

function masthead(doc: import('jspdf').jsPDF, db: DB, title: string) {
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, 210, 30, 'F')
  doc.setFillColor(...RED)
  doc.rect(0, 30, 210, 1.6, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('times', 'bold')
  doc.setFontSize(20)
  doc.text(db.settings.agencyName, 14, 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`${db.settings.agencyAddress}  ·  GSTIN ${db.settings.gstin}  ·  Ph ${db.settings.supportPhone}`, 14, 22)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(title.toUpperCase(), 196, 14, { align: 'right' })
  doc.setTextColor(30, 30, 30)
}

/** The "PDF" button of every list: the rows on screen (after search and filters) as a simple A4 table. */
export async function downloadTablePDF(title: string, agency: string, head: string[], body: (string | number)[][], filename: string) {
  const { jsPDF, autoTable } = await load()
  const landscape = head.length > 6
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' })
  const w = doc.internal.pageSize.getWidth()
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, w, 18, 'F')
  doc.setFillColor(...RED)
  doc.rect(0, 18, w, 1.2, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(title.toUpperCase(), 12, 11.5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(agency, w - 12, 11.5, { align: 'right' })
  doc.setTextColor(30, 30, 30)
  autoTable(doc, {
    startY: 24,
    head: [head],
    body: body.map((r) => r.map((c) => String(c ?? '').replace(/₹/g, 'Rs. '))),
    styles: { fontSize: 8.5, cellPadding: 2 },
    headStyles: { fillColor: NAVY, textColor: 255 },
    alternateRowStyles: { fillColor: [244, 245, 251] },
    margin: { left: 12, right: 12 },
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.setTextColor(120)
      doc.text(`Generated ${fmtDateTime(new Date().toISOString())}`, 12, doc.internal.pageSize.getHeight() - 6)
    },
  })
  doc.save(`${filename}.pdf`)
}

export async function downloadInvoicePDF(db: DB, invoiceId: ID) {
  const inv = db.invoices.find((i) => i.id === invoiceId)
  if (!inv) return
  const c = db.customers.find((x) => x.id === inv.customerId)!
  const agent = db.agents.find((a) => a.id === inv.agentId)
  const { jsPDF, autoTable } = await load()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  masthead(doc, db, 'Tax Invoice')
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Billed to', 14, 42)
  doc.setFont('helvetica', 'normal')
  doc.text([c.name, `${c.code}  ·  +91 ${c.mobile}`, ...doc.splitTextToSize(`${c.houseName}, ${fullAddressLine(db, c.areaId)}`, 95)], 14, 48)
  const meta: [string, string][] = [
    ['Invoice no.', inv.number],
    ['Billing period', `${fmtDate(inv.periodStart)} - ${fmtDate(inv.periodEnd)}`],
    ['Issued on', fmtDate(inv.issuedOn)],
    ['Due date', fmtDate(inv.dueDate)],
    ['Agent', agent ? `${agent.name} (${agent.agencyName})` : '-'],
  ]
  meta.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'bold')
    doc.text(k, 120, 42 + i * 6)
    doc.setFont('helvetica', 'normal')
    doc.text(v, 196, 42 + i * 6, { align: 'right' })
  })
  autoTable(doc, {
    startY: 76,
    head: [['#', 'Product', 'Deliveries', 'Qty', 'Unit price', 'Amount']],
    body: inv.lines.map((l, i) => [i + 1, l.productName, l.deliveries, l.quantity, rs(l.unitPrice), rs(l.amount)]),
    theme: 'grid',
    headStyles: { fillColor: NAVY, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2.2 },
    columnStyles: { 0: { cellWidth: 10 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
  })
  // @ts-expect-error autotable augments doc at runtime
  let y: number = doc.lastAutoTable.finalY + 6
  const rows: [string, number, boolean?][] = [
    ['Subtotal', inv.subtotal],
    ...(inv.discount ? ([['Discount', -inv.discount]] as [string, number][]) : []),
    ...(inv.handlingCharge ? ([['Handling charge', inv.handlingCharge]] as [string, number][]) : []),
    ...inv.adjustments.map((a) => [a.label, a.amount] as [string, number]),
    ['Current bill', inv.currentBill, true],
    ['Previous balance', inv.previousBalance],
    ['Total payable', round2(inv.currentBill + inv.previousBalance), true],
    ['Paid against this bill', inv.paid],
    ['Remaining on this bill', invoiceRemaining(inv), true],
  ]
  for (const [k, v, b] of rows) {
    doc.setFont('helvetica', b ? 'bold' : 'normal')
    doc.text(k, 130, y)
    doc.text(rs(v), 196, y, { align: 'right' })
    y += 6
  }
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...RED)
  doc.text(`Account outstanding today: ${rs(customerOutstanding(db, c.id))}`, 14, y + 4)
  doc.setTextColor(100, 100, 100)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Subscriptions are billed at a fixed rate; holidays and hartals do not reduce the bill. Prices shown are those in effect for each delivery date.', 14, 285)
  doc.save(`${inv.number}.pdf`)
}

export async function downloadReceiptPDF(db: DB, paymentId: ID) {
  const p = db.payments.find((x) => x.id === paymentId)
  if (!p) return
  const c = db.customers.find((x) => x.id === p.customerId)!
  const { jsPDF, autoTable } = await load()
  const doc = new jsPDF({ unit: 'mm', format: 'a5' })
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, 148, 24, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('times', 'bold')
  doc.setFontSize(15)
  doc.text(db.settings.agencyName, 10, 11)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Payment receipt', 10, 18)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(p.receiptNo, 138, 13, { align: 'right' })
  doc.setTextColor(30, 30, 30)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text([`Received from: ${c.name} (${c.code})`, `Mobile: +91 ${c.mobile}`, `Date: ${fmtDateTime(p.at)}`, `Method: ${p.method}`], 10, 34)
  if (p.simulated) {
    doc.setTextColor(...RED)
    doc.setFont('helvetica', 'bold')
    doc.text(`DEMO / SIMULATED GATEWAY - ref ${p.gatewayRef}. Not a real bank transaction.`, 10, 58)
    doc.setTextColor(30, 30, 30)
  }
  autoTable(doc, {
    startY: 63,
    margin: { left: 10, right: 10 },
    head: [['Applied to invoice', 'Amount']],
    body: p.allocations.map((a) => [db.invoices.find((i) => i.id === a.invoiceId)?.number ?? a.invoiceId, rs(a.amount)]),
    theme: 'grid',
    headStyles: { fillColor: NAVY, fontSize: 9 },
    styles: { fontSize: 9 },
    columnStyles: { 1: { halign: 'right' } },
  })
  // @ts-expect-error autotable augments doc at runtime
  const y: number = doc.lastAutoTable.finalY + 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(`Amount received: ${rs(p.amount)}`, 10, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Balance after payment: ${rs(customerOutstanding(db, c.id))} (as on ${fmtDate(new Date().toISOString().slice(0, 10))})`, 10, y + 7)
  doc.text(p.verified ? 'Status: Verified' : 'Status: Awaiting agent verification', 10, y + 13)
  doc.save(`${p.receiptNo}.pdf`)
}
