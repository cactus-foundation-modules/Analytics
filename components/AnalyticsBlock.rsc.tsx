import { connection } from 'next/server'
import { gateFromBanner, getAnalyticsSettings, getBannerState } from '@/modules/analytics/lib/settings'
import { Tracker } from './Tracker'
import { analyticsBlockComponent } from './AnalyticsBlock'

async function AnalyticsRsc() {
  // Read per request, not per build: switching the module off should take
  // effect on the next page load, not the next deploy.
  await connection()
  const settings = await getAnalyticsSettings()
  if (!settings.enabled) return null
  const gate = gateFromBanner(await getBannerState())
  return <Tracker gate={gate} respectDnt={settings.respectDnt} />
}

export const analyticsBlockRscComponent = { ...analyticsBlockComponent, render: AnalyticsRsc }
