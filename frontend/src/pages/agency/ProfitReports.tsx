import { Search } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { Card, CardHeader, PageHeader } from '@/components/ui/misc'
import { draftInvoice } from '@/domain/billing'
import type { InvoiceLine } from '@/domain/types'
import { useActor, useData } from '@/hooks/app'
import { fmtDate, monthEndISO, monthStartISO, todayISO } from '@/lib/dates'
import { cn, formatINR, round2, sum } from '@/lib/utils'
import { QueryDesk } from '../console/shared'

/** A two-sided account: left column debits, right column credits, totals on the last row. */
function Account({ title, left, right, leftTitle, rightTitle }: { title: string; left: [string, number][]; right: [string, number][]; leftTitle: string; rightTitle: string }) {
  const n = Math.max(left.length, right.length)
  const lt = sum(left.map((x) => x[1]))
  const rt = sum(right.map((x) => x[1]))
  const total = Math.max(lt, rt)
  return (
    <Card>
      <CardHeader title={title} />
      {/* Phones: the two sides one under the other, each with its total. */}
      <div className="grid gap-4 px-4 pb-4 pt-3 sm:hidden">
        {(
          [
            [leftTitle === rightTitle ? 'Debit' : leftTitle, left],
            [leftTitle === rightTitle ? 'Credit' : rightTitle, right],
          ] as [string, [string, number][]][]
        ).map(([head, side]) => (
          <div key={head} className="overflow-hidden rounded-2xl border border-border/70">
            <div className="flex justify-between bg-muted/50 px-3 py-2 text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
              <span>{head}</span>
              <span>Amount</span>
            </div>
            {side.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-t border-border/50 px-3 py-2 text-sm">
                <span>{k}</span>
                <span className="tabular shrink-0">{formatINR(v)}</span>
              </div>
            ))}
            {!side.length && <div className="border-t border-border/50 px-3 py-3 text-center text-[13px] text-muted-foreground">Nothing for this period.</div>}
            <div className="flex justify-between border-t border-border/70 px-3 py-2.5 text-sm font-bold">
              <span>Total</span>
              <span className="tabular">{formatINR(total)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto px-5 pb-5 pt-3 sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70 text-left text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2">{leftTitle}</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">{rightTitle}</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => (
              <tr key={i} className="border-b border-border/50">
                <td className="px-3 py-2">{left[i]?.[0] ?? ''}</td>
                <td className="tabular px-3 py-2 text-right">{left[i] ? formatINR(left[i]![1]) : ''}</td>
                <td className="px-3 py-2">{right[i]?.[0] ?? ''}</td>
                <td className="tabular px-3 py-2 text-right">{right[i] ? formatINR(right[i]![1]) : ''}</td>
              </tr>
            ))}
            {!n && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing to show for this period.
                </td>
              </tr>
            )}
            <tr className="font-bold">
              <td className="px-3 py-2.5">Total</td>
              <td className="tabular px-3 py-2.5 text-right">{formatINR(total)}</td>
              <td className="px-3 py-2.5">Total</td>
              <td className="tabular px-3 py-2.5 text-right">{formatINR(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

const cost = (l: InvoiceLine) => l.quantity * l.agentPrice

/** Profit Forecasting: what the agency expects to spend and earn in a month from the subscriptions as they stand. */
export function ProfitForecasting() {
  const db = useData()
  const actor = useActor()
  const [month, setMonth] = React.useState(todayISO().slice(0, 7))
  const [applied, setApplied] = React.useState(month)

  const data = React.useMemo(() => {
    const from = `${applied}-01`
    const to = monthEndISO(from)
    const drafts = db.customers.filter((c) => c.agentId === actor.userId && !c.skipBill).map((c) => draftInvoice(db, c.id, from, to))
    const owned = new Set(db.products.filter((p) => p.ownerId === actor.userId).map((p) => p.id))
    const byProduct = new Map<string, { sales: number; cost: number }>()
    for (const l of drafts.flatMap((d) => d.lines)) {
      const e = byProduct.get(l.productName) ?? { sales: 0, cost: 0 }
      e.sales += l.amount
      e.cost += owned.has(l.productId) ? l.quantity * l.purchasePrice : cost(l)
      byProduct.set(l.productName, e)
    }
    const names = [...byProduct.keys()].sort()
    return {
      expense: [...names.map((n) => [`Papers — ${n}`, round2(byProduct.get(n)!.cost)] as [string, number]), ...(sum(drafts.map((d) => d.discount)) ? [['Discounts allowed', sum(drafts.map((d) => d.discount))] as [string, number]] : [])],
      income: [...names.map((n) => [`Sales — ${n}`, round2(byProduct.get(n)!.sales)] as [string, number]), ...(sum(drafts.map((d) => d.handlingCharge)) ? [['Handling charges', sum(drafts.map((d) => d.handlingCharge))] as [string, number]] : [])],
    }
  }, [applied, db, actor.userId])
  const profit = round2(sum(data.income.map((x) => x[1])) - sum(data.expense.map((x) => x[1])))

  return (
    <>
      <PageHeader kicker="Transactions" title="Profit Forecasting" description="Expected income and expense for a month, worked out from the current subscriptions and rates." />
      <QueryDesk
        filters={
          <>
          <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => { e.preventDefault(); setApplied(month) }}>
            <Field label="Month Year">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-48" />
            </Field>
            <Button type="submit">
              <Search /> Show
            </Button>
          </form>
          </>
        }
      >
        <Account title={`Forecast · ${fmtDate(`${applied}-01`).slice(3)}`} leftTitle="Expense" rightTitle="Income" left={data.expense} right={data.income} />
        <p className={cn('mt-3 px-1 text-[15px] font-semibold', profit >= 0 ? 'text-success' : 'text-destructive')}>
          {profit >= 0 ? 'Forecast profit' : 'Forecast loss'}: {formatINR(Math.abs(profit))}
        </p>
      </QueryDesk>
    </>
  )
}

/** Profit & Loss Statement: the trading account and profit and loss account for the bills of a period. */
export function ProfitLoss() {
  const db = useData()
  const actor = useActor()
  const today = todayISO()
  const [from, setFrom] = React.useState(monthStartISO(today))
  const [to, setTo] = React.useState(today)
  const [range, setRange] = React.useState({ from, to })

  const t = React.useMemo(() => {
    const owned = new Set(db.products.filter((p) => p.ownerId === actor.userId).map((p) => p.id))
    const invs = db.invoices.filter((i) => i.agentId === actor.userId && i.periodStart >= range.from && i.periodStart <= range.to)
    const lines = invs.flatMap((i) => i.lines)
    const sales = sum(lines.map((l) => l.amount))
    const purchases = sum(lines.map((l) => (owned.has(l.productId) ? l.quantity * l.purchasePrice : cost(l))))
    const discounts = sum(invs.map((i) => i.discount))
    const handling = sum(invs.map((i) => i.handlingCharge))
    const adjust = sum(invs.flatMap((i) => i.adjustments.map((a) => a.amount)))
    const gross = round2(sales - purchases)
    const net = round2(gross + handling + adjust - discounts)
    return { sales, purchases, discounts, handling, adjust, gross, net }
  }, [db, actor.userId, range])

  return (
    <>
      <PageHeader kicker="Transactions" title="Profit & Loss Statement" description="Worked out from the bills raised in the period." />
      <QueryDesk
        filters={
          <>
          <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => { e.preventDefault(); setRange({ from, to }) }}>
            <Field label="From Date">
              <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </Field>
            <Field label="To Date">
              <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </Field>
            <Button type="submit">
              <Search /> Show
            </Button>
          </form>
          </>
        }
      >
        <div className="grid gap-4">
          <Account title="Trading Account" leftTitle="Particulars" rightTitle="Particulars" left={[['Purchases (papers)', t.purchases], ...(t.gross >= 0 ? ([['Gross profit c/d', t.gross]] as [string, number][]) : [])]} right={[['Sales', t.sales], ...(t.gross < 0 ? ([['Gross loss c/d', -t.gross]] as [string, number][]) : [])]} />
          <Account
            title="Profit & Loss Account"
            leftTitle="Particulars"
            rightTitle="Particulars"
            left={[...(t.gross < 0 ? ([['Gross loss b/d', -t.gross]] as [string, number][]) : []), ['Discounts allowed', t.discounts], ...(t.adjust < 0 ? ([['Bill concessions', -t.adjust]] as [string, number][]) : []), ...(t.net >= 0 ? ([['Net profit', t.net]] as [string, number][]) : [])]}
            right={[...(t.gross >= 0 ? ([['Gross profit b/d', t.gross]] as [string, number][]) : []), ['Handling charges', t.handling], ...(t.adjust > 0 ? ([['Bill adjustments', t.adjust]] as [string, number][]) : []), ...(t.net < 0 ? ([['Net loss', -t.net]] as [string, number][]) : [])]}
          />
        </div>
      </QueryDesk>
    </>
  )
}
