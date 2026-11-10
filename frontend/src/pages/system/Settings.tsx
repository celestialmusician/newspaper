import { Bell, Database, Download, RotateCcw, Save, WifiOff } from 'lucide-react'
import * as React from 'react'
import { enablePush, promptInstall, useInstall } from '@/app/pwa'
import { Button } from '@/components/ui/button'
import { Field, Input, Switch, Textarea } from '@/components/ui/form'
import { Card, CardBody, CardHeader, DemoNote, PageHeader } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import type { SystemSettings } from '@/domain/types'
import { useData, useRun } from '@/hooks/app'
import { fmtDateTime } from '@/lib/dates'
import { settings as api } from '@/services/api'
import { setForcedOffline, useNetwork } from '@/services/offline'

export default function Settings() {
  const db = useData()
  const { run, pending } = useRun()
  const confirm = useConfirm()
  const forced = useNetwork((s) => s.forcedOffline)
  const install = useInstall()
  const [v, setV] = React.useState<SystemSettings>(db.settings)
  const set = <K extends keyof SystemSettings>(k: K, x: SystemSettings[K]) => setV((s) => ({ ...s, [k]: x }))
  const num = (k: keyof SystemSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never)

  return (
    <>
      <PageHeader
        kicker="System"
        title="Settings"
        description="Agency profile, billing rules, discount and pricing limits."
        actions={
          <Button loading={pending} onClick={() => void run(() => api.update(v), 'Settings saved')}>
            <Save /> Save settings
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Agency profile" description="Printed on invoices and receipts" />
          <CardBody className="grid gap-4">
            <Field label="Agency name">
              <Input value={v.agencyName} onChange={(e) => set('agencyName', e.target.value)} />
            </Field>
            <Field label="Address">
              <Textarea rows={2} value={v.agencyAddress} onChange={(e) => set('agencyAddress', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="GSTIN">
                <Input value={v.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} />
              </Field>
              <Field label="Support phone">
                <Input value={v.supportPhone} inputMode="numeric" onChange={(e) => set('supportPhone', e.target.value.replace(/\D/g, '').slice(0, 10))} />
              </Field>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Billing rules" />
          <CardBody className="grid grid-cols-2 gap-4">
            <Field label="Invoice prefix">
              <Input value={v.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Receipt prefix">
              <Input value={v.receiptPrefix} onChange={(e) => set('receiptPrefix', e.target.value.toUpperCase())} />
            </Field>
            <Field label="Payment due after (days)">
              <Input type="number" min={1} value={v.billingDueDays} onChange={num('billingDueDays')} />
            </Field>
            <Field label="Mark overdue after (days)">
              <Input type="number" min={1} value={v.overdueAfterDays} onChange={num('overdueAfterDays')} />
            </Field>
            <DemoNote className="col-span-2">Holiday and strike days are always billed at the fixed subscription rate. Concessions must be added as approved invoice adjustments.</DemoNote>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Discount & pricing limits" />
          <CardBody className="grid grid-cols-2 gap-4">
            <Field label="Max discount (admin) %">
              <Input type="number" min={0} max={100} value={v.adminMaxDiscountPct} onChange={num('adminMaxDiscountPct')} />
            </Field>
            <Field label="Default agent discount limit %">
              <Input type="number" min={0} max={100} value={v.defaultAgentMaxDiscountPct} onChange={num('defaultAgentMaxDiscountPct')} />
            </Field>
            <Field label="Agent-specific price range ±%" hint="How far an agent rate may move from base">
              <Input type="number" min={0} max={50} value={v.agentPriceMaxMarkupPct} onChange={num('agentPriceMaxMarkupPct')} />
            </Field>
            <Field label="Default low-stock threshold">
              <Input type="number" min={0} value={v.lowStockDefault} onChange={num('lowStockDefault')} />
            </Field>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="App & device" />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void promptInstall()} disabled={install.installed}>
                <Download /> {install.installed ? 'Installed' : 'Install app'}
              </Button>
              <Button variant="outline" onClick={() => void enablePush()}>
                <Bell /> Enable push notifications
              </Button>
            </div>
            <Switch checked={forced} onCheckedChange={setForcedOffline} label={<span className="inline-flex items-center gap-1.5"><WifiOff className="size-4" /> Simulate no internet (test offline delivery sync)</span>} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Demo data" icon={Database} description={`Seeded ${fmtDateTime(db.seededOn)} · ${db.customers.length} customers · ${db.subscriptions.length} subscriptions · ${Object.keys(db.deliveries).length} delivery records · ${db.invoices.length} invoices`} />
          <CardBody>
            <p className="mb-3 text-[14px] text-muted-foreground">This prototype stores data in your browser. Resetting restores the original Kerala sample data (your MPINs are kept).</p>
            <Button
              variant="destructive"
              onClick={async () => {
                if (await confirm({ title: 'Reset all demo data?', description: 'All changes made in this browser — customers, subscriptions, payments — will be replaced with the original sample data.', tone: 'destructive', confirmLabel: 'Reset data' })) {
                  await run(() => api.resetDemo(), 'Demo data restored')
                  setV(db.settings)
                }
              }}
            >
              <RotateCcw /> Reset demo data
            </Button>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
