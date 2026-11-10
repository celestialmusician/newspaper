import { BookOpenText, Download, FileText, MessageSquareWarning, Receipt, ShieldCheck, Wallet } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { NativeSelect, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { can, userName } from '@/domain/access'
import { invoiceRemaining, isOverdue } from '@/domain/billing'
import { occurrences } from '@/domain/schedule'
import type { Complaint, ComplaintStatus, Invoice, ISODate, Payment, Subscription } from '@/domain/types'
import { useActor, useData, useRun } from '@/hooks/app'
import { addDaysISO, fmtDate, fmtDateTime, fmtMonth, fmtTime, todayISO } from '@/lib/dates'
import { downloadInvoicePDF, downloadReceiptPDF } from '@/lib/pdf'
import { formatINR } from '@/lib/utils'
import { complaints as complaintApi, payments as paymentApi } from '@/services/api'
import { getDB } from '@/services/store'

export function InvoiceTable({ invoices, showCustomer = true, exportName }: { invoices: Invoice[]; showCustomer?: boolean; exportName?: string }) {
  const db = useData()
  const navigate = useNavigate()
  const cols: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      sort: (i) => i.number,
      cell: (i) => (
        <div>
          <div className="font-semibold">{i.number}</div>
          <div className="text-[12px] text-muted-foreground">{fmtMonth(i.periodStart)}</div>
        </div>
      ),
    },
    ...(showCustomer ? [{ key: 'customer', header: 'Customer', sort: (i: Invoice) => userName(db, i.customerId), cell: (i: Invoice) => userName(db, i.customerId) }] : []),
    { key: 'issued', header: 'Issued', sort: (i) => i.issuedOn, cell: (i) => fmtDate(i.issuedOn), hideOnMobile: true },
    { key: 'bill', header: 'Current bill', align: 'right', sort: (i) => i.currentBill, cell: (i) => <span className="tabular">{formatINR(i.currentBill)}</span> },
    { key: 'paid', header: 'Paid', align: 'right', sort: (i) => i.paid, cell: (i) => <span className="tabular">{formatINR(i.paid)}</span> },
    { key: 'due', header: 'Balance', align: 'right', sort: (i) => invoiceRemaining(i), cell: (i) => <span className={`tabular font-semibold ${invoiceRemaining(i) ? 'text-destructive' : ''}`}>{formatINR(invoiceRemaining(i))}</span> },
    { key: 'status', header: 'Status', sort: (i) => i.status, cell: (i) => <StatusBadge status={isOverdue(i) ? 'overdue' : i.status} /> },
    {
      key: 'pdf',
      header: '',
      hideOnMobile: true,
      cell: (i) => (
        <Button variant="ghost" size="icon-sm" aria-label="Download PDF" onClick={(e) => { e.stopPropagation(); void downloadInvoicePDF(getDB(), i.id) }}>
          <Download />
        </Button>
      ),
    },
  ]
  return (
    <DataTable
      rows={invoices}
      columns={cols}
      rowKey={(i) => i.id}
      search={(i) => `${i.number} ${userName(db, i.customerId)}`}
      onRowClick={(i) => navigate(`/invoices/${i.id}`)}
      initialSort={{ key: 'issued', dir: 'desc' }}
      exportName={exportName}
      empty={{ icon: FileText, title: 'No invoices', description: 'Invoices appear after monthly billing is generated.' }}
    />
  )
}

