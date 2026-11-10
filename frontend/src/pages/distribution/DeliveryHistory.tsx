import { DeliveryHistoryTable } from '@/components/records'
import { PageHeader } from '@/components/ui/misc'
import { useScope } from '@/hooks/app'

export default function DeliveryHistory() {
  const { actor, subscriptions } = useScope()
  const desc = {
    admin: 'Complete system delivery history — every scheduled copy with outcome, executive and remarks.',
    agent: "Delivery history for your agency's customers.",
    executive: 'Deliveries on your routes. History from before a handover stays with the previous executive.',
    customer: 'Every delivery to your house, including holidays and paused days.',
  }[actor.role]
  return (
    <>
      <PageHeader kicker="Deliveries" title="Delivery history" description={desc} />
      <DeliveryHistoryTable subscriptions={subscriptions} showCustomer={actor.role !== 'customer'} exportName="delivery-history" />
    </>
  )
}
