import { logger as rootLogger } from '@/shared/logging'
import type { ReviewNotificationDelivery } from '../domain/ReviewNotification'
import type {
  ReviewNotificationPresenter,
  ReviewNotificationTabOpener,
} from '../ports/ReviewNotificationBrowser'

const logger = rootLogger.child({ scope: "reviewNotifications.presenter" })

const parseGitHubPullRequestUrl = (value: string): string => {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    !/\/pull\/\d+(?:\/|$)/.test(url.pathname)
  ) {
    throw new Error('Notification target must be a GitHub pull request URL')
  }
  return url.toString()
}

export class BrowserReviewNotificationPresenter implements ReviewNotificationPresenter {
  async present(delivery: ReviewNotificationDelivery): Promise<void> {
    logger.debug('Creating review notification', { kind: delivery.kind })
    await browser.notifications.create(delivery.notificationId, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: delivery.title,
      message: delivery.message,
    })
    logger.info('Review notification created', { kind: delivery.kind })
  }

  async clear(notificationId: string): Promise<void> {
    const cleared = await browser.notifications.clear(notificationId)
    logger.debug('Review notification cleared', { cleared })
  }
}

export class BrowserReviewNotificationTabOpener implements ReviewNotificationTabOpener {
  async open(url: string): Promise<void> {
    const validatedUrl = parseGitHubPullRequestUrl(url)
    await browser.tabs.create({ url: validatedUrl })
    logger.info('Opened review notification target')
  }
}

export { parseGitHubPullRequestUrl }
