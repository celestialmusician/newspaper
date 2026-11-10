import { BadgeCheck, CalendarPlus, Eraser, Lock, LogIn, Plus, Trash2, Unlock } from 'lucide-react'
import * as React from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Segmented } from '@/components/ui/form'
import { Avatar, Badge, PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter, Tooltip, useConfirm } from '@/components/ui/overlay'
import { ACCOUNT_VIEWS, ACCOUNT_VIEW_ORDER, inAccountView, isAccountView, type AccountView } from '@/domain/accountViews'
import { useData, useRun, useWarmup } from '@/hooks/app'
import { addDaysISO, diffDays, fmtDate, todayISO } from '@/lib/dates'
import { cn, formatINR, formatMobile } from '@/lib/utils'
import { licences as api } from '@/services/api'
import { AddAgencyPanel } from './AddAgency'
import { TruncatePanel } from './TruncatePanel'

export default function Accounts() {
  const db = useData()
  const ready = useWarmup()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { run } = useRun()
  const today = todayISO()
  const [params, setParams] = useSearchParams()
  const view: AccountView = isAccountView(params.get('view')) ? (params.get('view') as AccountView) : 'active'
  const [renewing, setRenewing] = React.useState<{ agentId: string; name: string } | null>(null)
  const [truncating, setTruncating] = React.useState<string | null>(null)
  const [adding, setAdding] = React.useState(false)

  const all = React.useMemo(
    () =>
      db.licences.flatMap((l) => {
        const a = db.agents.find((x) => x.id === l.agentId)
        return a ? [{ l, a, users: 1 + db.executives.filter((e) => e.agentId === l.agentId).length, left: diffDays(l.licenceEnd, today) }] : []
      }),
    [db, today],
  )
  const counts = React.useMemo(() => Object.fromEntries(ACCOUNT_VIEW_ORDER.map((v) => [v, all.filter((r) => inAccountView(v, r.l, r.a, today)).length])) as Record<AccountView, number>, [all, today])
  const rows = React.useMemo(
    () =>
      all
        .filter((r) => inAccountView(view, r.l, r.a, today))
        .sort((x, y) => (view === 'expiry' ? x.left - y.left : 0))
        .map((r, i) => ({ ...r, n: i + 1 })),
    [all, view, today],
  )
  type Row = (typeof rows)[number]
  const info = ACCOUNT_VIEWS[view]

  const lockToggle = async (r: Row) => {
    const lock = !r.l.locked
    if (!lock || (await confirm({ title: `Lock ${r.a.agencyName}?`, description: 'Nobody from this agency — agent or delivery executives — can sign in until you unlock it. Their data is kept.', tone: 'destructive', confirmLabel: 'Lock account' }))) await run(() => api.setLocked(r.a.id, lock), lock ? 'Account locked' : 'Account unlocked')
  }
  const remove = async (r: Row) => {
    const u = api.linked(r.a.id)
    if (u.customers || u.executives || u.routes || u.invoices) {
      await confirm({ title: 'Cannot delete this agency', description: `${r.a.agencyName} has ${u.customers} customers, ${u.executives} executives, ${u.routes} routes and ${u.invoices} invoices. Lock the account instead — history stays intact.`, confirmLabel: 'Understood' })
      return
    }
    if (await confirm({ title: `Delete ${r.a.agencyName}?`, description: 'This agency has no customers or billing history, so it can be removed permanently.', tone: 'destructive', confirmLabel: 'Delete' })) await run(() => api.remove(r.a.id), 'Account deleted')
  }
  const rootLogin = async (r: Row) => {
    if (r.l.locked) return void confirm({ title: 'Account is locked', description: 'Unlock the account before opening it.', confirmLabel: 'OK' })
    if (await run(() => api.rootLogin(r.a.id), `Signed in as ${r.a.agencyName}`)) navigate('/')
  }

  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => <span className="tabular text-muted-foreground">{r.n}</span>, className: 'w-14' },
    {
      key: 'name',
      header: 'Account Name',
      sort: (r) => r.a.agencyName,
      csv: (r) => r.a.agencyName,
      hideOnMobile: true,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={r.a.agencyName} size={34} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{r.a.agencyName}</div>
            <div className="text-[12px] leading-snug text-muted-foreground">
              {r.a.name} · <span className="whitespace-nowrap">{formatMobile(r.a.mobile)}</span>
            </div>
          </div>
        </div>
      ),
    },
    { key: 'no', header: 'Account Number', sort: (r) => r.l.accountNo, cell: (r) => <span className="tabular whitespace-nowrap font-mono text-[13px]">{r.l.accountNo}</span> },
    { key: 'users', header: 'No Of Users', align: 'center', sort: (r) => r.users, cell: (r) => <span className={r.users > r.l.userLimit ? 'font-semibold text-destructive' : 'tabular'}>{r.users}/{r.l.userLimit}</span>, csv: (r) => `${r.users}/${r.l.userLimit}` },
    {
      key: 'reg',
      header: 'Reg / Verified',
      label: 'Reg / Verified Date',
      sort: (r) => r.l.registeredOn,
      csv: (r) => `${r.l.registeredOn} / ${r.l.verifiedOn}`,
      cell: (r) => (
        <div className="whitespace-nowrap text-[13px] leading-tight">
          <div>{fmtDate(r.l.registeredOn)}</div>
          <div className="text-[12px] text-muted-foreground">Verified {fmtDate(r.l.verifiedOn)}</div>
        </div>
      ),
    },
    {
      key: 'end',
      header: 'License End Date',
      sort: (r) => r.l.licenceEnd,
      csv: (r) => r.l.licenceEnd,
      cell: (r) => (
        <div className="whitespace-nowrap text-[13px] leading-tight">
          <div>{fmtDate(r.l.licenceEnd)}</div>
          {r.left < 0 ? <Badge tone="danger" className="mt-1">Expired</Badge> : r.left <= 30 ? <Badge tone="warning" className="mt-1">{r.left}d left</Badge> : null}
        </div>
      ),
    },
    ...(view === 'deactive' || view === 'all'
      ? [
          {
            key: 'state',
            header: 'Status',
            sort: (r: Row) => (r.l.locked ? 'Locked' : r.a.status !== 'active' ? 'Inactive' : 'Active'),
            csv: (r: Row) => (r.l.locked ? 'Locked' : r.a.status !== 'active' ? 'Inactive' : 'Active'),
            cell: (r: Row) => (r.l.locked ? <Badge tone="danger" dot>Locked</Badge> : r.a.status !== 'active' ? <Badge tone="warning" dot>Agent inactive</Badge> : r.left < 0 ? <Badge tone="danger" dot>Expired</Badge> : <Badge tone="success" dot>Active</Badge>),
          } satisfies Column<Row>,
        ]
      : []),
    ...(view === 'renewal'
      ? [
          {
            key: 'renewal',
            header: 'Request',
            sort: (r: Row) => r.left,
            csv: (r: Row) => `Renewal requested, ${r.left} days left`,
            cell: (r: Row) => (
              <div>
                <Badge tone="info" dot>Requested</Badge>
                <div className="mt-1 text-[12px] text-muted-foreground">{r.left < 0 ? `Expired ${-r.left} days ago` : `${r.left} days left`}</div>
              </div>
            ),
          } satisfies Column<Row>,
        ]
      : []),
    {
      key: 'act',
      header: 'Action',
      cell: (r) => (
        <div className="acct-actions" onClick={(e) => e.stopPropagation()}>
          {(view === 'expiry' || view === 'renewal' || view === 'all') && (
            <Tooltip content={r.l.renewalRequested ? 'Renew (requested)' : 'Renew'}>
              <button type="button" className={cn('acct-act is-success', r.l.renewalRequested && 'is-hot')} aria-label="Renew" onClick={() => setRenewing({ agentId: r.a.id, name: r.a.agencyName })}>
                <CalendarPlus />
              </button>
            </Tooltip>
          )}
          <Tooltip content={r.l.locked ? 'Unlock' : 'Lock'}>
            <button type="button" className={cn('acct-act is-warning', r.l.locked && 'is-hot')} aria-label={r.l.locked ? 'Unlock' : 'Lock'} onClick={() => void lockToggle(r)}>
              {r.l.locked ? <Unlock /> : <Lock />}
            </button>
          </Tooltip>
          <Tooltip content="Truncate">
            <button type="button" className="acct-act is-brand" aria-label="Truncate" onClick={() => setTruncating(r.a.id)}>
              <Eraser />
            </button>
          </Tooltip>
          <Tooltip content="Root Login">
            <button type="button" className="acct-act is-info" aria-label="Root Login" onClick={() => void rootLogin(r)}>
              <LogIn />
            </button>
          </Tooltip>
          <Tooltip content="Delete">
            <button type="button" className="acct-act is-danger" aria-label="Delete" onClick={() => void remove(r)}>
              <Trash2 />
            </button>
          </Tooltip>
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        kicker="Licence console"
        title={info.title}
        description={`${counts[view]} ${counts[view] === 1 ? 'account' : 'accounts'}. ${info.description}`}
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add agency
          </Button>
        }
      />
      {/* One tab per list, each with its own count: the dashboard counters open the matching tab. */}
      <div className="-mx-1 mb-4 overflow-x-auto px-1 pb-1">
        <Segmented
          value={view}
          onChange={(v) => setParams(v === 'active' ? {} : { view: v }, { replace: true })}
          options={ACCOUNT_VIEW_ORDER.map((v) => ({
            value: v,
            label: (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {ACCOUNT_VIEWS[v].tab}
                <span className={`tabular rounded-full px-1.5 text-[11px] font-bold ${v === view ? 'bg-brand-soft text-masthead' : 'bg-background/60 text-muted-foreground'}`}>{counts[v]}</span>
              </span>
            ),
          }))}
          className="flex-nowrap"
        />
      </div>
      <DataTable
        className="acct-table"
        mobileActions="bottom"
        key={view}
        loading={!ready}
        rows={rows}
        columns={cols}
        rowKey={(r) => r.a.id}
        onRowClick={(r) => navigate(`/accounts/${r.a.id}`)}
        mobileTitle={(r) => <span className="font-semibold">{r.n}. {r.a.agencyName}</span>}
        search={(r) => `${r.a.agencyName} ${r.a.name} ${r.a.mobile} ${r.l.accountNo}`}
        exportName={`accounts-${view}`}
        empty={{ icon: BadgeCheck, title: info.emptyTitle, description: info.emptyText }}
      />
      {renewing && <RenewDialog agentId={renewing.agentId} name={renewing.name} onClose={() => setRenewing(null)} />}
      <TruncatePanel agentId={truncating} onClose={() => setTruncating(null)} />
      <AddAgencyPanel open={adding} onClose={() => setAdding(false)} />
    </>
  )
}

