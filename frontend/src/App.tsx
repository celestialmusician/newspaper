import { ShieldOff } from 'lucide-react'
import * as React from 'react'
import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation, useRouteError } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useTheme } from '@/app/theme'
import { canVisit, flatNav } from '@/app/nav'
import { Shell } from '@/app/Shell'
import { Button } from '@/components/ui/button'
import { ConfirmProvider, TooltipProvider } from '@/components/ui/overlay'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/ui/misc'
import { activeRoll, canOpen } from '@/domain/staff'
import { useData } from '@/hooks/app'
import { auth } from '@/services/api'
import { reloadQueue, flushQueue } from '@/services/offline'
import { API_MODE } from '@/services/mode'
import { pull, useSync } from '@/services/remote'
import { useSession } from '@/services/store'

const lazy = (f: () => Promise<{ default: React.ComponentType }>) => {
  const C = React.lazy(f)
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <C />
    </React.Suspense>
  )
}

function RequireAuth() {
  const session = useSession((s) => s.session)
  const loc = useLocation()
  React.useEffect(() => {
    if (session) {
      reloadQueue()
      void flushQueue()
    }
  }, [session?.userId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!session) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (API_MODE === 'http') return <SyncGate />
  return <Outlet />
}

/** http mode: screens need the user's synced data before they can render. */
function SyncGate() {
  const { status, error } = useSync()
  if (status === 'ready') return <Outlet />
  if (status === 'error')
    return (
      <div className="mx-auto grid min-h-dvh max-w-md place-items-center p-6">
        <ErrorState title="Could not load your data" description={error ?? 'The NewsRound server is not reachable.'} onRetry={() => void pull().catch(() => undefined)} />
      </div>
    )
  return (
    <div className="mx-auto max-w-5xl p-6">
      <PageSkeleton />
    </div>
  )
}

function RoleGate() {
  const session = useSession((s) => s.session)!
  const loc = useLocation()
  const db = useData()
  const staffGone = !!session.staffId && !activeRoll(db, session)
  // A staff user who was switched off, deleted or lost their roll is signed out at once.
  React.useEffect(() => {
    if (staffGone) auth.logout()
  }, [staffGone])
  if (staffGone) return <Navigate to="/login" replace />
  if (session.staffId && loc.pathname === '/' && !canOpen(db, session, '/')) {
    // Their roll has no Dashboard: land on the first page it does open.
    const first = flatNav(session.role, (p) => canOpen(db, session, p))[0]
    if (first) return <Navigate to={first.to} replace />
    return <EmptyState icon={ShieldOff} title="No pages assigned" description="Your user roll does not open any page yet. Ask the agency owner to update it." />
  }
  if (!canVisit(session.role, loc.pathname) || !canOpen(db, session, loc.pathname))
    return (
      <EmptyState
        icon={ShieldOff}
        title="Not available for your account"
        description="This section is not part of your role's permissions."
        action={
          <Button asChild>
            <a href="/">Go to dashboard</a>
          </Button>
        }
      />
    )
  return <Outlet />
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const session = useSession((s) => s.session)
  return session ? <Navigate to="/" replace /> : <>{children}</>
}

function RouteError() {
  const err = useRouteError() as Error | undefined
  return (
    <div className="mx-auto max-w-xl p-8">
      <ErrorState description={err?.message ?? 'This page failed to load.'} onRetry={() => window.location.reload()} />
    </div>
  )
}

const router = createBrowserRouter([
  { path: '/login', element: <PublicOnly>{lazy(() => import('@/pages/auth/Login'))}</PublicOnly> },
  { path: '/register', element: <PublicOnly>{lazy(() => import('@/pages/auth/Register'))}</PublicOnly> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Shell />,
        errorElement: <RouteError />,
        children: [
      {
        element: <RoleGate />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: lazy(() => import('@/pages/dashboard/Dashboard')) },
          { path: 'manage-route', element: lazy(() => import('@/pages/agency/ManageRoute')) },
          { path: 'delivery-boys', element: lazy(() => import('@/pages/agency/DeliveryBoys')) },
          { path: 'customers-master', element: lazy(() => import('@/pages/agency/CustomerDetails')) },
          { path: 'manage-subscriptions', element: lazy(() => import('@/pages/agency/ManageSubscriptions')) },
          { path: 'bill-adjustment', element: lazy(() => import('@/pages/agency/BillAdjustment')) },
          { path: 'bill', element: lazy(() => import('@/pages/finance/Invoices')) },
          { path: 'delivery-slip', element: lazy(() => import('@/pages/agency/DeliverySlip')) },
          { path: 'payment-collection', element: lazy(() => import('@/pages/agency/PaymentCollection')) },
          { path: 'profit-forecasting', element: lazy(() => import('@/pages/agency/ProfitReports').then((m) => ({ default: m.ProfitForecasting }))) },
          { path: 'profit-loss', element: lazy(() => import('@/pages/agency/ProfitReports').then((m) => ({ default: m.ProfitLoss }))) },
          { path: 'reports/:name', element: lazy(() => import('@/pages/agency/AgencyReports')) },
          { path: 'agency-profile', element: lazy(() => import('@/pages/agency/AgencySettings').then((m) => ({ default: m.AgencyProfilePage }))) },
          { path: 'subscription-info', element: lazy(() => import('@/pages/agency/AgencySettings').then((m) => ({ default: m.SubscriptionInfoPage }))) },
          { path: 'bill-serials', element: lazy(() => import('@/pages/agency/AgencySettings').then((m) => ({ default: m.BillSerialsPage }))) },
          { path: 'handling-charge', element: lazy(() => import('@/pages/agency/AgencySettings').then((m) => ({ default: m.HandlingChargePage }))) },
          { path: 'rate-setting', element: lazy(() => import('@/pages/agency/AgencySettings').then((m) => ({ default: m.RateSettingPage }))) },
          { path: 'help', element: lazy(() => import('@/pages/agency/AgencySettings').then((m) => ({ default: m.HelpPage }))) },
          { path: 'user-roll', element: lazy(() => import('@/pages/agency/UserRolls').then((m) => ({ default: m.UserRollPage }))) },
          { path: 'users', element: lazy(() => import('@/pages/agency/UserRolls').then((m) => ({ default: m.UsersPage }))) },
          { path: 'verification', element: lazy(() => import('@/pages/console/Verification')) },
          { path: 'accounts', element: lazy(() => import('@/pages/console/Accounts')) },
          { path: 'broadcasts', element: lazy(() => import('@/pages/console/Broadcasts')) },
          { path: 'resellers', element: lazy(() => import('@/pages/console/Resellers')) },
          { path: 'control-room', element: lazy(() => import('@/pages/console/ControlRoom')) },
          { path: 'licence-plans', element: lazy(() => import('@/pages/console/LicencePlans')) },
          { path: 'manage-products', element: lazy(() => import('@/pages/console/ManageProducts')) },
          { path: 'product-rates', element: lazy(() => import('@/pages/console/ProductRates')) },
          { path: 'change-password', element: lazy(() => import('@/pages/system/ChangePassword')) },
          { path: 'masters/:kind', element: lazy(() => import('@/pages/console/Masters')) },
          { path: 'customers', element: lazy(() => import('@/pages/people/Customers')) },
          { path: 'customers/:id', element: lazy(() => import('@/pages/people/CustomerProfile')) },
          { path: 'agents', element: lazy(() => import('@/pages/people/Agents')) },
          { path: 'agents/:id', element: lazy(() => import('@/pages/people/AgentProfile')) },
          { path: 'executives', element: lazy(() => import('@/pages/people/Executives')) },
          { path: 'executives/:id', element: lazy(() => import('@/pages/people/ExecutiveProfile')) },
          { path: 'products', element: lazy(() => import('@/pages/catalogue/Products')) },
          { path: 'pricing', element: lazy(() => import('@/pages/catalogue/Pricing')) },
          { path: 'locations', element: lazy(() => import('@/pages/catalogue/Locations')) },
          { path: 'subscriptions', element: lazy(() => import('@/pages/subscriptions/Subscriptions')) },
          { path: 'calendar', element: lazy(() => import('@/pages/subscriptions/CalendarPage')) },
          { path: 'holidays', element: lazy(() => import('@/pages/subscriptions/Holidays')) },
          { path: 'routes', element: lazy(() => import('@/pages/distribution/Routes')) },
          { path: 'routes/:id', element: lazy(() => import('@/pages/distribution/RouteDetail')) },
          { path: 'deliveries', element: lazy(() => import('@/pages/distribution/DeliveryHistory')) },
          { path: 'deliveries/today', element: lazy(() => import('@/pages/distribution/Checklist')) },
          { path: 'stock', element: lazy(() => import('@/pages/distribution/Stock')) },
          { path: 'invoices', element: lazy(() => import('@/pages/finance/Invoices')) },
          { path: 'invoices/:id', element: lazy(() => import('@/pages/finance/InvoiceView')) },
          { path: 'payments', element: lazy(() => import('@/pages/finance/Payments')) },
          { path: 'collections', element: lazy(() => import('@/pages/finance/Collections')) },
          { path: 'discounts', element: lazy(() => import('@/pages/finance/Discounts')) },
          { path: 'settlements', element: lazy(() => import('@/pages/finance/Settlements')) },
          { path: 'reports', element: lazy(() => import('@/pages/insights/Reports')) },
          { path: 'complaints', element: lazy(() => import('@/pages/insights/Complaints')) },
          { path: 'notifications', element: lazy(() => import('@/pages/insights/Notifications')) },
          { path: 'logs', element: lazy(() => import('@/pages/system/ActivityLog')) },
          { path: 'settings', element: lazy(() => import('@/pages/system/Settings')) },
          { path: 'profile', element: lazy(() => import('@/pages/system/Profile')) },
          { path: '*', element: <Navigate to="/" replace /> },
        ],
      },
        ],
      },
    ],
  },
])

export default function App() {
  return (
    <TooltipProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
        <ThemedToaster />
      </ConfirmProvider>
    </TooltipProvider>
  )
}

function ThemedToaster() {
  const dark = useTheme((s) => s.dark)
  return <Toaster theme={dark ? 'dark' : 'light'} position="top-center" richColors closeButton toastOptions={{ style: { fontFamily: 'var(--font-sans)', borderRadius: 16 } }} />
}
