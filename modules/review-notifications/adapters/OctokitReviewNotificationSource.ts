import {
  OctokitReviewInboxReader,
  type ReviewInboxReader,
} from '@/modules/pull-requests'
import { logger as rootLogger } from '@/shared/logging'
import type { ReviewNotificationSourceResult } from '../domain/ReviewNotification'
import type { ReviewNotificationSource } from '../ports/ReviewNotificationSource'

const logger = rootLogger.child({ scope: "reviewNotifications.githubSource" })
const POLL_LIMIT = 20

export class OctokitReviewNotificationSource implements ReviewNotificationSource {
  constructor(
    private readonly reader: ReviewInboxReader = new OctokitReviewInboxReader(),
  ) {}

  async listReviewRequests(): Promise<ReviewNotificationSourceResult> {
    logger.debug('Requesting bounded review notification candidates', {
      section: 'review-requests',
      limit: POLL_LIMIT,
    })
    const result = await this.reader.readSection({
      kind: 'review-requests',
      limit: POLL_LIMIT,
    })
    if (result.status === 'error') {
      logger.warn('Review notification source returned an expected error', {
        code: result.error.code,
      })
      return {
        status: 'error',
        error: {
          code:
            result.error.code === 'invalid-request' ||
            result.error.code === 'receiver-unavailable'
              ? 'unknown-error'
              : result.error.code,
          ...(result.error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: result.error.retryAfterSeconds }),
        },
      }
    }
    logger.info('Review notification candidates loaded', {
      candidateCount: result.items.length,
    })
    return {
      status: 'success',
      candidates: result.items.map((item) => ({
        id: item.id,
        title: item.title,
        url: item.url,
        repositoryFullName: item.repository.fullName,
        pullNumber: item.number,
        updatedAt: item.updatedAt,
      })),
    }
  }
}
