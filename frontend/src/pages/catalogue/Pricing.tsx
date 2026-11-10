import { History, Plus, Tags, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, DemoNote, EmptyState, PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, useConfirm } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { resolvePrice, upcomingVersion, validateAgentOverride, validatePriceTriple, versionsFor } from '@/domain/pricing'
import type { ID, PriceVersion } from '@/domain/types'
import { useActor, useCan, useData, useRun } from '@/hooks/app'
import { fmtDate, todayISO } from '@/lib/dates'
import { cn, formatINR, round2 } from '@/lib/utils'
import { prices as api } from '@/services/api'

export default function Pricing() {
  const db = useData()
  const actor = useActor()
  const canWrite = useCan('price.write')
  const [params, setParams] = useSearchParams()
  const t = todayISO()
  const active = db.products.filter((p) => p.status !== 'archived')
  const selected = params.get('product') ?? active[0]?.id
  const product = db.products.find((p) => p.id === selected)
  const [dialog, setDialog] = React.useState<{ agentId: ID | null } | null>(null)
  const agentId = actor.role === 'agent' ? actor.userId : null

  return (
    <>
      <PageHeader kicker="Catalogue" title="Three-level pricing" description="Agency purchase → agent price → customer price. Every change is a dated version; invoices keep the price that applied on each delivery date." />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5">Product</th>
                  {actor.role === 'admin' && <th className="px-3 py-2.5 text-right">Purchase</th>}
                  <th className="px-3 py-2.5 text-right">Agent</th>
                  <th className="px-3 py-2.5 text-right">Customer</th>
                  {actor.role === 'admin' && <th className="px-3 py-2.5 text-right">Agency margin</th>}
                  <th className="px-3 py-2.5 text-right">Agent margin</th>
                  <th className="px-3 py-2.5">Upcoming</th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => {
                  const r = resolvePrice(db, p.id, t, agentId)
                  const next = upcomingVersion(db, p.id, t)
                  const overrides = db.prices.filter((x) => x.productId === p.id && x.agentId).length
                  return (
                    <tr key={p.id} onClick={() => setParams({ product: p.id })} className={cn('cursor-pointer border-b border-border/50 hover:bg-accent/60', p.id === selected && 'bg-masthead/[0.05]')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-semibold">
                          <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
                          {p.name}
                        </div>
                        <div className="text-[12px] text-muted-foreground">
                          {p.code}
                          {overrides > 0 && actor.role === 'admin' && ` · ${overrides} agent rate`}
                          {r?.source === 'agent' && ' · your special rate'}
                        </div>
                      </td>
                      {actor.role === 'admin' && <td className="tabular px-3 text-right">{formatINR(r?.purchasePrice ?? 0)}</td>}
                      <td className="tabular px-3 text-right">{formatINR(r?.agentPrice ?? 0)}</td>
                      <td className="tabular px-3 text-right font-semibold">{formatINR(r?.customerPrice ?? 0)}</td>
                      {actor.role === 'admin' && <td className="tabular px-3 text-right text-success">{formatINR(r?.agencyMargin ?? 0)}</td>}
                      <td className="tabular px-3 text-right text-info">{formatINR(r?.agentMargin ?? 0)}</td>
                      <td className="px-3">{next ? <Badge tone="accent">{formatINR(next.customerPrice)} · {fmtDate(next.effectiveFrom)}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {product ? (
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={product.name}
                icon={History}
                description="Base price history"
                action={
                  canWrite && (
                    <Button size="sm" onClick={() => setDialog({ agentId: null })}>
                      <Plus /> New price
                    </Button>
                  )
                }
              />
              <CardBody>
                <PriceTimeline versions={versionsFor(db, product.id, null)} canWrite={canWrite} showPurchase={actor.role === 'admin'} />
              </CardBody>
            </Card>
            {(actor.role === 'admin' || agentId) && (
              <Card>
                <CardHeader title="Agent-specific pricing" description={`Allowed within ±${db.settings.agentPriceMaxMarkupPct}% of base customer price`} />
                <CardBody className="space-y-4">
                  {db.agents
                    .filter((a) => actor.role === 'admin' || a.id === agentId)
                    .map((a) => {
                      const vs = versionsFor(db, product.id, a.id)
                      return (
                        <div key={a.id} className="rounded-lg border border-border p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-[13.5px] font-semibold">
                              {a.name} <span className="font-normal text-muted-foreground">· {a.agencyName}</span>
                            </div>
                            {canWrite && (
                              <Button size="sm" variant="ghost" onClick={() => setDialog({ agentId: a.id })}>
                                <Plus /> Rate
                              </Button>
                            )}
                          </div>
                          {vs.length ? <PriceTimeline versions={vs} canWrite={canWrite} showPurchase={false} /> : <div className="text-[12.5px] text-muted-foreground">Uses base price.</div>}
                        </div>
                      )
                    })}
                </CardBody>
              </Card>
            )}
          </div>
        ) : (
          <EmptyState icon={Tags} title="Select a product" />
        )}
      </div>
      {dialog && product && <PriceDialog productId={product.id} agentId={dialog.agentId} onClose={() => setDialog(null)} />}
    </>
  )
}

function PriceTimeline({ versions, canWrite, showPurchase }: { versions: PriceVersion[]; canWrite: boolean; showPurchase: boolean }) {
  const db = useData()
  const confirm = useConfirm()
  const { run } = useRun()
  const t = todayISO()
  const currentId = versions.find((v) => v.effectiveFrom <= t)?.id
  return (
    <ol className="relative space-y-3 border-l-2 border-border pl-4">
      {versions.map((v) => {
        const future = v.effectiveFrom > t
        const current = v.id === currentId
        return (
          <li key={v.id} className="relative">
            <span className={cn('absolute -left-[23px] top-1.5 size-3 rounded-full border-2 border-card', future ? 'bg-masthead' : current ? 'bg-success' : 'bg-input')} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
                  {showPurchase && <span className="tabular">{formatINR(v.purchasePrice)} →</span>}
                  <span className="tabular">{formatINR(v.agentPrice)} →</span>
                  <span className="tabular text-primary">{formatINR(v.customerPrice)}</span>
                  {current && <Badge tone="success">Current</Badge>}
                  {future && <Badge tone="accent">Scheduled</Badge>}
                  {!current && !future && <Badge>Historical</Badge>}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  From {fmtDate(v.effectiveFrom)} · {userName(db, v.createdBy)}
                  {v.note && ` · ${v.note}`}
                </div>
              </div>
              {future && canWrite && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove scheduled price"
                  onClick={async () => {
                    if (await confirm({ title: 'Remove scheduled price?', description: `The change planned for ${fmtDate(v.effectiveFrom)} will not happen.`, tone: 'destructive', confirmLabel: 'Remove' })) await run(() => api.removeFuture(v.id), 'Scheduled price removed')
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function PriceDialog({ productId, agentId, onClose }: { productId: ID; agentId: ID | null; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const product = db.products.find((p) => p.id === productId)!
  const base = resolvePrice(db, productId, todayISO(), null)
  const cur = resolvePrice(db, productId, todayISO(), agentId)
  const [v, setV] = React.useState({ purchasePrice: base?.purchasePrice ?? 0, agentPrice: cur?.agentPrice ?? 0, customerPrice: cur?.customerPrice ?? 0, effectiveFrom: todayISO(), note: '' })
  const err = validatePriceTriple(v) ?? (agentId && base ? validateAgentOverride(base, v.customerPrice, db.settings.agentPriceMaxMarkupPct) : null)
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: k === 'effectiveFrom' || k === 'note' ? x : Number(x) }))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md" title={`New ${agentId ? 'agent-specific ' : ''}price`} description={`${product.name}${agentId ? ` · ${userName(db, agentId)}` : ''}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Purchase ₹" hint={agentId ? 'Base level' : undefined}>
              <Input type="number" step="0.5" value={v.purchasePrice} disabled={!!agentId} onChange={(e) => set('purchasePrice', e.target.value)} />
            </Field>
            <Field label="Agent ₹">
              <Input type="number" step="0.5" value={v.agentPrice} onChange={(e) => set('agentPrice', e.target.value)} />
            </Field>
            <Field label="Customer ₹">
              <Input type="number" step="0.5" value={v.customerPrice} onChange={(e) => set('customerPrice', e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-[13px]">
            <div>
              Agency margin <b className="tabular text-success">{formatINR(round2(v.agentPrice - v.purchasePrice))}</b>
            </div>
            <div>
              Agent margin <b className="tabular text-info">{formatINR(round2(v.customerPrice - v.agentPrice))}</b>
            </div>
          </div>
          <Field label="Effective from" required hint="Today or a future date. Bills for earlier dates keep the old price.">
            <Input type="date" min={todayISO()} value={v.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          </Field>
          <Field label="Reason / note">
            <Input value={v.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Publisher cover price revision" />
          </Field>
          {err && <p className="rounded-lg bg-destructive/8 px-3 py-2 text-[13px] font-medium text-destructive">{err}</p>}
          <DemoNote>Agents are notified automatically about price changes.</DemoNote>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!err} loading={pending} onClick={async () => (await run(() => api.addVersion({ productId, agentId, ...v, note: v.note || undefined }), 'Price version saved')) && onClose()}>
            Save price
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
