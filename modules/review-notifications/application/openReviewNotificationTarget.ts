import { logger as rootLogger } from '@/shared/logging'
import { REVIEW_NOTIFICATION_ID_PREFIX } from '../domain/ReviewNotification'
import type { OpenReviewNotificationTargetDependencies } from './contracts'

const logger = rootLogger.child({ scope: "reviewNotifications.openTarget" })

export const createOpenReviewNotificationTarget =
  (dependencies: OpenReviewNotificationTargetDependencies) =>
  async (notificationId: string): Promise<'opened' | 'ignored' | 'missing'> => {
    if (!notificationId.startsWith(REVIEW_NOTIFICATION_ID_PREFIX)) {
      logger.debug('Ignored foreign notification click')
      return 'ignored'
    }
    const routes = await dependencies.repository.listRoutes()
    const route = routes.find((item) => item.notificationId === notificationId)
    if (!route) {
      logger.warn('Review notification click route is unavailable')
      return 'missing'
    }
    await dependencies.tabOpener.open(route.url)
    await dependencies.presenter.clear(notificationId)
    await dependencies.repository.saveRoutes(
      routes.filter((item) => item.notificationId !== notificationId),
    )
    logger.info('Review notification target opened')
    return 'opened'
  }
