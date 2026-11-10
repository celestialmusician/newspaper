import { Plus, Tags, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { Badge, PageHeader } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { resolvePrice, versionsFor, validatePriceTriple } from '@/domain/pricing'
import type { IssueRate, PriceVersion, Product, RateRow, SpecialRate } from '@/domain/types'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { fmtDate, todayISO, WEEKDAYS_LONG } from '@/lib/dates'
import { round2 } from '@/lib/utils'
import { prices as api } from '@/services/api'
import { subTypeOf } from './ManageProducts'
import { FormCard, FormTable, RowActions } from './shared'

const ZERO: RateRow = { purchase: 0, sale: 0, agent: 0 }
const DAYS = [0, 1, 2, 3, 4, 5, 6]
const filled = (r: RateRow) => r.purchase > 0 || r.sale > 0 || r.agent > 0
const asTriple = (r: RateRow) => ({ purchasePrice: r.purchase, customerPrice: r.sale, agentPrice: r.agent })

/** Purchase / Sale / Sub-agent inputs for one rate row. */
function RateInputs({ value, onChange, invalid }: { value: RateRow; onChange: (r: RateRow) => void; invalid?: boolean }) {
  const f = (k: keyof RateRow, label: string) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">{label}</span>
      <Input type="number" min={0} step="0.5" value={value[k] || ''} aria-label={label} aria-invalid={invalid || undefined} onChange={(e) => onChange({ ...value, [k]: Number(e.target.value) })} className="h-10" />
    </label>
  )
  return (
    <>
      {f('purchase', 'Purchase Rate')}
      {f('sale', 'Sale Rate')}
      {f('agent', 'Sub-agent Rate')}
    </>
  )
}
const HeadRow = ({ first }: { first: string }) => (
  <div className="hidden grid-cols-[6rem_repeat(3,minmax(0,1fr))] gap-3 px-1 text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground sm:grid">
    <span>{first}</span>
    <span>Purchase Rate</span>
    <span>Sale Rate</span>
    <span>Sub-agent Rate</span>
  </div>
)

