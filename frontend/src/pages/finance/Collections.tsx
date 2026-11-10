import { AlertTriangle, HandCoins, IndianRupee, Users, Wallet } from 'lucide-react'
import * as React from 'react'
import { BillDialog } from '@/components/BillDialog'
import { PaymentTable } from '@/components/records'
import { DataTable } from '@/components/ui/data-table'
import { Avatar, Card, CardBody, CardHeader, PageHeader, Progress, StatCard, StatusBadge } from '@/components/ui/misc'
import { executiveOf, userName } from '@/domain/access'
import { customerOutstanding, invoiceRemaining, isOverdue } from '@/domain/billing'
import { useScope } from '@/hooks/app'
import { diffDays, fmtDate, todayISO } from '@/lib/dates'
import { formatINR, formatMobile, sum } from '@/lib/utils'
import { useNetwork } from '@/services/offline'

export default function Collections() {
  const { db, actor, customers, invoices, payments } = useScope()
  const [billFor, setBillFor] = React.useState<string | null>(null)
  const allQueued = useNetwork((s) => s.queue)
  const queue = allQueued.filter((q) => q.kind === 'payment')
  const t = todayISO()

  const dues = React.useMemo(
    () =>
      customers
        .map((c) => {
          const open = invoices.filter((i) => i.customerId === c.id && invoiceRemaining(i) > 0)
          const oldest = open.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]
          return { c, due: customerOutstanding(db, c.id), overdue: open.some((i) => isOverdue(i)), days: oldest ? Math.max(0, diffDays(t, oldest.dueDate)) : 0, oldest }
        })
        .filter((x) => x.due > 0),
    [customers, invoices, db, t],
  )
  const total = sum(dues.map((d) => d.due))
  const todayPays = payments.filter((p) => p.date === t)
  const myToday = payments.filter((p) => p.date === t && p.collectedBy === actor.userId)
  const collected = sum(payments.map((p) => p.amount))
  const isExec = actor.role === 'executive'

  const agentRows = db.agents.map((a) => {
    const inv = db.invoices.filter((i) => i.agentId === a.id)
    const billed = sum(inv.map((i) => i.currentBill))
    const out = sum(inv.map(invoiceRemaining))
    return { name: a.name, Collected: sum(db.payments.filter((p) => p.agentId === a.id).map((p) => p.amount)), Outstanding: out, billed, rate: billed ? ((billed - out) / billed) * 100 : 0 }
  })

  return (
    <>
      <PageHeader
        kicker="Collections"
        title={isExec ? 'Payment collection' : 'Payment dues & collection'}
        description={isExec ? 'Customers on your route with pending bills. Tap a name to open the bill and record cash — works offline too.' : 'Who owes what, how overdue, and what came in today.'}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total outstanding" value={formatINR(total, true)} icon={Wallet} tone="danger" hint={`${dues.length} customers`} />
        <StatCard label="Overdue" value={formatINR(sum(dues.filter((d) => d.overdue).map((d) => d.due)), true)} icon={AlertTriangle} tone="warning" hint={`${dues.filter((d) => d.overdue).length} customers past due date`} />
        {isExec ? (
          <StatCard label="Collected by me today" value={formatINR(sum(myToday.map((p) => p.amount)), true)} icon={HandCoins} tone="success" hint={`${myToday.length} receipts${queue.length ? ` · ${queue.length} offline` : ''}`} />
        ) : (
          <StatCard label="Today's collection" value={formatINR(sum(todayPays.map((p) => p.amount)), true)} icon={HandCoins} tone="success" hint={`${todayPays.length} receipts`} />
        )}
        <StatCard label={isExec ? 'Pending verification' : 'Total collected'} value={isExec ? payments.filter((p) => p.collectedBy === actor.userId && !p.verified).length : formatINR(collected, true)} icon={IndianRupee} />
      </div>

      {actor.role === 'admin' && (
        <Card className="mt-4">
          <CardHeader title="Agent-wise collection" description="Collected, still outstanding and the share of billing collected" />
          {/* One row of figures per agent, best collection rate first. */}
          <CardBody className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            {agentRows
              .slice()
              .sort((a, b) => b.rate - a.rate)
              .map((a) => (
                <div key={a.name} className="min-w-0 text-[13px]">
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <b className="truncate text-[14px]">{a.name}</b>
                    <span className="tabular font-display text-[18px] font-semibold text-primary">{a.rate.toFixed(0)}%</span>
                  </div>
                  <Progress value={a.rate} tone={a.rate > 85 ? 'success' : 'warning'} />
                  <div className="tabular mt-1.5 flex justify-between text-[12.5px] text-muted-foreground">
                    <span>Collected {formatINR(a.Collected, true)}</span>
                    <span className="text-destructive">Due {formatINR(a.Outstanding, true)}</span>
                  </div>
                </div>
              ))}
          </CardBody>
        </Card>
      )}

      <div className="mt-4">
        <DataTable
          rows={dues}
          rowKey={(d) => d.c.id}
          onRowClick={(d) => setBillFor(d.c.id)}
          initialSort={{ key: 'due', dir: 'desc' }}
          search={(d) => `${d.c.name} ${d.c.mobile} ${d.c.code}`}
          exportName="dues"
          empty={{ icon: Users, title: 'No pending payments', description: 'Everyone is paid up.' }}
          mobileAside={(d) => <span className="tabular text-[15px] font-bold text-destructive">{formatINR(d.due)}</span>}
          columns={[
            {
              key: 'name',
              header: 'Customer',
              sort: (d) => d.c.name,
              csv: (d) => d.c.name,
              cell: (d) => (
                <div className="flex items-center gap-3">
                  <Avatar name={d.c.name} size={32} />
                  <div>
                    <div className="font-semibold">{d.c.name}</div>
                    <div className="text-[12px] text-muted-foreground">{d.c.houseName}</div>
                  </div>
                </div>
              ),
            },
            { key: 'mobile', header: 'Mobile', cell: (d) => <a href={`tel:${d.c.mobile}`} onClick={(e) => e.stopPropagation()} className="tabular hover:text-primary">{formatMobile(d.c.mobile)}</a> },
            ...(isExec ? [] : [{ key: 'exec', header: 'Executive', hideOnMobile: true, cell: (d: (typeof dues)[number]) => executiveOf(db, d.c)?.name ?? '—' }]),
            ...(actor.role === 'admin' ? [{ key: 'agent', header: 'Agent', hideOnMobile: true, sort: (d: (typeof dues)[number]) => userName(db, d.c.agentId), cell: (d: (typeof dues)[number]) => userName(db, d.c.agentId) }] : []),
            { key: 'inv', header: 'Oldest due', sort: (d) => d.oldest?.dueDate ?? '', cell: (d) => (d.oldest ? `${d.oldest.number} · ${fmtDate(d.oldest.dueDate)}` : '—'), hideOnMobile: true },
            { key: 'days', header: 'Status', sort: (d) => d.days, cell: (d) => (d.overdue ? <StatusBadge status="overdue" label={`${d.days} days overdue`} /> : <StatusBadge status="pending" label="Not yet due" />) },
            { key: 'due', header: 'Outstanding', align: 'right', sort: (d) => d.due, cell: (d) => <span className="tabular font-bold text-destructive">{formatINR(d.due)}</span> },
          ]}
        />
      </div>

      {!isExec && (
        <div className="mt-6">
          <h2 className="mb-3 font-display text-xl font-semibold text-primary">Collection history</h2>
          <PaymentTable payments={payments} exportName="collection-history" />
        </div>
      )}
      {isExec && myToday.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 font-display text-xl font-semibold text-primary">Today's collection summary</h2>
          <PaymentTable payments={myToday} />
        </div>
      )}
      <BillDialog customerId={billFor} open={!!billFor} onOpenChange={(o) => !o && setBillFor(null)} />
    </>
  )
}
