import { BadgeCheck, Building, ImagePlus, Percent, Receipt, Tags } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Field, Input, NativeSelect, Switch, Textarea } from '@/components/ui/form'
import { Badge, Card, CardBody, CardHeader, KeyValue, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { useConfirm } from '@/components/ui/overlay'
import { diffDays, fmtDate, todayISO } from '@/lib/dates'
import type { AgencyProfile, HandlingCharge } from '@/domain/types'
import { useActor, useData, useRun, useWarmup } from '@/hooks/app'
import { formatINR, round2 } from '@/lib/utils'
import { agency, handlingCharges as hcApi } from '@/services/api'
import { FormCard, FormTable, RowActions } from '../console/shared'

function useMe() {
  const db = useData()
  const actor = useActor()
  const me = db.agents.find((a) => a.id === actor.userId)!
  const licence = db.licences.find((l) => l.agentId === me.id)
  return { db, me, licence, plan: db.licencePlans.find((p) => p.id === licence?.planId) }
}

async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  const img = new Image()
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
    img.src = url
  })
  const k = Math.min(1, 480 / img.width)
  const c = document.createElement('canvas')
  c.width = Math.round(img.width * k)
  c.height = Math.round(img.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(url)
  return c.toDataURL('image/png')
}

/** Profile: account information, bill printout details and subscription details of the agency. */
export function AgencyProfilePage() {
  const { db, me, licence } = useMe()
  const { run, pending } = useRun()
  const p = me.profile ?? {}
  const [v, setV] = React.useState({ agencyName: me.agencyName, email: me.email, ...{ licenseeName: p.licenseeName ?? me.name, address: p.address ?? '', location: p.location ?? '', pincode: p.pincode ?? '', phone: p.phone ?? '', areaId: p.areaId ?? '', logo: p.logo ?? '', billAddress: p.billAddress ?? '', billEmail: p.billEmail ?? '', billPhone: p.billPhone ?? '', billMobile: p.billMobile ?? '', gstNo: p.gstNo ?? '', panNo: p.panNo ?? '', branches: p.branches ?? 1 } })
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }))
  const areas = db.locations.filter((l) => l.level === 'area' && me.areaIds.includes(l.id))
  const save = async () => {
    const { agencyName, email, ...profile } = v
    await run(() => agency.saveProfile({ agencyName, email, profile: profile as AgencyProfile }), 'Profile saved')
  }
  return (
    <>
      <PageHeader kicker="Settings" title={`Profile${licence ? ` · ${licence.accountNo}` : ''}`} description="Your agency's details and what is printed on bills." />
      <Tabs defaultValue="account">
        <TabsList>
          <TabsTrigger value="account">Account Information</TabsTrigger>
          <TabsTrigger value="billing">Billing Printout Details</TabsTrigger>
          <TabsTrigger value="subscription">Subscription Details</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Agency Name" required>
                <Input value={v.agencyName} onChange={(e) => set('agencyName', e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field label="Licensee Name">
                <Input value={v.licenseeName} onChange={(e) => set('licenseeName', e.target.value)} />
              </Field>
              <Field label="Licence No">
                <Input value={licence?.accountNo ?? ''} readOnly disabled />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Textarea rows={2} value={v.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field label="Location">
                <Input value={v.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <Field label="Pincode">
                <Input value={v.pincode} inputMode="numeric" onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <Field label="Phone">
                <Input value={v.phone} inputMode="numeric" onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 12))} />
              </Field>
              <Field label="Area">
                <NativeSelect value={v.areaId} onChange={(e) => set('areaId', e.target.value)}>
                  <option value="">Select Area</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Choose file (logo)">
                <div className="flex items-center gap-3">
                  <div className="grid size-12 place-items-center overflow-hidden rounded-lg border border-border bg-muted">{v.logo ? <img src={v.logo} alt="" className="size-full object-contain" /> : <ImagePlus className="size-5 text-muted-foreground" />}</div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-input px-3 py-2 text-[13px] font-semibold hover:bg-accent">
                    Choose file
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('logo', await shrinkLogo(f)) }} />
                  </label>
                </div>
              </Field>
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="billing">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Agency Name">
                <Input value={v.agencyName} readOnly disabled />
              </Field>
              <Field label="Licence No">
                <Input value={licence?.accountNo ?? ''} readOnly disabled />
              </Field>
              <Field label="Bill Printout Address" className="sm:col-span-2">
                <Textarea rows={2} value={v.billAddress} onChange={(e) => set('billAddress', e.target.value)} />
              </Field>
              <Field label="Location">
                <Input value={v.location} onChange={(e) => set('location', e.target.value)} />
              </Field>
              <Field label="Pincode">
                <Input value={v.pincode} inputMode="numeric" onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} />
              </Field>
              <Field label="Bill Printout Email">
                <Input type="email" value={v.billEmail} onChange={(e) => set('billEmail', e.target.value)} />
              </Field>
              <Field label="Bill Printout Telephone">
                <Input value={v.billPhone} onChange={(e) => set('billPhone', e.target.value)} />
              </Field>
              <Field label="Bill Printout Mobile">
                <Input value={v.billMobile} inputMode="numeric" onChange={(e) => set('billMobile', e.target.value.replace(/\D/g, '').slice(0, 10))} />
              </Field>
              <Field label="GST No">
                <Input value={v.gstNo} onChange={(e) => set('gstNo', e.target.value.toUpperCase().slice(0, 15))} />
              </Field>
              <Field label="PAN No">
                <Input value={v.panNo} onChange={(e) => set('panNo', e.target.value.toUpperCase().slice(0, 10))} />
              </Field>
            </CardBody>
          </Card>
        </TabsContent>
        <TabsContent value="subscription">
          <SubscriptionDetails />
        </TabsContent>
      </Tabs>
      <div className="mt-4">
        <Button loading={pending} onClick={() => void save()}>
          <Building /> Save
        </Button>
      </div>
    </>
  )
}

