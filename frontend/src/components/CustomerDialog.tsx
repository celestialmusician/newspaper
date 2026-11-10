import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CustomerFormFields, customerToValues, useCustomerForm, valuesToInput } from '@/components/CustomerForm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/overlay'
import type { Customer } from '@/domain/types'
import { useActor, useRun } from '@/hooks/app'
import { customers } from '@/services/api'

export function CustomerDialog({ open, onOpenChange, customer }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer }) {
  const actor = useActor()
  const staff = actor.role === 'admin' || actor.role === 'agent'
  const form = useCustomerForm(customerToValues(customer), { staff, requireAgent: actor.role === 'admin' })
  const { run, pending } = useRun()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (open) form.reset({ ...customerToValues(customer), agentId: customer?.agentId ?? (actor.role === 'agent' ? actor.userId : '') })
  }, [open, customer?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!form.check()) return toast.error('Please fix the highlighted fields.')
    const input = valuesToInput(form.values)
    if (customer) {
      const { agentId, routeId, ...rest } = input
      const patch = staff ? { ...rest, ...(actor.role === 'admin' && agentId ? { agentId } : {}), routeId } : rest
      const r = await run(() => customers.update(customer.id, patch), 'Customer details saved')
      if (r) onOpenChange(false)
    } else {
      const r = await run(() => customers.create(input), (c) => `${c.name} registered as ${c.code}`)
      if (r) {
        onOpenChange(false)
        navigate(`/customers/${r.id}?tab=subscriptions`)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" title={customer ? `Edit ${customer.name}` : 'Register new customer'} description={customer ? customer.code : 'Personal details, address with map pin, and delivery assignment.'}>
        <CustomerFormFields form={form} staff={staff} showAgent={actor.role === 'admin'} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending}>
            {customer ? 'Save changes' : 'Register customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
