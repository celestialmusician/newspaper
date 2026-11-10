import { useActor } from '@/hooks/app'
import AdminDashboard from './AdminDashboard'
import AgentDashboard from './AgentDashboard'
import CustomerDashboard from './CustomerDashboard'
import ExecutiveDashboard from './ExecutiveDashboard'

export default function Dashboard() {
  const { role } = useActor()
  if (role === 'admin') return <AdminDashboard />
  if (role === 'agent') return <AgentDashboard />
  if (role === 'executive') return <ExecutiveDashboard />
  return <CustomerDashboard />
}