function SubscriptionDetails() {
  const { me, licence, plan, db } = useMe()
  const { run, pending } = useRun()
  const users = 1 + db.executives.filter((e) => e.agentId === me.id).length + db.staffUsers.filter((u) => u.agentId === me.id).length
  const left = licence ? diffDays(licence.licenceEnd, todayISO()) : 0
  return (
    <Card>
      <CardHeader icon={BadgeCheck} title="Subscription Details" description={licence ? (left < 0 ? 'Your licence has expired.' : `${left} days of licence left.`) : undefined} action={licence?.renewalRequested ? <Badge tone="info">Renewal requested</Badge> : undefined} />
      <CardBody>
        <KeyValue
          cols={2}
          items={[
            ['Subscribed Version', plan?.name ?? '—'],
            ['Date of Registration', fmtDate(licence?.registeredOn)],
            ['Date of Activation', fmtDate(licence?.verifiedOn)],
            ['Date of Subscription Validation', fmtDate(licence?.licenceEnd)],
            ['No of Users', `${users} of ${licence?.userLimit ?? '—'}`],
            ['No of Branch', String(me.profile?.branches ?? 1)],
            ['Renewal amount', plan ? formatINR(plan.totalRenewal) : '—'],
          ]}
        />
        {licence && !licence.renewalRequested && (
          <Button className="mt-4" variant="outline" loading={pending} onClick={() => void run(() => agency.requestRenewal(), 'Renewal requested — the main agency will contact you')}>
            Request renewal
          </Button>
        )}
      </CardBody>
    </Card>
  )
}

/** Subscription Info: the licence details on their own page. */
export function SubscriptionInfoPage() {
  return (
    <>
      <PageHeader kicker="Settings" title="Subscription Info" description="Your NewsRound licence." />
      <SubscriptionDetails />
    </>
  )
}

/** Bill Serials: the prefix and first number of this agency's bills. */
export function BillSerialsPage() {
  const { db, me } = useMe()
  const { run, pending } = useRun()
  const [prefix, setPrefix] = React.useState(me.billPrefix ?? '')
  const [start, setStart] = React.useState(me.billStart ?? 1)
  const used = db.invoices.some((i) => i.agentId === me.id)
  const next = `${(prefix || db.settings.invoicePrefix).toUpperCase()}${String(Math.max(start, (db.counters[`bill:${me.id}`] ?? start - 1) + 1)).padStart(4, '0')}`
  return (
    <>
      <PageHeader kicker="Settings" title="Bill Serial" description="Number your bills in your own series." />
      <FormTable
        inline
        form={
          <FormCard title="Bill Serial" onSubmit={() => { if (!prefix.trim()) return void toast.error('Enter the bill prefix.'); void run(() => agency.saveSettings({ billPrefix: prefix, billStart: start }), 'Bill serial saved') }} pending={pending}>
            <Field label="Starting Bill Number" required hint={used ? 'Bills were already generated; the series continues from the last number.' : undefined}>
              <Input type="number" min={1} value={start} onChange={(e) => setStart(Number(e.target.value))} />
            </Field>
            <Field label="Bill Prefix" required>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
            </Field>
          </FormCard>
        }
      >
        <Card>
          <CardHeader icon={Receipt} title="Your bill numbers" />
          <CardBody>
            <KeyValue cols={3} items={[['Bill prefix', me.billPrefix ?? `${db.settings.invoicePrefix} (default)`], ['Starting number', String(me.billStart ?? '—')], ['Next bill number', me.billPrefix ? next : 'Default numbering until you set a prefix']]} />
          </CardBody>
        </Card>
      </FormTable>
    </>
  )
}

