import { Archive, BookOpen, ImagePlus, LayoutGrid, List, MoreVertical, Newspaper, Pencil, Plus, Power, Repeat, Search, Tags, Trash2, TrendingUp } from 'lucide-react'
import * as React from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Segmented, Textarea } from '@/components/ui/form'
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from '@/components/ui/misc'
import { FormSection } from '@/components/ui/form-guide'
import { Dialog, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, useConfirm } from '@/components/ui/overlay'
import { resolvePrice, upcomingVersion, validatePriceTriple } from '@/domain/pricing'
import { FREQUENCY_META, PRODUCT_CATEGORIES, type Frequency, type MasterKind, type Product, type ProductCategory, type ProductType } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useCan, useData, useRun, useWarmup } from '@/hooks/app'
import { fmtDate, todayISO, WEEKDAYS } from '@/lib/dates'
import { cn, formatINR } from '@/lib/utils'
import { products as api } from '@/services/api'

export default function Products() {
  const db = useData()
  const actor = useActor()
  const ready = useWarmup()
  const canWrite = useCan('product.write')
  const confirm = useConfirm()
  const { run } = useRun()
  const [view, setView] = React.useState<'grid' | 'list'>('grid')
  const [cat, setCat] = React.useState<'' | ProductCategory>('')
  const [status, setStatus] = React.useState('active')
  const [q, setQ] = React.useState('')
  const [dialog, setDialog] = React.useState<{ p?: Product } | null>(null)
  const agentId = actor.role === 'agent' ? actor.userId : null

  const rows = db.products.filter((p) => (!cat || p.category === cat) && (!status || p.status === status) && `${p.name} ${p.code} ${p.publisher}`.toLowerCase().includes(q.toLowerCase()))

  const remove = async (p: Product) => {
    const u = api.usage(p.id)
    const linked = u.invoices + u.subscriptions + u.deliveries > 0
    const ok = await confirm({
      title: linked ? `Archive ${p.name}?` : `Delete ${p.name}?`,
      description: linked ? (
        <>
          This product is linked to <b>{u.invoices} invoices</b>, <b>{u.subscriptions} subscriptions</b> and <b>{u.deliveries} delivery records</b>. To protect financial history it will be <b>archived</b>: hidden from new subscriptions, active subscriptions cancelled, history kept.
        </>
      ) : (
        'This product has no history and will be permanently deleted.'
      ),
      confirmLabel: linked ? 'Archive product' : 'Delete permanently',
      tone: 'destructive',
    })
    if (ok) await run(() => api.remove(p.id), (r) => (r === 'archived' ? `${p.name} archived` : `${p.name} deleted`))
  }

  const actions = (p: Product) =>
    canWrite && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Product actions" onClick={(e) => e.stopPropagation()}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setDialog({ p })}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/pricing?product=${p.id}`}>
              <Tags /> Manage prices
            </Link>
          </DropdownMenuItem>
          {p.status !== 'archived' && (
            <DropdownMenuItem onSelect={() => void run(() => api.update(p.id, { status: p.status === 'active' ? 'inactive' : 'active' }), p.status === 'active' ? 'Deactivated — hidden from new subscriptions' : 'Activated')}>
              <Power /> {p.status === 'active' ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => void remove(p)}>
            {api.usage(p.id).invoices ? <Archive /> : <Trash2 />} Delete / archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

  return (
    <>
      <PageHeader
        kicker="Catalogue"
        title="Products"
        description="Newspapers, magazines and periodicals. New products are instantly available in subscription forms."
        actions={
          canWrite && (
            <Button onClick={() => setDialog({})}>
              <Plus /> Add product
            </Button>
          )
        }
      />
      <div className="glass-card mb-5 grid gap-3 rounded-2xl border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_220px_160px_auto] lg:items-center">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search products, codes, publishers…" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-10" />
        </div>
        <NativeSelect value={cat} onChange={(e) => setCat(e.target.value as ProductCategory)} aria-label="Category">
          <option value="">All categories</option>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="archived">Archived</option>
          <option value="">All</option>
        </NativeSelect>
        <div className="flex items-center justify-between gap-3 sm:col-span-2 lg:col-span-1">
          <span className="kicker text-muted-foreground lg:hidden xl:inline">{rows.length} {rows.length === 1 ? 'product' : 'products'}</span>
          <Segmented value={view} onChange={setView} options={[{ value: 'grid', label: <LayoutGrid className="size-4" /> }, { value: 'list', label: <List className="size-4" /> }]} />
        </div>
      </div>

      {!rows.length ? (
        <EmptyState icon={Newspaper} title="No products match" description="Try another category or status." />
      ) : view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17.5rem),1fr))] gap-4 sm:gap-5">
          {rows.map((p, i) => {
            const price = resolvePrice(db, p.id, todayISO(), agentId)
            const next = upcomingVersion(db, p.id, todayISO())
            const TypeIcon = p.type === 'Newspaper' ? Newspaper : BookOpen
            return (
              <Card
                key={p.id}
                data-tilt
                style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                className={cn('group relative flex flex-col overflow-hidden transition-shadow duration-300 hover:shadow-pop', !ready && 'opacity-0', p.status !== 'active' && 'opacity-80')}
              >
                <div
                  className={cn('relative h-36 shrink-0 overflow-hidden', p.status !== 'active' && 'saturate-50')}
                  style={{ background: `linear-gradient(140deg, ${p.color}, color-mix(in oklab, ${p.color} 52%, #000))` }}
                >
                  {p.image ? (
                    <>
                      <img src={p.image} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out-expo group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-black/25" />
                    </>
                  ) : (
                    <>
                      <div className="absolute -left-10 -top-14 size-48 rounded-full bg-white/25 blur-2xl transition-transform duration-700 ease-out-expo group-hover:translate-x-6 group-hover:translate-y-3" />
                      <span aria-hidden className="absolute -bottom-9 -right-2 select-none font-display text-[132px] font-extrabold leading-none tracking-tighter text-white/[0.14] transition-transform duration-700 ease-out-expo group-hover:-translate-x-2 group-hover:-rotate-3">
                        {p.code}
                      </span>
                      <span className="depth absolute bottom-3.5 left-4 font-display text-[44px] font-extrabold leading-none tracking-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.25)]">{p.code}</span>
                    </>
                  )}
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider text-white ring-1 ring-inset ring-white/20">
                    <TypeIcon className="size-3" /> {p.type}
                  </span>
                  <span className="absolute right-2 top-2 [&_button]:text-white [&_button:hover]:bg-white/20">{actions(p)}</span>
                  <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[#11142a] shadow-sm">
                    <Repeat className="size-3" /> {FREQUENCY_META[p.defaultFrequency].label}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-display text-[18px] font-bold leading-tight tracking-tight text-primary">{p.name}</div>
                      <div className="truncate text-[12.5px] text-muted-foreground">{p.publisher}</div>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Badge tone="navy">{p.category}</Badge>
                    <Badge>{p.language}</Badge>
                    {p.availability !== 'Available' && <Badge tone="warning">{p.availability}</Badge>}
                  </div>
                  <div className="mt-auto pt-4">
                    {price ? (
                      <div className="flex items-end justify-between gap-3 rounded-xl bg-brand-soft p-3">
                        <div>
                          <div className="kicker text-muted-foreground">Customer price</div>
                          <div className="tabular text-gradient font-display text-[28px] font-extrabold leading-none">
                            {formatINR(price.customerPrice)}
                            <span className="ml-1 text-[11.5px] font-semibold text-muted-foreground [-webkit-text-fill-color:currentColor]">/copy</span>
                          </div>
                        </div>
                        <div className="space-y-0.5 text-right text-[11.5px] text-muted-foreground">
                          {actor.role === 'admin' && <PriceLine label="Purchase" v={price.purchasePrice} />}
                          <PriceLine label="Agent" v={price.agentPrice} />
                          {actor.role === 'agent' && <PriceLine label="Your margin" v={price.agentMargin} strong />}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl bg-muted/60 p-3 text-center text-[12.5px] text-muted-foreground">No price set</div>
                    )}
                    {next && (
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-warning/12 px-2.5 py-1 text-[11.5px] font-semibold text-warning">
                        <TrendingUp className="size-3" /> {formatINR(next.customerPrice)} from {fmtDate(next.effectiveFrom)}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(p) => p.id}
          exportName="products"
          columns={[
            { key: 'name', header: 'Product', sort: (p) => p.name, csv: (p) => p.name, cell: (p) => <span className="flex items-center gap-2 font-semibold"><span className="size-3 rounded-sm" style={{ background: p.color }} />{p.name}</span> },
            { key: 'code', header: 'Code', sort: (p) => p.code, cell: (p) => p.code },
            { key: 'cat', header: 'Category', sort: (p) => p.category, cell: (p) => p.category },
            { key: 'lang', header: 'Language', sort: (p) => p.language, cell: (p) => p.language },
            { key: 'freq', header: 'Default frequency', cell: (p) => FREQUENCY_META[p.defaultFrequency].label },
            { key: 'price', header: 'Customer price', align: 'right', sort: (p) => resolvePrice(db, p.id, todayISO(), agentId)?.customerPrice ?? 0, cell: (p) => formatINR(resolvePrice(db, p.id, todayISO(), agentId)?.customerPrice ?? 0) },
            { key: 'avail', header: 'Availability', cell: (p) => p.availability },
            { key: 'status', header: 'Status', sort: (p) => p.status, cell: (p) => <StatusBadge status={p.status} /> },
            { key: 'act', header: '', cell: (p) => actions(p) },
          ]}
        />
      )}
      {dialog && <ProductDialog p={dialog.p} onClose={() => setDialog(null)} />}
    </>
  )
}

function PriceLine({ label, v, strong }: { label: string; v: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-end gap-2">
      <span>{label}</span>
      <span className={cn('tabular text-[13px]', strong ? 'font-bold text-success' : 'font-semibold text-foreground')}>{formatINR(v)}</span>
    </div>
  )
}

async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const scale = Math.min(1, 480 / img.width)
  const c = document.createElement('canvas')
  c.width = img.width * scale
  c.height = img.height * scale
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(url)
  return c.toDataURL('image/jpeg', 0.8)
}

function ProductDialog({ p, onClose }: { p?: Product; onClose: () => void }) {
  const { run, pending } = useRun()
  const form = useForm(
    {
      name: p?.name ?? '',
      code: p?.code ?? '',
      category: p?.category ?? ('Malayalam Newspapers' as ProductCategory),
      publisher: p?.publisher ?? '',
      language: p?.language ?? 'Malayalam',
      type: p?.type ?? ('Newspaper' as ProductType),
      description: p?.description ?? '',
      image: p?.image ?? '',
      availability: p?.availability ?? ('Available' as Product['availability']),
      defaultFrequency: p?.defaultFrequency ?? ('daily' as Frequency),
      status: p?.status ?? ('active' as Product['status']),
      color: p?.color ?? '#14213d',
      lowStockThreshold: p?.lowStockThreshold ?? 3,
      company: p?.company ?? '',
      billCode: p?.billCode ?? '',
      hsnCode: p?.hsnCode ?? '',
      haveIssues: p?.haveIssues ?? false,
      maxIssues: p?.maxIssues ?? 1,
      publishWeekdays: p?.publishWeekdays ?? ([] as number[]),
      publishDates: p?.publishDates ?? ([] as number[]),
      remark: p?.remark ?? '',
      purchasePrice: 0,
      agentPrice: 0,
      customerPrice: 0,
    },
    (v) => ({
      name: rules.required(v.name, 'Product name'),
      code: rules.required(v.code, 'Product code') ?? (/^[A-Za-z0-9-]{2,10}$/.test(v.code) ? undefined : '2–10 letters/numbers.'),
      publisher: rules.required(v.publisher, 'Publisher'),
      customerPrice: p ? undefined : validatePriceTriple(v) ?? undefined,
    }),
  )
  const { values: v, set, errors } = form
  const db = useData()
  const weekdayFreq = (['daily', 'weekly', 'twice_weekly'] as Frequency[]).includes(v.defaultFrequency)
  const dateFreq = (['fortnightly', 'monthly', 'twice_monthly'] as Frequency[]).includes(v.defaultFrequency)
  /** Active master entries, plus the product's current value even if that entry was later switched off. */
  const options = (kind: MasterKind, current: string, fallback: string[] = []) => {
    const names = db.masters.filter((m) => m.kind === kind && m.status === 'active').map((m) => m.name)
    const list = names.length ? names : fallback
    return current && !list.some((n) => n.toLowerCase() === current.toLowerCase()) ? [current, ...list] : list
  }
  const toggle = <T extends number>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x].sort((a, b) => a - b))
  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const { purchasePrice, agentPrice, customerPrice, ...rest } = v
    const data = {
      ...rest,
      image: rest.image || undefined,
      company: rest.company || undefined,
      billCode: rest.billCode.trim() || undefined,
      hsnCode: rest.hsnCode.trim() || undefined,
      haveIssues: rest.haveIssues,
      maxIssues: rest.haveIssues ? rest.maxIssues : undefined,
      publishWeekdays: weekdayFreq ? rest.publishWeekdays : [],
      publishDates: dateFreq ? rest.publishDates : [],
      remark: rest.remark.trim() || undefined,
    }
    const ok = p ? await run(() => api.update(p.id, data), 'Product saved') : await run(() => api.create({ ...data, purchasePrice, agentPrice, customerPrice }), (x) => `${x.name} added — available in subscription forms`)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={p ? `Edit ${p.name}` : 'Add product'}>
        <FormSection n={1} title="The title" description="What it is and who publishes it.">
          <Field label="Product name" required error={errors.name}>
            <Input value={v.name} onChange={(e) => set('name', e.target.value)} aria-invalid={!!errors.name} />
          </Field>
          <Field label="Product code" required error={errors.code}>
            <Input value={v.code} onChange={(e) => set('code', e.target.value.toUpperCase())} aria-invalid={!!errors.code} />
          </Field>
          <Field label="Category" required>
            <NativeSelect value={v.category} onChange={(e) => set('category', e.target.value as ProductCategory)}>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Product type">
            <NativeSelect value={v.type} onChange={(e) => set('type', e.target.value as ProductType)}>
              {options('product_type', v.type, ['Newspaper', 'Magazine', 'Periodical', 'Book']).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Company">
            <NativeSelect value={v.company} onChange={(e) => set('company', e.target.value)}>
              <option value="">Select company</option>
              {options('company', v.company).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Publisher" required error={errors.publisher}>
            <Input value={v.publisher} onChange={(e) => set('publisher', e.target.value)} aria-invalid={!!errors.publisher} />
          </Field>
          <Field label="Language">
            <NativeSelect value={v.language} onChange={(e) => set('language', e.target.value)}>
              {options('language', v.language, ['Malayalam', 'English', 'Tamil', 'Hindi', 'Kannada']).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
        </FormSection>
        <FormSection n={2} title="Schedule and billing" description="When it comes out and how it shows on bills.">
          <Field label="Default subscription frequency">
            <NativeSelect value={v.defaultFrequency} onChange={(e) => set('defaultFrequency', e.target.value as Frequency)}>
              {Object.entries(FREQUENCY_META).map(([k, m]) => (
                <option key={k} value={k}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Availability">
            <NativeSelect value={v.availability} onChange={(e) => set('availability', e.target.value as Product['availability'])}>
              {['Available', 'Limited', 'Out of stock'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Bill code">
            <Input value={v.billCode} onChange={(e) => set('billCode', e.target.value.toUpperCase())} />
          </Field>
          <Field label="HSN code">
            <Input value={v.hsnCode} inputMode="numeric" onChange={(e) => set('hsnCode', e.target.value.replace(/\D/g, '').slice(0, 8))} />
          </Field>
          <div className="grid gap-3 @xl:col-span-2">
            <div className="grid gap-3 @xl:grid-cols-2">
              <Field label="Has numbered issues?">
                <Segmented
                  value={v.haveIssues ? 'yes' : 'no'}
                  onChange={(x) => set('haveIssues', x === 'yes')}
                  options={[
                    { value: 'no', label: 'No' },
                    { value: 'yes', label: 'Yes' },
                  ]}
                />
              </Field>
              {v.haveIssues && (
                <Field label="Maximum no. of issues">
                  <NativeSelect value={v.maxIssues} onChange={(e) => set('maxIssues', Number(e.target.value))}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            {weekdayFreq && (
              <Field label="Publication days" hint="Weekdays this title comes out. Leave empty if it is not fixed.">
                <Segmented multiple value={v.publishWeekdays} onChange={(d) => set('publishWeekdays', toggle(v.publishWeekdays, d))} options={WEEKDAYS.map((w, i) => ({ value: i, label: w }))} />
              </Field>
            )}
            {dateFreq && (
              <Field label="Publication dates" hint="Dates of the month this title comes out.">
                <Segmented multiple value={v.publishDates} onChange={(d) => set('publishDates', toggle(v.publishDates, d))} options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: i + 1 }))} />
              </Field>
            )}
            {!weekdayFreq && !dateFreq && <p className="text-[12.5px] text-muted-foreground">This frequency follows the subscription start date, so no fixed publication days are needed.</p>}
          </div>
        </FormSection>
        {!p && (
          <FormSection n={3} title="Pricing" description="Per copy. Change later in Pricing, so old bills keep their rates." className="@xl:grid-cols-3">
            <Field label="Agency purchase ₹" required>
              <Input type="number" step="0.5" min={0} value={v.purchasePrice || ''} onChange={(e) => set('purchasePrice', Number(e.target.value))} />
            </Field>
            <Field label="Agent price ₹" required>
              <Input type="number" step="0.5" min={0} value={v.agentPrice || ''} onChange={(e) => set('agentPrice', Number(e.target.value))} />
            </Field>
            <Field label="Customer price ₹" required error={errors.customerPrice}>
              <Input type="number" step="0.5" min={0} value={v.customerPrice || ''} onChange={(e) => set('customerPrice', Number(e.target.value))} />
            </Field>
            <p className="text-[12.5px] text-muted-foreground @xl:col-span-3">
              Agency margin {formatINR(Math.max(0, v.agentPrice - v.purchasePrice))} · Agent margin {formatINR(Math.max(0, v.customerPrice - v.agentPrice))}
            </p>
          </FormSection>
        )}
        <FormSection n={p ? 3 : 4} title="Look and notes" description="All optional.">
          <Field label="Product image">
            <div className="flex items-center gap-3">
              <div className="grid size-14 place-items-center overflow-hidden rounded-lg border border-border" style={{ background: v.color }}>
                {v.image ? <img src={v.image} alt="" className="h-full w-full object-cover" /> : <Newspaper className="size-5 text-white" />}
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-[13px] font-semibold hover:bg-accent">
                <ImagePlus className="size-4" /> Upload
                <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('image', await shrinkImage(f)) }} />
              </label>
              {v.image && (
                <button type="button" className="text-[12.5px] text-destructive" onClick={() => set('image', '')}>
                  Remove
                </button>
              )}
            </div>
          </Field>
          <Field label="Brand colour">
            <Input type="color" value={v.color} onChange={(e) => set('color', e.target.value)} className="h-11 p-1" />
          </Field>
          <Field label="Low-stock alert below">
            <Input type="number" min={0} value={v.lowStockThreshold} onChange={(e) => set('lowStockThreshold', Number(e.target.value))} />
          </Field>
          <Field label="Description" className="@xl:col-span-2">
            <Textarea rows={2} value={v.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Remark" className="@xl:col-span-2">
            <Textarea rows={2} value={v.remark} onChange={(e) => set('remark', e.target.value)} />
          </Field>
          {p && (
            <p className="text-[13px] text-muted-foreground @xl:col-span-2">
              Prices are versioned — change them in <Link to={`/pricing?product=${p.id}`} className="font-semibold text-primary underline">Pricing</Link> so past invoices keep their original rates.
            </p>
          )}
        </FormSection>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            {p ? 'Save product' : 'Add product'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