/** Extend one agency's licence: new end date, plan and user limit. Clears its renewal request. */
function RenewDialog({ agentId, name, onClose }: { agentId: string; name: string; onClose: () => void }) {
  const db = useData()
  const { run, pending } = useRun()
  const lic = db.licences.find((l) => l.agentId === agentId)!
  const today = todayISO()
  const [planId, setPlanId] = React.useState(lic.planId ?? '')
  const [licenceEnd, setLicenceEnd] = React.useState(addDaysISO(lic.licenceEnd > today ? lic.licenceEnd : today, 365))
  const [userLimit, setUserLimit] = React.useState(lic.userLimit)
  const save = async () => {
    const ok = await run(() => api.update(agentId, { planId: planId || null, licenceEnd, userLimit }), `${name} renewed till ${fmtDate(licenceEnd)}`)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={`Renew ${name}`} description={`Current licence ends ${fmtDate(lic.licenceEnd)}. A year is added from the later of that date and today.`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Licence plan">
            <NativeSelect value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">No plan</option>
              {db.licencePlans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatINR(p.netAmount, true)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Licence valid till">
            <Input type="date" min={addDaysISO(today, 1)} value={licenceEnd} onChange={(e) => setLicenceEnd(e.target.value)} />
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
            <CalendarPlus /> Renew licence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