/** Handling Charge Setting: the default monthly handling charge for customers who have none of their own. */
export function HandlingChargePage() {
  const { db, me } = useMe()
  const ready = useWarmup()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [editing, setEditing] = React.useState<HandlingCharge | null>(null)
  const [month, setMonth] = React.useState(todayISO().slice(0, 7))
  const [amount, setAmount] = React.useState(0)
  const rows = db.handlingCharges.filter((h) => h.agentId === me.id).sort((a, b) => b.month.localeCompare(a.month)).map((h, n) => ({ h, n: n + 1, billed: db.invoices.some((i) => i.agentId === me.id && i.periodStart.slice(0, 7) === h.month) }))
  type Row = (typeof rows)[number]
  const clear = () => { setEditing(null); setAmount(0) }
  const cols: Column<Row>[] = [
    { key: 'n', header: 'Sl No', sort: (r) => r.n, cell: (r) => r.n, className: 'w-14' },
    { key: 'm', header: 'Month&Year', sort: (r) => r.h.month, cell: (r) => r.h.month, csv: (r) => r.h.month },
    { key: 'a', header: 'Amount', align: 'right', sort: (r) => r.h.amount, cell: (r) => formatINR(r.h.amount), csv: (r) => r.h.amount },
    { key: 'act', header: '', cell: (r) => <RowActions onEdit={() => { setEditing(r.h); setMonth(r.h.month); setAmount(r.h.amount) }} onDelete={() => void confirm({ title: `Delete ${r.h.month}?`, description: 'The default handling charge for this month is removed.', tone: 'destructive', confirmLabel: 'Delete' }).then((ok) => ok && run(() => hcApi.remove(r.h.id), 'Deleted'))} lockedReason={r.billed ? 'Bills were generated for this month' : undefined} /> },
  ]
  return (
    <>
      <PageHeader kicker="Settings" title="Handling Charge Settings" description="Applied to bills of customers who have no handling charge of their own." />
      <FormTable
        noun="handling charge"
        form={
          <FormCard title="Handling Charge Settings" editing={!!editing} onCancel={clear} onSubmit={async () => { const ok = await run(() => hcApi.save({ id: editing?.id, month, amount }), 'Handling charge saved'); if (ok) clear(); return !!ok }} pending={pending}>
            <Field label="Month&Year" required>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Field label="Handling Charge" required>
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(round2(Number(e.target.value)))} />
            </Field>
          </FormCard>
        }
      >
        <DataTable loading={!ready} rows={rows} columns={cols} rowKey={(r) => r.h.id} mobileTitle={(r) => <span className="font-semibold">{r.h.month}</span>} exportName="handling-charges" empty={{ icon: Percent, title: 'No handling charge set yet' }} />
      </FormTable>
    </>
  )
}

/** Rate Setting: how customers flagged Sub-agent are billed. */
export function RateSettingPage() {
  const { db, me } = useMe()
  const { run } = useRun()
  const subs = db.customers.filter((c) => c.agentId === me.id && c.subAgent)
  const on = me.subAgentBilling !== false
  return (
    <>
      <PageHeader kicker="Settings" title="Rate Setting" description="Choose which rate customers flagged Sub-agent are billed at." />
      <Card>
        <CardHeader icon={Tags} title="Sub-agent billing" description="Customers are flagged Sub-agent in Customer Details." />
        <CardBody className="grid gap-4">
          <Switch checked={on} onCheckedChange={(x) => void run(() => agency.saveSettings({ subAgentBilling: x }), x ? 'Sub-agents are billed at the Sub-agent Rate' : 'Sub-agents are billed at the Sale Rate')} label="Bill Sub-agent customers at the Sub-agent Rate (otherwise the Sale Rate)" />
          <div>
            <div className="mb-2 text-[13px] font-semibold">{subs.length} sub-agent customer{subs.length === 1 ? '' : 's'}</div>
            <ul className="flex flex-wrap gap-2">
              {subs.map((c) => (
                <li key={c.id}>
                  <Badge tone="navy">{c.name}</Badge>
                </li>
              ))}
              {!subs.length && <li className="text-sm text-muted-foreground">No customer is flagged Sub-agent yet.</li>}
            </ul>
          </div>
        </CardBody>
      </Card>
    </>
  )
}

export function HelpPage() {
  const { db, me } = useMe()
  return (
    <>
      <PageHeader kicker="Help" title="Support Desk" description="Reach the main agency when you need a hand." />
      <Card>
        <CardHeader title="NewsRound support" />
        <CardBody>
          <KeyValue cols={1} items={[['Main agency', db.settings.agencyName], ['Support phone', db.settings.supportPhone ? `+91 ${db.settings.supportPhone}` : '—'], ['Your account', me.agencyName]]} />
          {db.settings.supportPhone && (
            <Button className="mt-4" asChild>
              <a href={`tel:+91${db.settings.supportPhone}`}>Call support</a>
            </Button>
          )}
        </CardBody>
      </Card>
    </>
  )
}
