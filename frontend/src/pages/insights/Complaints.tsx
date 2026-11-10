import { MessageSquarePlus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { ComplaintList } from '@/components/records'
import { Button } from '@/components/ui/button'
import { Field, NativeSelect, Segmented, Textarea } from '@/components/ui/form'
import { PageHeader } from '@/components/ui/misc'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import type { Complaint } from '@/domain/types'
import { useRun, useScope } from '@/hooks/app'
import { complaints as api } from '@/services/api'

const CATS: Complaint['category'][] = ['Missed delivery', 'Late delivery', 'Damaged copy', 'Billing', 'Delivery executive', 'Other']

export default function Complaints() {
  const { actor, complaints } = useScope()
  const [filter, setFilter] = React.useState<'open' | 'all'>('open')
  const [open, setOpen] = React.useState(false)
  const rows = complaints.filter((c) => filter === 'all' || c.status !== 'resolved').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <>
      <PageHeader
        kicker="Support"
        title={actor.role === 'customer' ? 'Help & complaints' : 'Complaints'}
        description={actor.role === 'customer' ? 'Tell us about a missed paper, a damaged copy or a billing question. You will be notified of every update.' : 'Respond to subscriber issues. The customer is notified of every update.'}
        actions={
          actor.role === 'customer' && (
            <Button onClick={() => setOpen(true)}>
              <MessageSquarePlus /> Raise a complaint
            </Button>
          )
        }
      />
      <Segmented className="mb-4" value={filter} onChange={setFilter} options={[{ value: 'open', label: `Open ${complaints.filter((c) => c.status !== 'resolved').length}` }, { value: 'all', label: `All ${complaints.length}` }]} />
      <ComplaintList complaints={rows} />
      {open && <NewComplaint customerId={actor.userId} onClose={() => setOpen(false)} />}
    </>
  )
}

function NewComplaint({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { run, pending } = useRun()
  const [category, setCategory] = React.useState<Complaint['category']>('Missed delivery')
  const [message, setMessage] = React.useState('')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="sm" title="Raise a complaint">
        <div className="space-y-4">
          <Field label="What happened?">
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as Complaint['category'])}>
              {CATS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Details" required>
            <Textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Malayala Manorama not delivered today" autoFocus />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={pending}
            onClick={async () => {
              if (!message.trim()) return toast.error('Please describe the issue.')
              if (await run(() => api.create({ customerId, category, message }), (c) => `${c.number} submitted — your agent has been notified`)) onClose()
            }}
          >
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
