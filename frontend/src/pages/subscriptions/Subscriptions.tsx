import { LayoutGrid, List, Plus, Repeat } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { scheduleText, SubscriptionCards, SubscriptionDialog } from '@/components/subscriptions'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { NativeSelect, Segmented } from '@/components/ui/form'
import { PageHeader, StatusBadge } from '@/components/ui/misc'
import { executiveOf, userName } from '@/domain/access'
import { resolvePrice } from '@/domain/pricing'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import { FREQUENCY_META, type Frequency } from '@/domain/types'
import { useCan, useScope, useWarmup } from '@/hooks/app'
import { fmtDate, todayISO } from '@/lib/dates'
import { formatINR } from '@/lib/utils'

export default function Subscriptions() {
  const { db, actor, subscriptions, customers } = useScope()
  const ready = useWarmup()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const canWrite = useCan('subscription.write')
  const [open, setOpen] = React.useState(params.get('new') === '1')
  const [view, setView] = React.useState<'list' | 'cards'>(actor.role === 'customer' ? 'cards' : 'list')
  const [status, setStatus] = React.useState('')
  const [freq, setFreq] = React.useState<'' | Frequency>('')
  const [product, setProduct] = React.useState('')

  const rows = subscriptions.filter((s) => (!status || deriveSubscriptionStatus(s) === status) && (!freq || s.frequency === freq) && (!product || s.productId === product))
  const isCustomer = actor.role === 'customer'

  return (
    <>
      <PageHeader
        kicker={isCustomer ? 'My account' : 'Subscriptions'}
        title={isCustomer ? 'My subscriptions' : 'Subscriptions'}
        description={isCustomer ? 'Add newspapers and magazines, change delivery days, pause while travelling, or renew.' : 'Every subscription drives the delivery calendar and monthly billing automatically.'}
        actions={
          canWrite && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New subscription
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-36" aria-label="Status">
          <option value="">All statuses</option>
          {['active', 'paused', 'expired', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={freq} onChange={(e) => setFreq(e.target.value as Frequency)} className="h-10 w-40" aria-label="Frequency">
          <option value="">Any frequency</option>
          {Object.entries(FREQUENCY_META).map(([k, m]) => (
            <option key={k} value={k}>
              {m.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={product} onChange={(e) => setProduct(e.target.value)} className="h-10 w-48" aria-label="Product">
          <option value="">All products</option>
          {db.products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        <Segmented className="ml-auto" value={view} onChange={setView} options={[{ value: 'list', label: <List className="size-4" /> }, { value: 'cards', label: <LayoutGrid className="size-4" /> }]} />
      </div>

      {view === 'cards' ? (
        <SubscriptionCards subs={rows} showCustomer={!isCustomer} />
      ) : (
        <DataTable
          loading={!ready}
          rows={rows}
          rowKey={(s) => s.id}
          search={(s) => `${userName(db, s.customerId)} ${db.products.find((p) => p.id === s.productId)?.name}`}
          onRowClick={(s) => (isCustomer ? setView('cards') : navigate(`/customers/${s.customerId}?tab=subscriptions`))}
          exportName="subscriptions"
          empty={{ icon: Repeat, title: 'No subscriptions', description: 'Create one to start deliveries.' }}
          columns={[
            {
              key: 'product',
              header: 'Product',
              sort: (s) => db.products.find((p) => p.id === s.productId)?.name ?? '',
              csv: (s) => db.products.find((p) => p.id === s.productId)?.name ?? '',
              cell: (s) => {
                const p = db.products.find((x) => x.id === s.productId)!
                return (
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="h-6 w-1 rounded-full" style={{ background: p.color }} />
                    {p.name}
                  </span>
                )
              },
            },
            ...(!isCustomer ? [{ key: 'customer', header: 'Customer', sort: (s: (typeof rows)[number]) => userName(db, s.customerId), cell: (s: (typeof rows)[number]) => userName(db, s.customerId) }] : []),
            { key: 'freq', header: 'Frequency', sort: (s) => s.frequency, cell: (s) => <div><div>{FREQUENCY_META[s.frequency].label}</div><div className="text-[12px] text-muted-foreground">{scheduleText(s)}</div></div>, csv: (s) => FREQUENCY_META[s.frequency].label },
            { key: 'qty', header: 'Qty', align: 'right', sort: (s) => s.quantity, cell: (s) => s.quantity },
            { key: 'price', header: 'Price', align: 'right', cell: (s) => formatINR(resolvePrice(db, s.productId, todayISO(), db.customers.find((c) => c.id === s.customerId)?.agentId)?.customerPrice ?? 0) },
            { key: 'start', header: 'Start', sort: (s) => s.startDate, cell: (s) => fmtDate(s.startDate), hideOnMobile: true },
            { key: 'end', header: 'End', sort: (s) => s.endDate ?? s.cancelledOn ?? '9999', cell: (s) => (s.cancelledOn ? `Cancelled ${fmtDate(s.cancelledOn)}` : fmtDate(s.endDate)), hideOnMobile: true },
            { key: 'exec', header: 'Executive', cell: (s) => executiveOf(db, db.customers.find((c) => c.id === s.customerId)!)?.name ?? '—', hideOnMobile: true },
            { key: 'status', header: 'Status', sort: (s) => deriveSubscriptionStatus(s), cell: (s) => <StatusBadge status={deriveSubscriptionStatus(s)} /> },
          ]}
        />
      )}
      <SubscriptionDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o && params.get('new')) setParams({}, { replace: true })
        }}
        mode="new"
        customerId={isCustomer ? actor.userId : undefined}
        customerOptions={customers.filter((c) => c.status === 'active')}
      />
    </>
  )
}
