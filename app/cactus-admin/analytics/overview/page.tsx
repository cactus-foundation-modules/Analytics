import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import AnalyticsScreen from '@/modules/analytics/components/admin/AnalyticsScreen'

export const metadata = { title: 'Analytics — Admin' }

export default async function AnalyticsPage() {
  const user = await getSessionFromCookie()
  if (!user) return null
  if (!await hasPermission(user, 'analytics.view')) {
    return <div className="alert alert-danger">You do not have permission to view Analytics.</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Analytics</h1>
      </div>
      <AnalyticsScreen />
    </div>
  )
}
