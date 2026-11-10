import { Check, ShieldCheck, X } from 'lucide-react'
import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AreaMultiSelect } from '@/components/AreaMultiSelect'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Segmented } from '@/components/ui/form'
import { Avatar, Badge, PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, useConfirm } from '@/components/ui/overlay'
import type { AccountRequest } from '@/domain/types'
import { useData, useRun, useWarmup } from '@/hooks/app'
import { addDaysISO, fmtDateTime, todayISO } from '@/lib/dates'
import { formatINR, formatMobile } from '@/lib/utils'
import { accountRequests as api } from '@/services/api'

const REQUEST_VIEWS = ['pending', 'accepted', 'rejected', 'all'] as const
type RequestView = (typeof REQUEST_VIEWS)[number]

export default function Verification() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run } = useRun()
  const [accepting, setAccepting] = React.useState<AccountRequest | null>(null)
  const [params, setParams] = useSearchParams()
  const view: RequestView = (REQUEST_VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as RequestView) : 'pending'
  const counts: Record<RequestView, number> = {
    pending: db.accountRequests.filter((r) => r.status === 'pending').length,
    accepted: db.accountRequests.filter((r) => r.status === 'accepted').length,
    rejected: db.accountRequests.filter((r) => r.status === 'rejected').length,
    all: db.accountRequests.length,
  }
  const rows = db.accountRequests
    .filter((r) => view === 'all' || r.status === view)
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt))
    .map((r, i) => ({ r, n: i + 1 }))
  type Row = (typeof rows)[number]
  const pending = counts.pending

  const reject = async (r: AccountRequest) => {
    if (await confirm({ title: `Reject ${r.agencyName}?`, description: 'The agency will not get an account. You can still ask them to register again.', tone: 'destructive', confirmLabel: 'Reject' })) await run(() => api.reject(r.id), 'Registration rejected')
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (x) => x.n, cell: (x) => <span className="tabular text-muted-foreground">{x.n}</span>, className: 'w-14' },
    {
      key: 'agency',
      header: 'Account Name',
      sort: (x) => x.r.agencyName,
      csv: (x) => x.r.agencyName,
      hideOnMobile: true,
      cell: ({ r }) => (
        <div className="flex items-center gap-3">
          <Avatar name={r.agencyName} size={34} />
          <div>
            <div className="font-semibold">{r.agencyName}</div>
            <div className="text-[12px] text-muted-foreground">{r.ownerName}</div>
          </div>
        </div>
      ),
    },
    { key: 'no', header: 'Account No', sort: (x) => x.r.accountNo, cell: ({ r }) => <span className="font-mono text-[13px]">{r.accountNo}</span> },
    { key: 'contact', header: 'Mobile/E-mail', cell: ({ r }) => <div className="text-[13px]"><div className="tabular">{formatMobile(r.mobile)}</div><div className="text-muted-foreground">{r.email}</div></div>, csv: (x) => `${x.r.mobile} ${x.r.email}` },
    { key: 'loc', header: 'Country / State / District / City', cell: ({ r }) => <span className="text-[13px]">{r.location}</span>, hideOnMobile: true, csv: (x) => x.r.location },
    { key: 'otp', header: 'OTP', cell: ({ r }) => (r.status === 'pending' ? <span className="tabular rounded-md bg-muted px-2 py-0.5 font-mono text-[13px] font-semibold tracking-widest">{r.otp}</span> : '—'), hideOnMobile: true },
    { key: 'at', header: 'Created Date', sort: (x) => x.r.createdAt, cell: ({ r }) => <span className="whitespace-nowrap text-[13px]">{fmtDateTime(r.createdAt)}</span> },
    {
      key: 'act',
      header: 'Accept / Reject',
      sort: (x) => x.r.status,
      csv: (x) => x.r.status,
      cell: ({ r }) =>
        r.status === 'pending' ? (
          <div className="flex gap-1.5">
            <Button size="sm" variant="success" onClick={() => setAccepting(r)}>
              <Check /> Accept
            </Button>
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => void reject(r)}>
              <X /> Reject
            </Button>
          </div>
        ) : (
          <Badge tone={r.status === 'accepted' ? 'success' : 'danger'} dot>
            {r.status === 'accepted' ? 'Accepted' : 'Rejected'}
          </Badge>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        kicker="Licence console"
        title="Account Verification"
        description={
          view === 'pending'
            ? pending
              ? `${pending} new agency registration${pending > 1 ? 's' : ''} waiting for your decision.`
              : 'New agency registrations appear here for approval.'
            : view === 'accepted'
              ? `${counts.accepted} registration${counts.accepted === 1 ? '' : 's'} accepted and now active accounts.`
              : view === 'rejected'
                ? `${counts.rejected} registration${counts.rejected === 1 ? '' : 's'} rejected.`
                : `Every registration, newest decisions first: ${counts.all} in total.`
        }
      />
      <div className="-mx-1 mb-4 overflow-x-auto px-1 pb-1">
        <Segmented
          value={view}
          onChange={(v) => setParams(v === 'pending' ? {} : { view: v }, { replace: true })}
          options={REQUEST_VIEWS.map((v) => ({
            value: v,
            label: (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {v[0]!.toUpperCase() + v.slice(1)}
                <span className={`tabular rounded-full px-1.5 text-[11px] font-bold ${v === view ? 'bg-brand-soft text-masthead' : 'bg-background/60 text-muted-foreground'}`}>{counts[v]}</span>
              </span>
            ),
          }))}
          className="flex-nowrap"
        />
      </div>
      <DataTable
        key={view}
        mobileActions="bottom"
        mobileTitle={(x) => (
          <span className="flex items-center gap-3">
            <Avatar name={x.r.agencyName} size={34} />
            <span className="min-w-0">
              <span className="block font-semibold">
                {x.n}. {x.r.agencyName}
              </span>
              <span className="block text-[12px] text-muted-foreground">{x.r.ownerName}</span>
            </span>
          </span>
        )}
        loading={!ready}
        rows={rows}
        columns={cols}
        rowKey={(x) => x.r.id}
        search={({ r }) => `${r.agencyName} ${r.ownerName} ${r.mobile} ${r.email} ${r.location}`}
        exportName={`account-verification-${view}`}
        empty={{ icon: ShieldCheck, title: view === 'pending' ? 'No new registrations' : `No ${view} registrations`, description: view === 'pending' ? 'You are all caught up.' : 'Nothing here yet.' }}
      />
      {accepting && <AcceptDialog req={accepting} onClose={() => setAccepting(null)} />}
    </>
  )
}

