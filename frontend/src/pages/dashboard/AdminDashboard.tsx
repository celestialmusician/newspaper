import { BadgeCheck, CalendarClock, Lock, MonitorSmartphone, RefreshCcw, UserPlus } from 'lucide-react'
import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { DashboardHero } from '@/components/fx/Hero'
import { PageSkeleton, StatCard } from '@/components/ui/misc'
import { useData, useWarmup } from '@/hooks/app'
import { inAccountView, type AccountView } from '@/domain/accountViews'
import { todayISO } from '@/lib/dates'

/** License Admin Console — the Super Administrator's home: six counters, each opening its screen. */
export default function AdminDashboard() {
  const db = useData()
  const ready = useWarmup()
  const navigate = useNavigate()
  const t = todayISO()
  const [now] = React.useState(() => Date.now())

  const m = React.useMemo(() => {
    const lic = db.licences.flatMap((l) => {
      const a = db.agents.find((x) => x.id === l.agentId)
      return a ? [{ l, a }] : []
    })
    const count = (v: AccountView) => lic.filter(({ l, a }) => inAccountView(v, l, a, t)).length
    return {
      registrations: db.accountRequests.filter((r) => r.status === 'pending').length,
      active: count('active'),
      deactive: count('deactive'),
      expiry: count('expiry'),
      online: lic.filter(({ l }) => l.lastLoginAt && now - new Date(l.lastLoginAt).getTime() < 30 * 60_000).length,
      total: lic.length,
      renewals: count('renewal'),
    }
  }, [db, t, now])

  if (!ready) return <PageSkeleton />

  return (
    <>
      <DashboardHero
        kicker="Super Administrator"
        title={
          <>
            License <span className="text-gradient">Admin Console</span>
          </>
        }
        description="New registrations, agency accounts, licence expiry and who is online."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard index={0} label="No of new registrations" value={m.registrations} hint="Waiting for approval" icon={UserPlus} tone="warning" onClick={() => navigate('/verification?view=pending')} />
        <StatCard index={1} label="No of active accounts" value={m.active} hint="Can sign in today" icon={BadgeCheck} tone="success" onClick={() => navigate('/accounts?view=active')} />
        <StatCard index={2} label="No of deactive accounts" value={m.deactive} hint="Locked or switched off" icon={Lock} tone="danger" onClick={() => navigate('/accounts?view=deactive')} />
        <StatCard index={3} label="No of accounts expiry" value={m.expiry} hint="Ends within 30 days" icon={CalendarClock} tone="accent" onClick={() => navigate('/accounts?view=expiry')} />
        <StatCard index={4} label="Activity monitor" value={`${m.online} / ${m.total}`} hint="Online in last 30 min" icon={MonitorSmartphone} tone="info" onClick={() => navigate('/control-room?view=online')} />
        <StatCard index={5} label="Renewal request" value={m.renewals} hint="Asked to extend" icon={RefreshCcw} tone="success" onClick={() => navigate('/accounts?view=renewal')} />
      </div>
    </>
  )
}

export function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'
}
