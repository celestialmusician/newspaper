import { ArrowRightLeft, CheckCircle2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect, Textarea } from '@/components/ui/form'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import { deriveSubscriptionStatus } from '@/domain/schedule'
import type { Route } from '@/domain/types'
import { useActor, useData, useRun } from '@/hooks/app'
import { routes as api } from '@/services/api'

/** Route handover: the replacement executive instantly gets every stop, pin, subscription, schedule and instruction. */
export function HandoverDialog({ route, open, onOpenChange }: { route: Route; open: boolean; onOpenChange: (o: boolean) => void }) {
  const db = useData()
  const actor = useActor()
  const { run, pending } = useRun()
  const [to, setTo] = React.useState('')
  const [note, setNote] = React.useState('')
  const candidates = db.executives.filter((e) => e.status === 'active' && e.id !== route.executiveId && (actor.role === 'admin' || e.agentId === route.agentId))
  const custIds = new Set(route.stops.map((s) => s.customerId))
  const subs = db.subscriptions.filter((s) => custIds.has(s.customerId) && deriveSubscriptionStatus(s) === 'active')
  const withInstr = route.stops.filter((s) => s.instructions).length
  const current = db.executives.find((e) => e.id === route.executiveId)

  const transfers = [
    `${route.stops.length} customers with addresses & contact numbers`,
    `${route.stops.length} GPS map pins in delivery order`,
    `${subs.length} active product subscriptions & schedules`,
    `${withInstr} customer-specific instructions + route notes`,
    'Pending payment list for collections',
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" title="Hand over route" description={`${route.code} · ${route.name}`}>
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-muted/70 p-4 text-[14px]">
            <div className="flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">From</div>
              <div className="font-semibold">{current?.name ?? 'Unassigned'}</div>
            </div>
            <ArrowRightLeft className="size-5 text-masthead" />
            <div className="flex-1">
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">To</div>
              <div className="font-semibold">{db.executives.find((e) => e.id === to)?.name ?? 'Choose below'}</div>
            </div>
          </div>
          <Field label="New delivery executive" required>
            <NativeSelect value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Select executive</option>
              {candidates.map((e) => {
                const has = db.routes.filter((r) => r.executiveId === e.id).length
                return (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.code}) — {has ? `${has} route(s)` : 'available'}
                  </option>
                )
              })}
            </NativeSelect>
          </Field>
          <div>
            <div className="mb-2 text-[12px] font-bold uppercase tracking-wider text-muted-foreground">Transferred immediately</div>
            <ul className="space-y-1.5 text-[13.5px]">
              {transfers.map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" /> {t}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12.5px] text-muted-foreground">Past delivery history stays credited to {current?.name ?? 'the previous executive'}.</p>
          </div>
          <Field label="Handover note">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Arjun on leave till 15th" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!to} loading={pending} onClick={async () => (await run(() => api.handover(route.id, to, note || undefined), 'Route handed over — new executive notified')) && onOpenChange(false)}>
            Confirm handover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
