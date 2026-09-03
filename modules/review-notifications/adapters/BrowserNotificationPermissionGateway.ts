import { logger as rootLogger } from '@/shared/logging'
import type { ReviewNotificationPermissionGateway } from '../ports/ReviewNotificationBrowser'

const logger = rootLogger.child({ scope: "reviewNotifications.permission" })
const notificationPermission: Browser.permissions.Permissions = {
  permissions: ['notifications'],
}

export class BrowserNotificationPermissionGateway implements ReviewNotificationPermissionGateway {
  async isGranted(): Promise<boolean> {
    const granted = await browser.permissions.contains(notificationPermission)
    logger.debug('Resolved review notification permission', { granted })
    return granted
  }

  async request(): Promise<boolean> {
    logger.info('Requesting optional review notification permission')
    const granted = await browser.permissions.request(notificationPermission)
    const log = granted ? logger.info : logger.warn
    log('Review notification permission request completed', { granted })
    return granted
  }
}
