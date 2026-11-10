import { Check, Eraser, Lock, Pencil } from 'lucide-react'
import * as React from 'react'
import { RollNumber } from '@/components/fx/RollNumber'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'
import { useConfirm } from '@/components/ui/overlay'
import { DrawerBody, FormDrawer } from '@/components/ui/workspace'
import { TRUNC_LABEL, TRUNC_MAIN, TRUNC_SUBS, truncCounts, truncExpand, truncLock, truncSelectAll, type TruncKey } from '@/domain/truncate'
import type { ID } from '@/domain/types'
import { useData, useRun } from '@/hooks/app'
import { fmtDate } from '@/lib/dates'
import { cn, formatMobile, isIndianMobile } from '@/lib/utils'
import { licences as api } from '@/services/api'

/**
 * Truncate: the super administrator picks which of an agency's tables to clear. Main tables on
 * the left, their sub-tables on the right; a main table takes its sub-tables with it. Tables that
 * cannot go (billing history, data still in use) are locked with the reason. On confirm the
 * picked rows are shredded away before the data is cleared.
 */
export function TruncatePanel({ agentId, onClose }: { agentId: ID | null; onClose: () => void }) {
  const db = useData()
  const confirm = useConfirm()
  const { run, pending } = useRun()
  const [picked, setPicked] = React.useState<Set<TruncKey>>(new Set())
  const [shred, setShred] = React.useState(false)
  // A new account starts with nothing picked.
  const [forId, setForId] = React.useState(agentId)
  if (forId !== agentId) {
    setForId(agentId)
    setPicked(new Set())
    setShred(false)
  }

  const agent = db.agents.find((a) => a.id === agentId)
  const lic = db.licences.find((l) => l.agentId === agentId)
  if (!agentId || !agent || !lic) return null

  const counts = truncCounts(db, agentId)
  const on = truncExpand(picked)
  const lockOf = (k: TruncKey) => truncLock(db, agentId, k, picked, counts)
  const forced = (k: TruncKey) => !picked.has(k) && on.has(k)
  const total = [...on].reduce((n, k) => n + counts[k], 0)
  const allPick = truncSelectAll(db, agentId)
  const allOn = allPick.size > 0 && [...allPick].every((k) => picked.has(k))

  /** Picks that became locked (their reason came back) drop out until nothing changes. */
  const settle = (next: Set<TruncKey>) => {
    for (let changed = true; changed; ) {
      changed = false
      for (const k of next) if (truncLock(db, agentId, k, new Set([...next].filter((x) => x !== k)), counts)) {
        next.delete(k)
        changed = true
      }
    }
    return next
  }
  const toggle = (k: TruncKey) => setPicked((p) => {
    const next = new Set(p)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    return settle(next)
  })

  const erase = async () => {
    const list = TRUNC_MAIN.concat(...Object.values(TRUNC_SUBS)).filter((k) => on.has(k) && counts[k])
    const ok = await confirm({
      title: `Erase data of ${agent.agencyName}?`,
      description: (
        <div className="grid gap-2">
          <p>These tables are cleared for good. The account, its licence and its bills stay.</p>
          <ul className="grid gap-1 rounded-xl bg-destructive/[0.06] p-3 text-[13px] text-foreground">
            {list.length ? list.map((k) => (
              <li key={k} className="flex justify-between gap-4">
                <span>{TRUNC_LABEL[k]}</span>
                <span className="tabular font-semibold">{counts[k]}</span>
              </li>
            )) : <li>The picked tables are already empty.</li>}
          </ul>
        </div>
      ),
      tone: 'destructive',
      confirmLabel: 'Erase data',
    })
    if (!ok) return
    // Shred the picked rows first, then clear (instant under reduced motion).
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShred(true)
      await new Promise((r) => setTimeout(r, 650))
    }
    const done = await run(() => api.truncate(agentId, [...picked]), `${agent.agencyName}: data cleared`)
    setShred(false)
    if (done) {
      setPicked(new Set())
      onClose()
    }
  }

  let i = 0
  const row = (k: TruncKey, sub = false) => {
    const lock = lockOf(k)
    const isOn = on.has(k)
    const isForced = forced(k)
    const disabled = !!lock || isForced
    const note = lock ?? (isForced ? `Cleared with ${TRUNC_LABEL[Object.keys(TRUNC_SUBS).find((p) => TRUNC_SUBS[p as TruncKey]!.includes(k)) as TruncKey]}` : undefined)
    return (
      <li key={k} style={{ '--i': i++ } as React.CSSProperties}>
        <label className={cn('tr-row', sub && 'is-sub', isOn && 'is-on', isForced && 'is-forced', lock && 'is-locked', shred && isOn && 'is-shred')}>
          <input type="checkbox" className="sr-only" checked={isOn} disabled={disabled} onChange={() => toggle(k)} />
          <span className="tr-box" aria-hidden>
            {lock ? (
              <Lock className="size-3" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="tr-name">{TRUNC_LABEL[k]}</span>
            {note && <span className="tr-note">{note}</span>}
          </span>
          <span className="tr-count tabular">{counts[k]}</span>
        </label>
      </li>
    )
  }

  return (
    <FormDrawer open onClose={shred ? () => undefined : onClose} kicker="Truncate" title={agent.agencyName} description="Pick the tables to clear. The account, its licence and its bills always stay.">
      <DrawerBody className="grid content-start gap-5">
        <AccountDetails key={agentId} agentId={agentId} />

        <div className="grid items-start gap-4 sm:grid-cols-2">
          <section className="tr-panel">
            <h4 className="tr-head">Select Tables</h4>
            <ul className="tr-list">
              <li style={{ '--i': i++ } as React.CSSProperties}>
                <label className={cn('tr-row is-all', allOn && 'is-on', !allPick.size && 'is-locked')}>
                  <input type="checkbox" className="sr-only" checked={allOn} disabled={!allPick.size} onChange={() => setPicked(allOn ? new Set() : truncSelectAll(db, agentId))} />
                  <span className="tr-box" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span className="tr-name flex-1">Select All</span>
                </label>
              </li>
              {TRUNC_MAIN.map((k) => row(k))}
            </ul>
          </section>
          <section className="tr-panel">
            <h4 className="tr-head">Sub-Tables</h4>
            <ul className="tr-list">
              {(Object.keys(TRUNC_SUBS) as TruncKey[]).map((p) => (
                <li key={p} className={cn('tr-group', on.has(p) && 'is-live')}>
                  <span className="tr-group-name">{TRUNC_LABEL[p]}</span>
                  <ul className="grid gap-1">{TRUNC_SUBS[p]!.map((k) => row(k, true))}</ul>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </DrawerBody>
      <div className="form-actions in-drawer">
        <div className="mr-auto min-w-0 text-[13px]">
          <span className="block font-semibold text-foreground">
            {on.size ? `${on.size} table${on.size > 1 ? 's' : ''} picked` : 'No table picked'}
          </span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="tabular font-semibold text-destructive">
              <RollNumber value={String(total)} />
            </span>
            rows will be erased
          </span>
        </div>
        <Button type="button" variant="outline" onClick={onClose} disabled={shred}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" disabled={!picked.size || shred} loading={pending || shred} onClick={() => void erase()}>
          <Eraser /> Truncate
        </Button>
      </div>
    </FormDrawer>
  )
}

/** Account Details: read at a glance, with an Edit button that turns the details into fields. */
export function AccountDetails({ agentId }: { agentId: ID }) {
  const db = useData()
  const { run, pending } = useRun()
  const agent = db.agents.find((a) => a.id === agentId)!
  const lic = db.licences.find((l) => l.agentId === agentId)!
  const blank = () => ({
    agencyName: agent.agencyName,
    email: agent.email ?? '',
    mobile: agent.mobile,
    registeredOn: lic.registeredOn,
    verifiedOn: lic.verifiedOn,
    licenceEnd: lic.licenceEnd,
    userLimit: lic.userLimit,
  })
  const [edit, setEdit] = React.useState<ReturnType<typeof blank> | null>(null)
  const [errors, setErrors] = React.useState<Partial<Record<keyof ReturnType<typeof blank>, string>>>({})
  const users = 1 + db.executives.filter((e) => e.agentId === agentId).length

  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => {
    setEdit((e) => (e ? { ...e, [k]: v } : e))
    setErrors((x) => ({ ...x, [k]: undefined }))
  }
  const save = async () => {
    if (!edit) return
    const e: typeof errors = {}
    if (!edit.agencyName.trim()) e.agencyName = 'Enter the company name.'
    if (edit.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(edit.email.trim())) e.email = 'Enter a valid email address.'
    if (!isIndianMobile(edit.mobile)) e.mobile = 'Enter a valid 10-digit mobile number.'
    if (edit.verifiedOn < edit.registeredOn) e.verifiedOn = 'Cannot be before the registration date.'
    if (edit.licenceEnd < edit.verifiedOn) e.licenceEnd = 'Cannot be before the verified date.'
    if (!(edit.userLimit >= users)) e.userLimit = `At least ${users} — users already on this account.`
    setErrors(e)
    if (Object.values(e).some(Boolean)) return
    if (await run(() => api.updateAccount(agentId, edit), 'Account details saved')) setEdit(null)
  }

  const facts: [string, React.ReactNode][] = [
    ['Company Name', agent.agencyName],
    ['Company ID', agent.code],
    ['Account Number', lic.accountNo],
    ['Reg. Email ID', agent.email || '—'],
    ['Reg. Mobile No', formatMobile(agent.mobile)],
    ['Registration Date', fmtDate(lic.registeredOn)],
    ['Verified Date', fmtDate(lic.verifiedOn)],
    ['Extending Date', fmtDate(lic.licenceEnd)],
    ['Addon User', String(lic.userLimit)],
  ]

  return (
    <section className={cn('tr-account', edit && 'is-editing')}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="kicker text-muted-foreground">Account Details</h4>
        {!edit && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEdit(blank())}>
            <Pencil /> Edit
          </Button>
        )}
      </div>
      {edit ? (
        <form
          key="edit"
          noValidate
          className="tr-swap @container grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-3 @xl:grid-cols-2 @2xl:grid-cols-3">
            <Field label="Company Name" required error={errors.agencyName} className="@xl:col-span-2 @2xl:col-span-1">
              <Input value={edit.agencyName} onChange={(e) => set('agencyName', e.target.value)} aria-invalid={!!errors.agencyName} />
            </Field>
            <Field label="Company ID">
              <Input value={agent.code} disabled readOnly />
            </Field>
            <Field label="Account Number">
              <Input value={lic.accountNo} disabled readOnly />
            </Field>
            <Field label="Reg. Email ID" error={errors.email}>
              <Input type="email" value={edit.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
            </Field>
            <Field label="Reg. Mobile No" required error={errors.mobile} hint={edit.mobile !== agent.mobile ? 'The agency signs in with the new number' : undefined}>
              <Input value={edit.mobile} inputMode="numeric" onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} aria-invalid={!!errors.mobile} />
            </Field>
            <Field label="Addon User" required error={errors.userLimit}>
              <Input type="number" min={users} value={edit.userLimit} onChange={(e) => set('userLimit', Number(e.target.value))} aria-invalid={!!errors.userLimit} />
            </Field>
            <Field label="Registration Date" required>
              <Input type="date" value={edit.registeredOn} onChange={(e) => set('registeredOn', e.target.value)} />
            </Field>
            <Field label="Verified Date" required error={errors.verifiedOn}>
              <Input type="date" min={edit.registeredOn} value={edit.verifiedOn} onChange={(e) => set('verifiedOn', e.target.value)} aria-invalid={!!errors.verifiedOn} />
            </Field>
            <Field label="Extending Date" required error={errors.licenceEnd}>
              <Input type="date" min={edit.verifiedOn} value={edit.licenceEnd} onChange={(e) => set('licenceEnd', e.target.value)} aria-invalid={!!errors.licenceEnd} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEdit(null)
                setErrors({})
              }}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={pending}>
              <Check /> Save details
            </Button>
          </div>
        </form>
      ) : (
        <dl key="view" className="tr-swap grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="truncate text-[14px] font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