export function PaymentTable({ payments, showCustomer = true, exportName }: { payments: Payment[]; showCustomer?: boolean; exportName?: string }) {
  const db = useData()
  const actor = useActor()
  const { run } = useRun()
  const canVerify = actor.role === 'admin' || actor.role === 'agent'
  const cols: Column<Payment>[] = [
    {
      key: 'receipt',
      header: 'Receipt',
      sort: (p) => p.receiptNo,
      cell: (p) => (
        <div>
          <div className="font-semibold">{p.receiptNo}</div>
          <div className="text-[12px] text-muted-foreground">{fmtDateTime(p.at)}</div>
        </div>
      ),
    },
    ...(showCustomer ? [{ key: 'customer', header: 'Customer', sort: (p: Payment) => userName(db, p.customerId), cell: (p: Payment) => userName(db, p.customerId) }] : []),
    {
      key: 'method',
      header: 'Method',
      sort: (p) => p.method,
      cell: (p) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{p.method}</span>
          {p.simulated && <Badge tone="accent">Demo gateway</Badge>}
        </div>
      ),
    },
    { key: 'by', header: 'Recorded by', sort: (p) => userName(db, p.collectedBy), cell: (p) => userName(db, p.collectedBy), hideOnMobile: true },
    { key: 'amount', header: 'Amount', align: 'right', sort: (p) => p.amount, cell: (p) => <span className="tabular font-semibold">{formatINR(p.amount)}</span> },
    {
      key: 'verified',
      header: 'Verification',
      sort: (p) => (p.verified ? 1 : 0),
      cell: (p) =>
        p.verified ? (
          <Badge tone="success">
            <ShieldCheck className="size-3" /> Verified
          </Badge>
        ) : canVerify ? (
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); void run(() => paymentApi.verify(p.id), 'Collection verified') }}>
            Verify cash
          </Button>
        ) : (
          <Badge tone="warning">Awaiting verification</Badge>
        ),
    },
    {
      key: 'pdf',
      header: '',
      cell: (p) => (
        <Button variant="ghost" size="icon-sm" aria-label="Download receipt" onClick={(e) => { e.stopPropagation(); void downloadReceiptPDF(getDB(), p.id) }}>
          <Receipt />
        </Button>
      ),
    },
  ]
  return (
    <DataTable
      rows={payments}
      columns={cols}
      rowKey={(p) => p.id}
      search={(p) => `${p.receiptNo} ${userName(db, p.customerId)} ${p.method} ${p.gatewayRef ?? ''}`}
      initialSort={{ key: 'receipt', dir: 'desc' }}
      exportName={exportName}
      empty={{ icon: Wallet, title: 'No payments yet' }}
    />
  )
}

