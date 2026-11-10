import { ArrowLeft, Building2, Lock, LogIn, MapPin, Pencil, Route as RouteIcon, Search, Truck, Unlock, Users } from 'lucide-react'
import * as React from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CustomerDialog } from '@/components/CustomerDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form'
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, StatCard } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { useData, useRun } from '@/hooks/app'
import { diffDays, fmtDateTime, todayISO } from '@/lib/dates'
import { formatMobile } from '@/lib/utils'
import { licences as api } from '@/services/api'
import { AgentDialog } from '../people/Agents'
import { ExecutiveDialog } from '../people/Executives'
import { AccountDetails } from './TruncatePanel'

const SHOWN = 8

/**
 * Agency profile for the Super Administrator. A notification ("New agency registered", "signed in
 * for the first time") opens it. Shows who the agency is, how it is doing and its account details
 * (editable), with the two actions the administrator uses most: lock and root login. The owner,
 * the delivery boys and the customers of the agency can all be edited from here.
 */
export default function AccountProfile() {
  const { id } = useParams()
  const db = useData()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { run } = useRun()
  const [owner, setOwner] = React.useState(false)
  const [boy, setBoy] = React.useState<string | null>(null)
  const [cust, setCust] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [all, setAll] = React.useState(false)
  const a = db.agents.find((x) => x.id === id)
  const l = db.licences.find((x) => x.agentId === id)
  if (!a || !l) return <EmptyState icon={Building2} title="Account not found" description="It may have been deleted." action={<Button onClick={() => navigate('/accounts')}>Back to accounts</Button>} />

  const today = todayISO()
  const left = diffDays(l.licenceEnd, today)
  const isNew = diffDays(today, l.registeredOn) <= 7
  const users = 1 + db.executives.filter((e) => e.agentId === a.id).length
  const boys = db.executives.filter((e) => e.agentId === a.id)
  const mine = db.customers.filter((c) => c.agentId === a.id)
  const needle = q.trim().toLowerCase()
  const found = needle ? mine.filter((c) => `${c.name} ${c.code} ${c.mobile}`.toLowerCase().includes(needle)) : mine
  const customers = all || needle ? found : found.slice(0, SHOWN)
  const areas = a.areaIds.map((x) => db.locations.find((n) => n.id === x)?.name).filter(Boolean) as string[]

  const toggleLock = async () => {
    const lock = !l.locked
    if (!lock || (await confirm({ title: `Lock ${a.agencyName}?`, description: 'Nobody from this agency — agent or delivery executives — can sign in until you unlock it. Their data is kept.', tone: 'destructive', confirmLabel: 'Lock account' }))) await run(() => api.setLocked(a.id, lock), lock ? 'Account locked' : 'Account unlocked')
  }
  const rootLogin = async () => {
    if (l.locked) return void confirm({ title: 'Account is locked', description: 'Unlock the account before opening it.', confirmLabel: 'OK' })
    if (await run(() => api.rootLogin(a.id), `Signed in as ${a.agencyName}`)) navigate('/')
  }

  return (
    <>
      <Link to="/accounts" className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Accounts
      </Link>
      <Card className="mb-4 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <Avatar name={a.agencyName} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[26px] font-semibold leading-tight text-primary sm:text-3xl">{a.agencyName}</h1>
            {isNew && <Badge tone="info" dot>New</Badge>}
            {l.locked ? <Badge tone="danger" dot>Locked</Badge> : a.status !== 'active' ? <Badge tone="warning" dot>Inactive</Badge> : left < 0 ? <Badge tone="danger" dot>Expired</Badge> : <Badge tone="success" dot>Active</Badge>}
          </div>
          <div className="mt-1 text-[14px] text-muted-foreground">
            {a.name} · {formatMobile(a.mobile)}
            {a.email ? ` · ${a.email}` : ''}
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            {l.accountNo} · {a.code}
            {left >= 0 ? ` · licence valid ${left} more day${left === 1 ? '' : 's'}` : ` · licence ended ${-left} day${left === -1 ? '' : 's'} ago`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOwner(true)}>
            <Pencil /> Edit owner
          </Button>
          <Button variant="outline" className="border-warning/40 text-warning hover:text-warning" onClick={() => void toggleLock()}>
            {l.locked ? <Unlock /> : <Lock />} {l.locked ? 'Unlock' : 'Lock'}
          </Button>
          <Button variant="outline" className="border-info/40 text-info hover:text-info" onClick={() => void rootLogin()}>
            <LogIn /> Root Login
          </Button>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard index={0} label="Users" value={`${users}/${l.userLimit}`} icon={Users} tone="info" hint="Agent and delivery boys" />
        <StatCard index={1} label="Customers" value={db.customers.filter((c) => c.agentId === a.id).length} icon={Building2} tone="success" hint="Subscribers" />
        <StatCard index={2} label="Delivery boys" value={db.executives.filter((e) => e.agentId === a.id).length} icon={Truck} tone="accent" hint="On the team" />
        <StatCard index={3} label="Routes" value={db.routes.filter((r) => r.agentId === a.id).length} icon={RouteIcon} tone="warning" hint="Delivery routes" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <AccountDetails key={a.id} agentId={a.id} />
        <div className="grid gap-4">
          <Card>
            <CardHeader title="Delivery boys" icon={Truck} description={`${boys.length} on the team`} />
            <CardBody className="grid gap-1.5">
              {boys.length ? (
                boys.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold">{e.name}</div>
                      <div className="truncate text-[12.5px] text-muted-foreground">
                        {e.code} · {formatMobile(e.mobile)}
                        {e.status !== 'active' ? ` · ${e.status}` : ''}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setBoy(e.id)} aria-label={`Edit ${e.name}`}>
                      <Pencil /> Edit
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-[13.5px] text-muted-foreground">No delivery boys yet.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Customers" icon={Users} description={`${mine.length} subscribers`} />
            <CardBody className="grid gap-2">
              {mine.length > SHOWN && (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID or mobile" className="pl-9" aria-label="Search customers" />
                </div>
              )}
              {customers.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{c.name}</div>
                    <div className="truncate text-[12.5px] text-muted-foreground">
                      {c.code} · {formatMobile(c.mobile)}
                      {c.status !== 'active' ? ` · ${c.status}` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setCust(c.id)} aria-label={`Edit ${c.name}`}>
                    <Pencil /> Edit
                  </Button>
                </div>
              ))}
              {!customers.length && <p className="text-[13.5px] text-muted-foreground">{mine.length ? 'No customer matches.' : 'No customers yet.'}</p>}
              {!needle && !all && found.length > SHOWN && (
                <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
                  Show all {found.length}
                </Button>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Sign-in" description="When this agency last used NewsRound." />
            <CardBody className="grid gap-2 text-[14px]">
              {l.lastLoginAt ? (
                <>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Last sign-in</div>
                    <div className="font-semibold">{fmtDateTime(l.lastLoginAt)}</div>
                  </div>
                  {l.lastIp && (
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">IP address</div>
                      <div className="truncate font-mono text-[13px]">{l.lastIp}</div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Has not signed in yet. It signs in with +91 {a.mobile} and creates an MPIN with an OTP.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Service areas" icon={MapPin} />
            <CardBody>
              {areas.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {areas.map((n) => (
                    <Badge key={n} tone="navy">
                      {n}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-[13.5px] text-muted-foreground">No service areas yet.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
      {owner && <AgentDialog agent={a} onClose={() => setOwner(false)} />}
      {boy && <ExecutiveDialog ex={db.executives.find((e) => e.id === boy)} onClose={() => setBoy(null)} />}
      <CustomerDialog open={!!cust} onOpenChange={(o) => !o && setCust(null)} customer={db.customers.find((c) => c.id === cust)} />
    </>
  )
}
