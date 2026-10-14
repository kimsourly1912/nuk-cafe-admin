import type { Db } from '#server/utils/batch'
import { isJobCurrent, oldestDueOutbox } from '#server/features/platform'

/** Optional operational requirements; callers choose thresholds when enabling production checks. */
export async function operationalHealth(db: Db, settings: { notificationMaxAgeSeconds: number, deliveryMaxAgeSeconds: number }, now = new Date()): Promise<boolean> {
  if (Object.values(settings).some(age => !Number.isFinite(age) || age < 0)) return false
  if (settings.notificationMaxAgeSeconds > 0 && !await isJobCurrent(db, 'notifications:generate', settings.notificationMaxAgeSeconds, now)) return false
  if (settings.deliveryMaxAgeSeconds > 0) {
    const { oldestDueNotification } = await import('#server/features/notifications')
    const due = await Promise.all([oldestDueOutbox(db, now), oldestDueNotification(db, now)])
    if (due.some(at => at && now.getTime() - at.getTime() > settings.deliveryMaxAgeSeconds * 1000)) return false
  }
  return true
}