/** Delivery history derived from the schedule + outcome records, scoped by the subscriptions passed in. */
export function DeliveryHistoryTable({ subscriptions, showCustomer = true, from: initialFrom, exportName }: { subscriptions: Subscription[]; showCustomer?: boolean; from?: ISODate; exportName?: string }) {
  const db = useData()
  const [from, setFrom] = React.useState(initialFrom ?? addDaysISO(todayISO(), -14))
  const [status, setStatus] = React.useState('')
  const [product, setProduct] = React.useState('')
  const rows = React.useMemo(
    () =>
      occurrences(db, subscriptions, from, todayISO())
        .filter((o) => (!status || o.status === status) && (!product || o.productId === product))
        .reverse(),
    [db, subscriptions, from, status, product],
  )
  type Row = (typeof rows)[number]
  const cols: Column<Row>[] = [
    { key: 'date', header: 'Scheduled', sort: (o) => o.date, cell: (o) => <span className="whitespace-nowrap font-semibold">{fmtDate(o.date)}</span> },
    ...(showCustomer ? [{ key: 'customer', header: 'Customer', sort: (o: Row) => userName(db, o.customerId), cell: (o: Row) => userName(db, o.customerId) }] : []),
    { key: 'product', header: 'Product', sort: (o) => db.products.find((p) => p.id === o.productId)?.name ?? '', cell: (o) => `${db.products.find((p) => p.id === o.productId)?.name}${o.quantity > 1 ? ` ×${o.quantity}` : ''}` },
    { key: 'status', header: 'Status', sort: (o) => o.status, cell: (o) => <StatusBadge status={o.status} /> },
    { key: 'actual', header: 'Delivered at', sort: (o) => o.record?.actualAt ?? '', cell: (o) => (o.record?.actualAt ? fmtTime(o.record.actualAt) : '—'), hideOnMobile: true },
    { key: 'exec', header: 'Executive', sort: (o) => userName(db, o.record?.executiveId), cell: (o) => (o.record ? userName(db, o.record.executiveId) : '—') },
    { key: 'by', header: 'Updated by', sort: (o) => userName(db, o.record?.updatedBy), cell: (o) => (o.record ? userName(db, o.record.updatedBy) : '—'), hideOnMobile: true },
    {
      key: 'remarks',
      header: 'Remarks',
      cell: (o) => (
        <span className="text-[12.5px] text-muted-foreground">
          {o.holiday?.name ?? o.record?.reason ?? o.record?.remarks ?? (o.status === 'paused' ? 'Subscription paused' : '')}
          {o.record?.syncedFromOffline && <Badge tone="info" className="ml-1">offline sync</Badge>}
        </span>
      ),
      csv: (o) => o.holiday?.name ?? o.record?.reason ?? o.record?.remarks ?? '',
    },
  ]
  return (
    <DataTable
      rows={rows}
      columns={cols}
      rowKey={(o) => o.key}
      search={(o) => `${userName(db, o.customerId)} ${db.products.find((p) => p.id === o.productId)?.name}`}
      exportName={exportName}
      pageSize={25}
      dense
      empty={{ icon: BookOpenText, title: 'No deliveries in this period' }}
      toolbar={
        <>
          <NativeSelect value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 w-36 text-[13.5px]" aria-label="Period">
            <option value={addDaysISO(todayISO(), -7)}>Last 7 days</option>
            <option value={addDaysISO(todayISO(), -14)}>Last 14 days</option>
            <option value={addDaysISO(todayISO(), -30)}>Last 30 days</option>
            <option value={addDaysISO(todayISO(), -60)}>Last 60 days</option>
          </NativeSelect>
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-36 text-[13.5px]" aria-label="Status">
            <option value="">Any status</option>
            {['delivered', 'missed', 'pending', 'holiday', 'paused'].map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={product} onChange={(e) => setProduct(e.target.value)} className="h-10 w-44 text-[13.5px]" aria-label="Product">
            <option value="">All products</option>
            {[...new Set(subscriptions.map((s) => s.productId))].map((id) => (
              <option key={id} value={id}>
                {db.products.find((p) => p.id === id)?.name}
              </option>
            ))}
          </NativeSelect>
        </>
      }
    />
  )
}

export function ComplaintList({ complaints }: { complaints: Complaint[] }) {
  const db = useData()
  const actor = useActor()
  const [replyTo, setReplyTo] = React.useState<Complaint | null>(null)
  const canRespond = can(db, actor, 'complaint.respond')
  if (!complaints.length) return <EmptyState icon={MessageSquareWarning} title="No complaints" description="Issues raised by subscribers show up here." />
  return (
    <>
      <div className="space-y-3">
        {complaints.map((c) => {
          const cust = db.customers.find((x) => x.id === c.customerId)
          return (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.number}</span>
                    <Badge tone="navy">{c.category}</Badge>
                    <StatusBadge status={c.status} />
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground">
                    {actor.role !== 'customer' && `${cust?.name} · `}
                    {fmtDateTime(c.createdAt)}
                  </div>
                </div>
                {canRespond && c.status !== 'resolved' && (
                  <Button size="sm" variant="outline" onClick={() => setReplyTo(c)}>
                    Respond
                  </Button>
                )}
              </div>
              <p className="mt-2 text-[14px]">{c.message}</p>
              {c.updates.length > 0 && (
                <ul className="mt-3 space-y-2 border-l-2 border-border pl-3">
                  {c.updates.map((u, i) => (
                    <li key={i} className="text-[13px]">
                      <span className="font-semibold">{userName(db, u.by)}</span> <span className="text-muted-foreground">· {fmtDateTime(u.at)}</span>
                      <div>{u.note}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}
      </div>
      {replyTo && <RespondDialog complaint={replyTo} onClose={() => setReplyTo(null)} />}
    </>
  )
}

function RespondDialog({ complaint, onClose }: { complaint: Complaint; onClose: () => void }) {
  const [note, setNote] = React.useState('')
  const [status, setStatus] = React.useState<ComplaintStatus>(complaint.status === 'open' ? 'in_progress' : 'resolved')
  const { run, pending } = useRun()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title={`Respond to ${complaint.number}`} description={complaint.message}>
        <div className="space-y-3">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)}>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
          </NativeSelect>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Message to the customer" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={pending} onClick={async () => (await run(() => complaintApi.respond(complaint.id, note, status), 'Customer notified')) && onClose()}>
            Send update
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
