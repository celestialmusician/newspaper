import * as React from 'react'
import { DeliveryCalendar } from '@/components/DeliveryCalendar'
import { NativeSelect } from '@/components/ui/form'
import { DemoNote, PageHeader } from '@/components/ui/misc'
import { useScope } from '@/hooks/app'

export default function CalendarPage() {
  const { db, actor, subscriptions, routes, customers } = useScope()
  const [route, setRoute] = React.useState('')
  const [product, setProduct] = React.useState('')
  const [customer, setCustomer] = React.useState('')
  const subs = React.useMemo(() => {
    const routeCust = route ? new Set(db.routes.find((r) => r.id === route)?.stops.map((s) => s.customerId)) : null
    return subscriptions.filter((s) => (!routeCust || routeCust.has(s.customerId)) && (!product || s.productId === product) && (!customer || s.customerId === customer))
  }, [subscriptions, route, product, customer, db.routes])
  const isCustomer = actor.role === 'customer'
  return (
    <>
      <PageHeader
        kicker="Delivery calendar"
        title={isCustomer ? 'My delivery calendar' : 'Delivery calendar'}
        description="Generated live from subscription frequency, pauses, expiry and holidays — no duplicate entries, ever."
        actions={
          !isCustomer && (
            <>
              {routes.length > 1 && (
                <NativeSelect value={route} onChange={(e) => setRoute(e.target.value)} className="h-10 w-48" aria-label="Route">
                  <option value="">All routes</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
              <NativeSelect value={customer} onChange={(e) => setCustomer(e.target.value)} className="h-10 w-44" aria-label="Customer">
                <option value="">All customers</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
              <NativeSelect value={product} onChange={(e) => setProduct(e.target.value)} className="h-10 w-44" aria-label="Product">
                <option value="">All products</option>
                {db.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </>
          )
        }
      />
      {isCustomer && <DemoNote className="mb-4">Holidays and hartals appear in the calendar. As per agency policy, subscription charges stay at the fixed monthly rate on those days.</DemoNote>}
      <DeliveryCalendar subscriptions={subs} showCustomer={!isCustomer} />
    </>
  )
}
