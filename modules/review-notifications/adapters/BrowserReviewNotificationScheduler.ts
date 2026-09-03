import { logger as rootLogger } from '@/shared/logging'
import { REVIEW_NOTIFICATION_ALARM_NAME } from '../domain/ReviewNotification'
import type { ReviewNotificationAlarmScheduler } from '../ports/ReviewNotificationBrowser'

const logger = rootLogger.child({ scope: "reviewNotifications.scheduler" })

export class BrowserReviewNotificationScheduler implements ReviewNotificationAlarmScheduler {
  async getIntervalMinutes(): Promise<number | null> {
    const alarm = await browser.alarms.get(REVIEW_NOTIFICATION_ALARM_NAME)
    const interval = alarm?.periodInMinutes ?? null
    logger.debug('Read review notification alarm', {
      isScheduled: alarm !== undefined,
      intervalMinutes: interval ?? undefined,
    })
    return interval
  }

  async schedule(intervalMinutes: number): Promise<void> {
    const current = await this.getIntervalMinutes()
    if (current === intervalMinutes) {
      logger.debug('Kept existing review notification alarm', {
        intervalMinutes,
      })
      return
    }
    if (current !== null)
      await browser.alarms.clear(REVIEW_NOTIFICATION_ALARM_NAME)
    await browser.alarms.create(REVIEW_NOTIFICATION_ALARM_NAME, {
      delayInMinutes: intervalMinutes,
      periodInMinutes: intervalMinutes,
    })
    logger.info('Review notification alarm scheduled', { intervalMinutes })
  }

  async clear(): Promise<void> {
    const cleared = await browser.alarms.clear(REVIEW_NOTIFICATION_ALARM_NAME)
    logger.info('Review notification alarm cleared', { cleared })
  }
}
