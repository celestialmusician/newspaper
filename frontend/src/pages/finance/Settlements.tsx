import { IndianRupee, Landmark, Plus, TrendingUp, Wallet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import { Field, Input, NativeSelect } from '@/components/ui/form'
import { DemoNote, PageHeader, StatCard } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { userName } from '@/domain/access'
import { agentSettlement } from '@/domain/billing'
import type { ID } from '@/domain/types'
import { useCan, useRun, useScope } from '@/hooks/app'
import { fmtDate, fmtMonth, monthEndISO, todayISO } from '@/lib/dates'
import { formatINR, sum } from '@/lib/utils'
import { remittances } from '@/services/api'

export default function Settlements() {
  const { db, agents } = useScope()
  const canRemit = useCan('remittance.write')
  const [period, setPeriod] = React.useState('')
  const [remitFor, setRemitFor] = React.useState<ID | null>(null)
  const months = [...new Set(db.invoices.map((i) => i.periodStart))].sort().reverse()
  const rows = agents.map((a) => ({ a, s: period ? agentSettlement(db, a.id, period, monthEndISO(period)) : agentSettlement(db, a.id) }))
  const tot = (k: keyof (typeof rows)[number]['s']) => sum(rows.map((r) => r.s[k] as number))
  return (
    <>
      <PageHeader
        kicker="Finance"
        title="Agent settlement"
        description="Agency purchase → agent value → customer value, with margins, collections and remittances to the agency."
        actions={
          <NativeSelect value={period} onChange={(e) => setPeriod(e.target.value)} className="h-10 w-48" aria-label="Period">
            <option value="">All billed months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </NativeSelect>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Customer selling value" value={formatINR(tot('customerValue'), true)} icon={IndianRupee} />
        <StatCard label="Agency margin" value={formatINR(tot('agencyMargin'), true)} icon={TrendingUp} tone="success" hint={`On purchase ${formatINR(tot('purchaseValue'), true)}`} />
        <StatCard label="Agent margin" value={formatINR(tot('agentMargin'), true)} icon={TrendingUp} tone="info" />
        <StatCard label="Outstanding agent balance" value={formatINR(tot('outstandingAgentBalance'), true)} icon={Wallet} tone="danger" hint={`Remitted ${formatINR(tot('remitted'), true)}`} />
      </div>
      <div className="mt-4">
        <DataTable
          rows={rows}
          rowKey={(r) => r.a.id}
          exportName="agent-settlement"
          empty={{ icon: Landmark, title: 'No agents' }}
          columns={[
            { key: 'a', header: 'Agent', sort: (r) => r.a.name, csv: (r) => r.a.name, cell: (r) => <div><b>{r.a.name}</b><div className="text-[12px] text-muted-foreground">{r.a.agencyName}</div></div> },
            { key: 'pv', header: 'Purchase value', align: 'right', sort: (r) => r.s.purchaseValue, cell: (r) => formatINR(r.s.purchaseValue, true) },
            { key: 'av', header: 'Agent value', align: 'right', sort: (r) => r.s.agentValue, cell: (r) => formatINR(r.s.agentValue, true) },
            { key: 'cv', header: 'Customer value', align: 'right', sort: (r) => r.s.customerValue, cell: (r) => formatINR(r.s.customerValue, true) },
            { key: 'am', header: 'Agency margin', align: 'right', sort: (r) => r.s.agencyMargin, cell: (r) => <span className="text-success">{formatINR(r.s.agencyMargin, true)}</span> },
            { key: 'gm', header: 'Agent margin', align: 'right', sort: (r) => r.s.agentMargin, cell: (r) => <span className="text-info">{formatINR(r.s.agentMargin, true)}</span> },
            { key: 'cc', header: 'Customer collections', align: 'right', sort: (r) => r.s.customerCollections, cell: (r) => formatINR(r.s.customerCollections, true) },
            { key: 'ac', header: 'In-person collections', align: 'right', sort: (r) => r.s.agentCollections, cell: (r) => formatINR(r.s.agentCollections, true), hideOnMobile: true },
            { key: 'rm', header: 'Remitted', align: 'right', sort: (r) => r.s.remitted, cell: (r) => formatINR(r.s.remitted, true) },
            { key: 'ob', header: 'Owes agency', align: 'right', sort: (r) => r.s.outstandingAgentBalance, cell: (r) => <b className="text-destructive">{formatINR(r.s.outstandingAgentBalance, true)}</b> },
            ...(canRemit
              ? [
                  {
                    key: 'act',
                    header: '',
                    cell: (r: (typeof rows)[number]) => (
                      <Button size="sm" variant="outline" onClick={() => setRemitFor(r.a.id)}>
                        <Plus /> Remittance
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>
      <h2 className="mb-3 mt-6 font-display text-xl font-semibold text-primary">Remittance history</h2>
      <DataTable
        rows={db.remittances.filter((r) => agents.some((a) => a.id === r.agentId))}
        rowKey={(r) => r.id}
        initialSort={{ key: 'd', dir: 'desc' }}
        exportName="remittances"
        columns={[
          { key: 'd', header: 'Date', sort: (r) => r.date, cell: (r) => fmtDate(r.date) },
          { key: 'a', header: 'Agent', sort: (r) => userName(db, r.agentId), cell: (r) => userName(db, r.agentId) },
          { key: 'ref', header: 'Reference', cell: (r) => r.reference },
          { key: 'by', header: 'Recorded by', cell: (r) => userName(db, r.recordedBy) },
          { key: 'amt', header: 'Amount', align: 'right', sort: (r) => r.amount, cell: (r) => <b>{formatINR(r.amount)}</b> },
        ]}
      />
      <DemoNote className="mt-3">Outstanding agent balance = agent-price value of all billed copies − amount remitted to the agency.</DemoNote>
      {remitFor && <RemitDialog agentId={remitFor} onClose={() => setRemitFor(null)} />}
    </>
  )
}

function RemitDialog({ agentId, onClose }: { agentId: ID; onClose: () => void }) {
  const { db } = useScope()
  const { run, pending } = useRun()
  const s = agentSettlement(db, agentId)
  const [amount, setAmount] = React.useState(String(Math.max(0, s.outstandingAgentBalance)))
  const [date, setDate] = React.useState(todayISO())
  const [reference, setReference] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Record remittance" description={`${userName(db, agentId)} · owes ${formatINR(s.outstandingAgentBalance)}`}>
        <div className="space-y-3">
          <Field label="Amount (₹)" required>
            <Input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Reference" required>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="NEFT / UPI ref / cash slip no." />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              if (!reference.trim()) return toast.error('Enter the reference.')
              if (await run(() => remittances.create({ agentId, amount: Number(amount), date, reference }), 'Remittance recorded')) onClose()
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
