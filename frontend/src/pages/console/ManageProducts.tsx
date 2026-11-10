import { Building2, Newspaper } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Segmented, Switch, Textarea } from '@/components/ui/form'
import { FormActions } from '@/components/ui/form-guide'
import { PageHeader, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { DrawerBody, FormDrawer } from '@/components/ui/workspace'
import { WorkspaceCtx } from '@/components/ui/workspace-ctx'
import { useConfirm } from '@/components/ui/overlay'
import type { Frequency, Master, Product } from '@/domain/types'
import { rules, useForm } from '@/hooks/form'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { WEEKDAYS } from '@/lib/dates'
import { masters as masterApi, products as api } from '@/services/api'
import { RowActions } from './shared'

const SUB_OF_FREQUENCY: Partial<Record<Frequency, string>> = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnight', every_14_days: 'Fortnightly', monthly: 'Monthly', custom: 'Yearly' }
export const subTypeOf = (p: Pick<Product, 'subscriptionType' | 'defaultFrequency'>) => p.subscriptionType ?? SUB_OF_FREQUENCY[p.defaultFrequency] ?? p.defaultFrequency.replace(/_/g, ' ')

const MON_FIRST = [1, 2, 3, 4, 5, 6, 0]
const blankCompany = { name: '', shortName: '', address: '', website: '', active: true }
const blankProduct = {
  company: '',
  active: true,
  billCode: '',
  name: '',
  language: '',
  hsnCode: '',
  type: '',
  subscriptionType: '',
  haveIssues: false,
  maxIssues: 1,
  publishWeekdays: [] as number[],
  publishDates: [] as number[],
  startDate: '',
  intervalDays: 14,
  remark: '',
}

export default function ManageProducts() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [mode, setMode] = React.useState<'company' | 'product'>('product')
  const [open, setOpen] = React.useState(false)
  const [editCompany, setEditCompany] = React.useState<Master | null>(null)
  const [editProduct, setEditProduct] = React.useState<Product | null>(null)
  const [filter, setFilter] = React.useState('')
  const actor = useActor()
  const owner = actor.role === 'agent' ? actor.userId : undefined
  /** The main agency's shared entries are visible to every agency but only the owner may change them. */
  const mine = (o?: string) => o === owner
  const visible = (o?: string) => mine(o) || (owner !== undefined && o === undefined)

  const companies = db.masters.filter((m) => m.kind === 'company' && visible(m.ownerId))
  // Subscription types and payment modes are per agency; languages and product types are shared.
  const active = (kind: Master['kind']) => db.masters.filter((m) => m.kind === kind && m.status === 'active' && (kind === 'subscription_type' || kind === 'company' ? (kind === 'company' ? visible(m.ownerId) : m.ownerId === owner) : !m.ownerId))

  const cForm = useForm(blankCompany, (v) => ({ name: rules.required(v.name, 'Company name') }))
  const pForm = useForm(blankProduct, (v) => ({
    company: rules.required(v.company, 'Company'),
    name: rules.required(v.name, 'Product name'),
    type: rules.required(v.type, 'Product type'),
    subscriptionType: rules.required(v.subscriptionType, 'Subscription type'),
  }))
  const c = cForm.values
  const p = pForm.values
  const sub = p.subscriptionType
  const showIssues = !!sub && sub !== 'Daily'
  const chosenCompany = companies.find((x) => x.name === p.company)

  const resetCompany = () => {
    setEditCompany(null)
    cForm.reset(blankCompany)
  }
  const resetProduct = () => {
    setEditProduct(null)
    pForm.reset(blankProduct)
  }
  const startEditCompany = (m: Master) => {
    setMode('company')
    setEditCompany(m)
    cForm.reset({ name: m.name, shortName: m.shortName ?? '', address: m.address ?? '', website: m.website ?? '', active: m.status === 'active' })
  }
  const startEditProduct = (x: Product) => {
    setMode('product')
    setEditProduct(x)
    pForm.reset({
      company: x.company ?? '',
      active: x.status === 'active',
      billCode: x.billCode ?? '',
      name: x.name,
      language: x.language,
      hsnCode: x.hsnCode ?? '',
      type: x.type,
      subscriptionType: subTypeOf(x),
      haveIssues: !!x.haveIssues,
      maxIssues: x.maxIssues ?? 1,
      publishWeekdays: x.publishWeekdays ?? [],
      publishDates: x.publishDates ?? [],
      startDate: x.startDate ?? '',
      intervalDays: x.intervalDays ?? 14,
      remark: x.remark ?? '',
    })
  }

  const saveCompany = async () => {
    if (!cForm.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(
      () => masterApi.save({ id: editCompany?.id, kind: 'company', name: c.name.trim(), shortName: c.shortName.trim() || undefined, address: c.address.trim() || undefined, website: c.website.trim() || undefined, status: c.active ? 'active' : 'inactive' }),
      editCompany ? 'Company updated' : 'Company saved',
    )
    if (ok) resetCompany()
    return !!ok
  }
  const saveProduct = async () => {
    if (!pForm.check()) return toast.error('Please fix the highlighted fields.')
    const ok = await run(
      () =>
        api.saveBasic({
          id: editProduct?.id,
          name: p.name,
          billCode: p.billCode,
          company: p.company,
          language: p.language,
          hsnCode: p.hsnCode,
          type: p.type,
          subscriptionType: p.subscriptionType,
          haveIssues: showIssues && p.haveIssues,
          maxIssues: p.maxIssues,
          publishWeekdays: p.publishWeekdays,
          publishDates: p.publishDates,
          startDate: p.startDate,
          intervalDays: p.intervalDays,
          remark: p.remark,
          status: p.active ? 'active' : 'inactive',
        }),
      editProduct ? 'Product updated' : 'Product saved — set its rates in Product Wise Rate',
    )
    if (ok) resetProduct()
    return !!ok
  }
  const editing = !!(editCompany || editProduct)
  const closeDrawer = () => {
    resetCompany()
    resetProduct()
    setOpen(false)
  }
  const removeCompany = async (m: Master) => {
    if (await confirm({ title: `Delete ${m.name}?`, description: 'No product uses this company, so it can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => masterApi.remove(m.id), 'Company deleted')
      if (editCompany?.id === m.id) resetCompany()
    }
  }
  const removeProduct = async (x: Product) => {
    if (await confirm({ title: `Delete ${x.name}?`, description: 'It has no subscriptions, deliveries or invoices, so it can be removed.', tone: 'destructive', confirmLabel: 'Delete' })) {
      await run(() => api.remove(x.id), 'Product deleted')
      if (editProduct?.id === x.id) resetProduct()
    }
  }

  const companyRows = companies.map((m, i) => ({ m, n: i + 1, used: masterApi.usage(m) }))
  type CRow = (typeof companyRows)[number]
  const productRows = db.products.filter((x) => x.status !== 'archived' && visible(x.ownerId) && (!filter || x.company === filter)).map((x, i) => ({ x, n: i + 1, used: Object.values(api.usage(x.id)).reduce((a, b) => a + b, 0) }))
  type PRow = (typeof productRows)[number]

  const companyCols: Column<CRow>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    { key: 'name', header: 'Company Name', sort: (r) => r.m.name, cell: (r) => <span className="font-semibold">{r.m.name}</span>, csv: (r) => r.m.name, hideOnMobile: true },
    { key: 'status', header: 'Status', sort: (r) => r.m.status, cell: (r) => <StatusBadge status={r.m.status} />, csv: (r) => r.m.status },
    { key: 'act', header: '', cell: (r) => (mine(r.m.ownerId) ? <RowActions onEdit={() => startEditCompany(r.m)} onDelete={() => void removeCompany(r.m)} lockedReason={r.used ? `Used by ${r.used} product${r.used > 1 ? 's' : ''}` : undefined} /> : <RowActions lockedReason="Shared by the main agency" />) },
  ]
  const productCols: Column<PRow>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    { key: 'name', header: 'Product Name', sort: (r) => r.x.name, cell: (r) => <span className="flex items-center gap-2 font-semibold"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: r.x.color }} />{r.x.name}</span>, csv: (r) => r.x.name, hideOnMobile: true },
    { key: 'bill', header: 'Bill Code', sort: (r) => r.x.billCode ?? r.x.code, cell: (r) => <span className="font-mono text-[13px]">{r.x.billCode ?? r.x.code}</span> },
    { key: 'sub', header: 'Subscription Type', sort: (r) => subTypeOf(r.x), cell: (r) => subTypeOf(r.x), csv: (r) => subTypeOf(r.x) },
    { key: 'status', header: 'Status', sort: (r) => r.x.status, cell: (r) => <StatusBadge status={r.x.status} />, csv: (r) => r.x.status },
    { key: 'act', header: '', cell: (r) => (mine(r.x.ownerId) ? <RowActions onEdit={() => startEditProduct(r.x)} onDelete={() => void removeProduct(r.x)} lockedReason={r.used ? 'Linked to subscriptions or invoices — deactivate instead' : undefined} /> : <RowActions lockedReason="Shared by the main agency — set your own rate in Product Wise Rate" />) },
  ]

  return (
    <>
      <PageHeader kicker="Agent Console" title="Manage Products" description="Companies and the titles they publish. Set each title's rates in Product Wise Rate." />

      <Tabs value={mode} onValueChange={(x) => setMode(x as 'company' | 'product')}>
        <TabsList>
          <TabsTrigger value="product">
            <Newspaper className="size-4" /> Products · {productRows.length}
          </TabsTrigger>
          <TabsTrigger value="company">
            <Building2 className="size-4" /> Companies · {companyRows.length}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="product">
          <WorkspaceCtx.Provider value={{ open, setOpen: (o) => { setMode('product'); setOpen(o) }, noun: 'product' }}>
            <DataTable
              cardAvatar={(r) => r.x.name}
              loading={!ready}
              rows={productRows}
              columns={productCols}
              rowKey={(r) => r.x.id}
              mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.x.name}</span>}
              search={(r) => `${r.x.name} ${r.x.billCode ?? r.x.code} ${r.x.company ?? ''}`}
              statusOf={(r) => (r.x.status === 'active' ? 'active' : 'inactive')}
              exportName="products"
              empty={{ icon: Newspaper, title: 'No products yet' }}
              toolbar={
                <NativeSelect value={filter} onChange={(e) => setFilter(e.target.value)} className="h-10 w-48" aria-label="Filter by company">
                  <option value="">All</option>
                  {companies.map((m) => (
                    <option key={m.id}>{m.name}</option>
                  ))}
                </NativeSelect>
              }
            />
          </WorkspaceCtx.Provider>
        </TabsContent>
        <TabsContent value="company">
          <WorkspaceCtx.Provider value={{ open, setOpen: (o) => { setMode('company'); setOpen(o) }, noun: 'company' }}>
            <DataTable cardAvatar={(r) => r.m.name} loading={!ready} rows={companyRows} columns={companyCols} rowKey={(r) => r.m.id} mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.m.name}</span>} search={(r) => r.m.name} statusOf={(r) => r.m.status} exportName="companies" empty={{ icon: Building2, title: 'No companies yet' }} />
          </WorkspaceCtx.Provider>
        </TabsContent>
      </Tabs>

      <FormDrawer
        open={open || !!editing}
        onClose={closeDrawer}
        kicker="Manage Products & Subscriptions"
        title={editCompany ? `Edit ${editCompany.name}` : editProduct ? `Edit ${editProduct.name}` : mode === 'company' ? 'New company' : 'New product'}
      >
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={async (e) => {
            e.preventDefault()
            if ((await (mode === 'company' ? saveCompany() : saveProduct())) === true) setOpen(false)
          }}
        >
          <DrawerBody className="grid content-start gap-4">
            <Field label="Add Type">
            <NativeSelect
              value={mode}
              disabled={!!editing}
              onChange={(e) => {
                setMode(e.target.value as 'company' | 'product')
                resetCompany()
                resetProduct()
              }}
            >
              <option value="company">Company</option>
              <option value="product">Product</option>
            </NativeSelect>
            </Field>
            {mode === 'company' ? (
              <div className="@container grid gap-3 @xl:grid-cols-2">
                <Field label="Company Name" required error={cForm.errors.name}>
                  <Input value={c.name} placeholder="Enter Company Name" onChange={(e) => cForm.set('name', e.target.value)} aria-invalid={!!cForm.errors.name} />
                </Field>
                <Field label="Short Name">
                  <Input value={c.shortName} placeholder="Short Name" onChange={(e) => cForm.set('shortName', e.target.value)} />
                </Field>
                <Field label="Address">
                  <Textarea rows={1} value={c.address} placeholder="Address" onChange={(e) => cForm.set('address', e.target.value)} className="min-h-11" />
                </Field>
                <Field label="Website">
                  <Input value={c.website} placeholder="Enter Website" onChange={(e) => cForm.set('website', e.target.value)} />
                </Field>
                <Switch checked={c.active} onCheckedChange={(x) => cForm.set('active', x)} label="Active / Deactive" />
              </div>
            ) : (
              <div className="@container grid gap-3 @xl:grid-cols-2">
                <Field label="Company Name" required error={pForm.errors.company}>
                  <NativeSelect value={p.company} onChange={(e) => pForm.set('company', e.target.value)} aria-invalid={!!pForm.errors.company}>
                    <option value="">Select Company</option>
                    {active('company').map((m) => (
                      <option key={m.id}>{m.name}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Short Name">
                  <Input value={chosenCompany?.shortName ?? ''} placeholder="Short Name" readOnly disabled />
                </Field>
                <Field label="Address">
                  <Input value={chosenCompany?.address ?? ''} placeholder="Address" readOnly disabled />
                </Field>
                <Field label="Website">
                  <Input value={chosenCompany?.website ?? ''} placeholder="Enter Website" readOnly disabled />
                </Field>

                <Field label="Bill Code">
                  <Input value={p.billCode} placeholder="Bill Code" onChange={(e) => pForm.set('billCode', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Product Name" required error={pForm.errors.name}>
                  <Input value={p.name} placeholder="Product Name" onChange={(e) => pForm.set('name', e.target.value)} aria-invalid={!!pForm.errors.name} />
                </Field>
                <Field label="Select Language">
                  <NativeSelect value={p.language} onChange={(e) => pForm.set('language', e.target.value)}>
                    <option value="">Select Language</option>
                    {active('language').map((m) => (
                      <option key={m.id}>{m.name}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="HSN Code">
                  <Input value={p.hsnCode} placeholder="HSN Code" inputMode="numeric" onChange={(e) => pForm.set('hsnCode', e.target.value.replace(/\D/g, '').slice(0, 8))} />
                </Field>
                <Field label="Select Product Type" required error={pForm.errors.type}>
                  <NativeSelect value={p.type} onChange={(e) => pForm.set('type', e.target.value)} aria-invalid={!!pForm.errors.type}>
                    <option value="">Select Product Type</option>
                    {active('product_type').map((m) => (
                      <option key={m.id}>{m.name}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="Select Subscription Type" required error={pForm.errors.subscriptionType}>
                  <NativeSelect value={p.subscriptionType} onChange={(e) => pForm.set('subscriptionType', e.target.value)} aria-invalid={!!pForm.errors.subscriptionType}>
                    <option value="">Select Sub Type</option>
                    {active('subscription_type').map((m) => (
                      <option key={m.id}>{m.name}</option>
                    ))}
                  </NativeSelect>
                </Field>

                {showIssues && (
                  <>
                    <Field label="Have issues?" required>
                      <NativeSelect value={p.haveIssues ? 'yes' : 'no'} onChange={(e) => pForm.set('haveIssues', e.target.value === 'yes')}>
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </NativeSelect>
                    </Field>
                    {p.haveIssues && (
                      <Field label="Maximum no of issues" required>
                        <NativeSelect value={p.maxIssues} onChange={(e) => pForm.set('maxIssues', Number(e.target.value))}>
                          {[1, 2, 3, 4, 5].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </NativeSelect>
                      </Field>
                    )}
                  </>
                )}
                {sub === 'Weekly' && (
                  <Field label="Week Days" required className="@xl:col-span-2">
                    <Segmented multiple value={p.publishWeekdays} onChange={(d) => pForm.set('publishWeekdays', p.publishWeekdays.includes(d) ? p.publishWeekdays.filter((x) => x !== d) : [...p.publishWeekdays, d])} options={MON_FIRST.map((d) => ({ value: d, label: WEEKDAYS[d]! }))} />
                  </Field>
                )}
                {(sub === 'Fortnight' || sub === 'Monthly') && (
                  <Field label="Dates" required className="@xl:col-span-2">
                    <Segmented multiple value={p.publishDates} onChange={(d) => pForm.set('publishDates', p.publishDates.includes(d) ? p.publishDates.filter((x) => x !== d) : [...p.publishDates, d].sort((a, b) => a - b))} options={Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: i + 1 }))} />
                  </Field>
                )}
                {sub === 'Fortnightly' && (
                  <>
                    <Field label="Start Date">
                      <Input type="date" value={p.startDate} onChange={(e) => pForm.set('startDate', e.target.value)} />
                    </Field>
                    <Field label="Interval (days)">
                      <Input type="number" min={1} value={p.intervalDays} onChange={(e) => pForm.set('intervalDays', Number(e.target.value))} />
                    </Field>
                  </>
                )}

                <Field label="Remark" className="@xl:col-span-2">
                  <Textarea rows={2} value={p.remark} onChange={(e) => pForm.set('remark', e.target.value)} />
                </Field>
                <Switch checked={p.active} onCheckedChange={(x) => pForm.set('active', x)} label="Active / Deactive" />
              </div>
            )}
          </DrawerBody>
          <FormActions className="in-drawer">
            <Button type="button" variant="outline" onClick={closeDrawer}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {editing ? 'Save changes' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </FormDrawer>
    </>
  )
}