export default function ProductRates() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const actor = useActor()
  const agentId = actor.role === 'agent' ? actor.userId : undefined
  const today = todayISO()
  /** Titles this login may rate: an agency sees the shared catalogue plus its own titles. */
  const visible = (p: Product) => (agentId ? !p.ownerId || p.ownerId === agentId : !p.ownerId)
  /** For a shared title an agency sets its own selling rates on top of the main agency's base. */
  const overrideFor = (p?: Product) => (agentId && p && p.ownerId !== agentId ? agentId : null)

  const [date, setDate] = React.useState(today)
  const [subType, setSubType] = React.useState('')
  const [productId, setProductId] = React.useState('')
  const [special, setSpecial] = React.useState(false)
  const [monthly, setMonthly] = React.useState(0)
  const [days, setDays] = React.useState<RateRow[]>(DAYS.map(() => ({ ...ZERO })))
  const [issues, setIssues] = React.useState<IssueRate[]>([{ issueNo: 1, ...ZERO }])
  const [single, setSingle] = React.useState<RateRow>({ ...ZERO })
  const [specials, setSpecials] = React.useState<SpecialRate[]>([{ from: today, to: today, issueNo: 1, ...ZERO }])
  const [editing, setEditing] = React.useState<PriceVersion | null>(null)
  const [error, setError] = React.useState('')

  const product = db.products.find((p) => p.id === productId)
  const isDaily = subType === 'Daily'
  const hasIssues = !!product?.haveIssues && !isDaily
  const maxIssues = product?.maxIssues ?? 1
  const subTypes = db.masters.filter((m) => m.kind === 'subscription_type' && m.status === 'active' && m.ownerId === agentId)
  const choices = db.products.filter((p) => p.status === 'active' && visible(p) && (!subType || subTypeOf(p) === subType))
  const sharedBase = product && overrideFor(product) ? resolvePrice(db, product.id, today, null) : null

  const reset = () => {
    setEditing(null)
    setDate(today)
    setSubType('')
    setProductId('')
    setSpecial(false)
    setMonthly(0)
    setDays(DAYS.map(() => ({ ...ZERO })))
    setIssues([{ issueNo: 1, ...ZERO }])
    setSingle({ ...ZERO })
    setSpecials([{ from: today, to: today, issueNo: 1, ...ZERO }])
    setError('')
  }

  const startEdit = (v: PriceVersion) => {
    const p = db.products.find((x) => x.id === v.productId)
    if (!p) return
    setEditing(v)
    setDate(v.effectiveFrom < today ? today : v.effectiveFrom)
    setSubType(subTypeOf(p))
    setProductId(p.id)
    setSpecial(!!v.specials?.length)
    setMonthly(v.monthlyRate ?? 0)
    setDays(DAYS.map((d) => v.dayRates?.[d] ?? { ...ZERO }))
    setIssues(v.issueRates?.length ? v.issueRates : [{ issueNo: 1, purchase: v.purchasePrice, sale: v.customerPrice, agent: v.agentPrice }])
    setSingle({ purchase: v.purchasePrice, sale: v.customerPrice, agent: v.agentPrice })
    setSpecials(v.specials?.length ? v.specials : [{ from: today, to: today, issueNo: 1, ...ZERO }])
    setError('')
  }

  const save = async () => {
    setError('')
    if (!subType) return setError('Select the subscription type.')
    if (!product) return setError('Select the product.')
    if (date < today) return setError('The rate cannot start in the past — earlier invoices keep their original prices.')
    // On a shared title the purchase rate stays the main agency's; only the agency's own rates change.
    const lockPurchase = (r: RateRow): RateRow => (sharedBase ? { ...r, purchase: sharedBase.purchasePrice } : r)
    let headline: RateRow
    let dayRates: RateRow[] | undefined
    let issueRates: IssueRate[] | undefined
    if (isDaily) {
      const used = days.map((d, i) => ({ d: lockPurchase(d), i })).filter(({ d }) => filled(d))
      if (!used.length) return setError('Enter the rates for at least one day.')
      for (const { d, i } of used) {
        const e = validatePriceTriple(asTriple(d))
        if (e) return setError(`${WEEKDAYS_LONG[i]}: ${e}`)
      }
      const avg = (k: keyof RateRow) => round2(used.reduce((s, { d }) => s + d[k], 0) / used.length)
      headline = { purchase: avg('purchase'), sale: avg('sale'), agent: avg('agent') }
      dayRates = days.map(lockPurchase)
    } else if (hasIssues) {
      for (const r of issues.map((x) => ({ ...x, ...lockPurchase(x) }))) {
        const e = validatePriceTriple(asTriple(r))
        if (e) return setError(`Issue ${r.issueNo}: ${e}`)
      }
      headline = lockPurchase(issues[0]!)
      issueRates = issues.map((x) => ({ ...x, ...lockPurchase(x) }))
    } else {
      const e = validatePriceTriple(asTriple(lockPurchase(single)))
      if (e) return setError(e)
      headline = lockPurchase(single)
    }
    let specialRows: SpecialRate[] | undefined
    if (special) {
      specialRows = specials.filter((s) => filled(s) || s.from !== s.to).map((s) => ({ ...s, ...lockPurchase(s) }))
      if (!specialRows.length) return setError('Add at least one special rate, or switch Special Rate to No.')
      for (const s of specialRows) {
        if (s.to < s.from) return setError('A special rate ends before it starts.')
        const e = validatePriceTriple(asTriple(s))
        if (e) return setError(`Special rate ${fmtDate(s.from)}: ${e}`)
      }
    }
    const ok = await run(
      () => api.addVersion({ productId: product.id, agentId: overrideFor(product), ...asTriple(headline), effectiveFrom: date, monthlyRate: isDaily ? monthly : undefined, dayRates, issueRates, specials: specialRows, note: editing ? 'Revised in Product Wise Rate' : 'Set in Product Wise Rate' }),
      `${product.name}: rate saved from ${fmtDate(date)}`,
    )
    if (ok) reset()
    return !!ok
  }

  const remove = async (v: PriceVersion, p: Product) => {
    if (await confirm({ title: `Delete the scheduled rate for ${p.name}?`, description: `The rate starting ${fmtDate(v.effectiveFrom)} has not come into effect yet, so it can be removed.`, tone: 'destructive', confirmLabel: 'Delete' })) await run(() => api.removeFuture(v.id), 'Scheduled rate deleted')
  }

  const rows = db.products
    .filter(visible)
    .map((p) => ({ p, v: versionsFor(db, p.id, overrideFor(p))[0] }))
    .filter((r): r is { p: Product; v: PriceVersion } => !!r.v)
    .map((r, i) => ({ ...r, n: i + 1 }))
  type Row = (typeof rows)[number]
  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-16' },
    { key: 'name', header: 'Product Name', sort: (r) => r.p.name, csv: (r) => `${r.p.name} / ${subTypeOf(r.p)}`, cell: (r) => <span className="font-semibold">{r.p.name} <span className="font-normal text-muted-foreground">/ {subTypeOf(r.p)}</span></span>, hideOnMobile: true },
    { key: 'rate', header: 'Monthly Rate', align: 'right', sort: (r) => r.v.monthlyRate ?? 0, csv: (r) => (r.v.monthlyRate ?? 0).toFixed(2), cell: (r) => <span className="tabular">{(r.v.monthlyRate ?? 0).toFixed(2)}</span> },
    { key: 'date', header: 'Entry Date', sort: (r) => r.v.effectiveFrom, csv: (r) => r.v.effectiveFrom, cell: (r) => <span className="whitespace-nowrap text-[13px]">{fmtDate(r.v.effectiveFrom)} {r.v.effectiveFrom > today && <Badge tone="warning">Scheduled</Badge>}</span> },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => startEdit(r.v)} onDelete={() => void remove(r.v, r.p)} lockedReason={r.v.effectiveFrom <= today ? 'In effect — it is part of billing history' : undefined} /> },
  ]

  const setDay = (i: number, r: RateRow) => setDays((d) => d.map((x, j) => (j === i ? r : x)))
  const setIssue = (i: number, r: IssueRate) => setIssues((d) => d.map((x, j) => (j === i ? r : x)))

  return (
    <>
      <PageHeader kicker="Agent Console" title="Product Wise Rate" description="Purchase, sale and sub-agent rates for every title — by weekday for dailies, by issue for magazines." />
      <FormTable
        noun="rate"
        form={
          <FormCard title="Product Wise Rate" description={editing ? 'Saving adds a new rate from the chosen date. Earlier invoices keep their original prices.' : undefined} editing={!!editing} onCancel={reset} onSubmit={save} pending={pending}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Date">
              <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Subscription Type" required>
              <NativeSelect
                value={subType}
                onChange={(e) => {
                  setSubType(e.target.value)
                  setProductId('')
                }}
              >
                <option value="">Select Sub Type</option>
                {subTypes.map((m) => (
                  <option key={m.id}>{m.name}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Product" required>
              <NativeSelect value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select Product</option>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Special Rate" required>
              <NativeSelect value={special ? 'yes' : 'no'} onChange={(e) => setSpecial(e.target.value === 'yes')}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </NativeSelect>
            </Field>
          </div>

          {isDaily && product && (
            <section className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <Field label="Monthly Rate" className="sm:max-w-xs">
                <Input type="number" min={0} value={monthly || ''} onChange={(e) => setMonthly(Number(e.target.value))} />
              </Field>
              <HeadRow first="Day" />
              {DAYS.map((d) => (
                <div key={d} className="grid grid-cols-3 items-end gap-3 sm:grid-cols-[6rem_repeat(3,minmax(0,1fr))] sm:items-center">
                  <span className="col-span-3 text-[13.5px] font-semibold sm:col-span-1">{WEEKDAYS_LONG[d]}</span>
                  <RateInputs value={days[d]!} onChange={(r) => setDay(d, r)} />
                </div>
              ))}
            </section>
          )}

          {!isDaily && product && !hasIssues && (
            <section className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <HeadRow first="Rate" />
              <div className="grid grid-cols-3 items-end gap-3 sm:grid-cols-[6rem_repeat(3,minmax(0,1fr))] sm:items-center">
                <span className="col-span-3 text-[13.5px] font-semibold sm:col-span-1">Per copy</span>
                <RateInputs value={single} onChange={setSingle} />
              </div>
            </section>
          )}

          {hasIssues && (
            <section className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4">
              <HeadRow first="Issue No" />
              {issues.map((r, i) => (
                <div key={i} className="grid grid-cols-3 items-end gap-3 sm:grid-cols-[6rem_repeat(3,minmax(0,1fr))_2.5rem] sm:items-center">
                  <label className="col-span-3 sm:col-span-1">
                    <span className="sr-only">Issue No</span>
                    <NativeSelect value={r.issueNo} onChange={(e) => setIssue(i, { ...r, issueNo: Number(e.target.value) })} className="h-10">
                      {Array.from({ length: maxIssues }, (_, k) => k + 1).map((n) => (
                        <option key={n} value={n}>
                          Issue {n}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  <RateInputs value={r} onChange={(x) => setIssue(i, { ...r, ...x })} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove issue" disabled={issues.length === 1} onClick={() => setIssues((d) => d.filter((_, j) => j !== i))} className="text-destructive">
                    <X />
                  </Button>
                </div>
              ))}
              {issues.length < maxIssues && (
                <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setIssues((d) => [...d, { issueNo: Math.min(maxIssues, d.length + 1), ...ZERO }])}>
                  <Plus /> Add issue
                </Button>
              )}
            </section>
          )}

          {special && product && (
            <section className="grid gap-3 rounded-xl border border-dashed border-masthead/40 bg-masthead/[0.04] p-4">
              <div className="text-[13px] font-semibold">Special rates</div>
              {specials.map((s, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-[repeat(2,minmax(0,9rem))_repeat(3,minmax(0,1fr))_2.5rem]">
                  <Field label={i === 0 ? 'From Date' : undefined}>
                    <Input type="date" value={s.from} onChange={(e) => setSpecials((d) => d.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} className="h-10" />
                  </Field>
                  <Field label={i === 0 ? 'To Date' : undefined}>
                    <Input type="date" min={s.from} value={s.to} onChange={(e) => setSpecials((d) => d.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} className="h-10" />
                  </Field>
                  <RateInputs value={s} onChange={(r) => setSpecials((d) => d.map((x, j) => (j === i ? { ...x, ...r } : x)))} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove special rate" disabled={specials.length === 1} onClick={() => setSpecials((d) => d.filter((_, j) => j !== i))} className="self-end text-destructive sm:mb-0.5">
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setSpecials((d) => [...d, { from: today, to: today, issueNo: 1, ...ZERO }])}>
                <Plus /> Add special rate
              </Button>
            </section>
          )}

          {error && <p className="text-[13px] font-medium text-destructive">{error}</p>}
          </FormCard>
        }
      >
        <DataTable cardAvatar={(r) => r.p.name} loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.v.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.p.name}</span>} search={(r) => `${r.p.name} ${subTypeOf(r.p)}`} exportName="product-wise-rate" empty={{ icon: Tags, title: 'No rates yet', description: 'Add a rate to pick a subscription type and product.' }} />
      </FormTable>
    </>
  )
}
