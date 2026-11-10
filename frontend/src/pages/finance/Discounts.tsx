import { BadgePercent, Ban, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { DataTable } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Segmented } from '@/components/ui/form'
import { Badge, DemoNote, PageHeader, StatusBadge } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, useConfirm } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { draftInvoice } from '@/domain/billing'
import { discountAmount, discountPctOf } from '@/domain/pricing'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import type { Discount, DiscountCategory, DiscountKind } from '@/domain/types'
import { useCan, useRun, useScope } from '@/hooks/app'
import { fmtDate, monthEndISO, monthStartISO, todayISO } from '@/lib/dates'
import { formatINR } from '@/lib/utils'
import { discounts as api } from '@/services/api'

const CATS: DiscountCategory[] = ['Customer-Specific', 'Subscription', 'Promotional', 'Long-Term Subscription']

export default function Discounts() {
  const { db, actor, customerIds } = useScope()
  const canWrite = useCan('discount.write')
  const confirm = useConfirm()
  const { run } = useRun()
  const [open, setOpen] = React.useState(false)
  const rows = db.discounts.filter((d) => customerIds.has(d.customerId))
  const t = todayISO()
  const status = (d: Discount) => (d.revoked ? 'cancelled' : d.expiryDate && d.expiryDate < t ? 'expired' : d.startDate > t ? 'scheduled' : 'active')
  const limit = actor.role === 'admin' ? db.settings.adminMaxDiscountPct : db.agents.find((a) => a.id === actor.userId)?.maxDiscountPct ?? db.settings.defaultAgentMaxDiscountPct
  return (
    <>
      <PageHeader
        kicker="Finance"
        title="Discounts"
        description={`Percentage or fixed discounts per customer or subscription. Your authorised limit: ${limit}% of the bill.`}
        actions={
          canWrite && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New discount
            </Button>
          )
        }
      />
      <DataTable
        rows={rows}
        rowKey={(d) => d.id}
        initialSort={{ key: 'start', dir: 'desc' }}
        search={(d) => `${userName(db, d.customerId)} ${d.reason} ${d.category}`}
        exportName="discounts"
        empty={{ icon: BadgePercent, title: 'No discounts' }}
        columns={[
          { key: 'cust', header: 'Customer', sort: (d) => userName(db, d.customerId), cell: (d) => <b>{userName(db, d.customerId)}</b> },
          { key: 'scope', header: 'Applies to', cell: (d) => (d.subscriptionId ? db.products.find((p) => p.id === db.subscriptions.find((s) => s.id === d.subscriptionId)?.productId)?.name : 'Whole bill') },
          { key: 'value', header: 'Discount', sort: (d) => d.value, cell: (d) => <Badge tone="success">{d.kind === 'percentage' ? `${d.value}%` : formatINR(d.value)}</Badge>, csv: (d) => `${d.value}${d.kind === 'percentage' ? '%' : ''}` },
          { key: 'cat', header: 'Type', sort: (d) => d.category, cell: (d) => d.category },
          { key: 'start', header: 'Start', sort: (d) => d.startDate, cell: (d) => fmtDate(d.startDate) },
          { key: 'end', header: 'Expiry', sort: (d) => d.expiryDate ?? '9999', cell: (d) => fmtDate(d.expiryDate) },
          { key: 'reason', header: 'Reason', cell: (d) => <span className="text-[13px] text-muted-foreground">{d.reason}</span> },
          { key: 'by', header: 'Approved by', sort: (d) => userName(db, d.approvedBy), cell: (d) => userName(db, d.approvedBy), hideOnMobile: true },
          { key: 'st', header: 'Status', sort: (d) => status(d), cell: (d) => <StatusBadge status={status(d)} /> },
          {
            key: 'act',
            header: '',
            cell: (d) =>
              canWrite && status(d) !== 'cancelled' && status(d) !== 'expired' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={async () => {
                    if (await confirm({ title: 'Revoke discount?', description: 'It stops applying to future bills. Issued invoices are unchanged.', tone: 'destructive', confirmLabel: 'Revoke' })) await run(() => api.revoke(d.id), 'Discount revoked')
                  }}
                >
                  <Ban /> Revoke
                </Button>
              ) : null,
          },
        ]}
      />
      {open && <DiscountDialog onClose={() => setOpen(false)} limit={limit} />}
    </>
  )
}

function DiscountDialog({ onClose, limit }: { onClose: () => void; limit: number }) {
  const { db, customers } = useScope()
  const { run, pending } = useRun()
  const [v, setV] = React.useState({ customerId: '', subscriptionId: '' as string, kind: 'percentage' as DiscountKind, category: 'Customer-Specific' as DiscountCategory, value: 5, startDate: todayISO(), expiryDate: '', reason: '' })
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const subs = db.subscriptions.filter((s) => s.customerId === v.customerId && deriveSubscriptionStatus(s) === 'active')
  const draft = v.customerId ? draftInvoice(db, v.customerId, monthStartISO(todayISO()), monthEndISO(todayISO())) : null
  const base = draft ? (v.subscriptionId ? draft.lines.filter((l) => l.subscriptionId === v.subscriptionId).reduce((s, l) => s + l.amount, 0) : draft.subtotal) : 0
  const pct = discountPctOf(v, base)
  const save = async () => {
    if (!v.customerId) return toast.error('Select a customer.')
    const ok = await run(() => api.create({ ...v, subscriptionId: v.subscriptionId || null, expiryDate: v.expiryDate || null }), 'Discount saved — applies from the next bill')
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" title="New discount">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer" required className="sm:col-span-2">
            <Combobox value={v.customerId} onChange={(id) => setV((s) => ({ ...s, customerId: id, subscriptionId: '' }))} options={customers.map((c) => ({ value: c.id, label: c.name, hint: c.code }))} />
          </Field>
          <Field label="Applies to" className="sm:col-span-2">
            <NativeSelect value={v.subscriptionId} onChange={(e) => set('subscriptionId', e.target.value)} disabled={!v.customerId}>
              <option value="">Whole bill</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {db.products.find((p) => p.id === s.productId)?.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Discount type">
            <Segmented value={v.kind} onChange={(x) => set('kind', x)} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'fixed', label: 'Fixed ₹' }]} />
          </Field>
          <Field label={v.kind === 'percentage' ? 'Value (%)' : 'Value (₹ per bill)'} required>
            <Input type="number" min={0} step="0.5" value={v.value} onChange={(e) => set('value', Number(e.target.value))} />
          </Field>
          <Field label="Category">
            <NativeSelect value={v.category} onChange={(e) => set('category', e.target.value as DiscountCategory)}>
              {CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Start date">
            <Input type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="Expiry date" hint="Blank = no expiry">
            <Input type="date" min={v.startDate} value={v.expiryDate} onChange={(e) => set('expiryDate', e.target.value)} />
          </Field>
          <Field label="Reason" required className="sm:col-span-2">
            <Input value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Senior citizen, long-term subscriber" />
          </Field>
          {v.customerId && (
            <DemoNote className="sm:col-span-2">
              On a typical monthly bill of {formatINR(base)} this saves {formatINR(discountAmount({ ...v, id: '', subscriptionId: null, expiryDate: null, approvedBy: '', createdAt: '' }, base))} — <b className={pct > limit ? 'text-destructive' : ''}>{pct.toFixed(1)}%</b> (your limit {limit}%).
            </DemoNote>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending} disabled={!v.reason.trim()}>
            Save discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