function AcceptDialog({ req, onClose }: { req: AccountRequest; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const primary = db.licencePlans.find((p) => p.primary)
  const [areaIds, setAreaIds] = React.useState<string[]>([])
  const [planId, setPlanId] = React.useState(primary?.id ?? '')
  const [licenceEnd, setLicenceEnd] = React.useState(addDaysISO(todayISO(), 365))
  const [userLimit, setUserLimit] = React.useState(3)
  const save = async () => {
    if (!areaIds.length) return toast.error('Assign at least one service area.')
    const ok = await run(() => api.accept(req.id, { areaIds, planId: planId || null, licenceEnd, userLimit }), (a) => `${a.agencyName} is now active as ${a.code}`)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={`Accept ${req.agencyName}`} description={`${req.ownerName} · ${formatMobile(req.mobile)}. The agency signs in with this mobile number and creates an MPIN with an OTP.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Service areas" required className="sm:col-span-2">
            <AreaMultiSelect value={areaIds} onChange={setAreaIds} />
          </Field>
          <Field label="Licence plan">
            <NativeSelect value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">No plan</option>
              {db.licencePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatINR(p.netAmount, true)}
                  {p.primary ? ' (primary)' : ''}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Licence valid till">
            <Input type="date" min={addDaysISO(todayISO(), 1)} value={licenceEnd} onChange={(e) => setLicenceEnd(e.target.value)} />
          </Field>
          <Field label="Users allowed" hint="Agent plus delivery-executive logins">
            <Input type="number" min={1} value={userLimit} onChange={(e) => setUserLimit(Number(e.target.value))} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="success" onClick={save} loading={pending}>
            <Check /> Accept account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
