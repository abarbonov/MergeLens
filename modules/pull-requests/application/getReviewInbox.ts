import { logger as rootLogger } from '@/shared/logging'
import {
  parseReviewInboxRequest,
  parseReviewInboxResponse,
} from '@/shared/messaging/protocol'
import type {
  ReviewInboxRequest,
  ReviewInboxResponse,
} from '@/shared/messaging/schemas'
import type {
  ReviewInboxData,
  ReviewInboxPullRequest,
  ReviewInboxReason,
  ReviewInboxSectionResult,
} from '../domain/ReviewInbox'
import type { ReviewInboxReader } from '../ports/ReviewInboxReader'

const logger = rootLogger.child({ scope: "pullRequests.getReviewInbox" })
const SECTION_LIMIT = 10
const REASON_ORDER: ReviewInboxReason[] = [
  'review-requested',
  'assigned',
  'recent-activity',
]

const getSafeCorrelationId = (input: unknown): string => {
  if (typeof input === 'string' && input.length >= 1 && input.length <= 128) {
    return input
  }

  return 'invalid-request'
}

const getItemKey = (item: ReviewInboxPullRequest): string => {
  return `${item.repository.fullName.toLowerCase()}#${item.number}`
}

const mergeReasons = (
  first: ReviewInboxReason[],
  second: ReviewInboxReason[],
): ReviewInboxReason[] => {
  const reasons = new Set([...first, ...second])
  return REASON_ORDER.filter((reason) => reasons.has(reason))
}

const mergePrioritySections = (
  reviewRequests: ReviewInboxSectionResult,
  assigned: ReviewInboxSectionResult,
): {
  reviewRequests: ReviewInboxSectionResult
  assigned: ReviewInboxSectionResult
  priorityKeys: Set<string>
} => {
  const priorityItems = new Map<string, ReviewInboxPullRequest>()

  for (const section of [reviewRequests, assigned]) {
    if (section.status !== 'success') {
      continue
    }

    for (const item of section.items) {
      const key = getItemKey(item)
      const existing = priorityItems.get(key)
      priorityItems.set(
        key,
        existing
          ? {
              ...existing,
              reasons: mergeReasons(existing.reasons, item.reasons),
            }
          : item,
      )
    }
  }

  const mapSection = (
    section: ReviewInboxSectionResult,
  ): ReviewInboxSectionResult => {
    if (section.status !== 'success') {
      return section
    }

    return {
      status: 'success',
      items: section.items.map(
        (item) => priorityItems.get(getItemKey(item)) ?? item,
      ),
    }
  }

  return {
    reviewRequests: mapSection(reviewRequests),
    assigned: mapSection(assigned),
    priorityKeys: new Set(priorityItems.keys()),
  }
}

const normalizeInboxData = (data: ReviewInboxData): ReviewInboxData => {
  const priority = mergePrioritySections(data.reviewRequests, data.assigned)
  const recentActivity =
    data.recentActivity.status === 'success'
      ? {
          status: 'success' as const,
          items: data.recentActivity.items.filter(
            (item) => !priority.priorityKeys.has(getItemKey(item)),
          ),
        }
      : data.recentActivity

  logger.debug('Normalized review inbox sections', {
    priorityItemCount: priority.priorityKeys.size,
    recentItemCount:
      recentActivity.status === 'success' ? recentActivity.items.length : 0,
  })

  return {
    reviewRequests: priority.reviewRequests,
    assigned: priority.assigned,
    recentActivity,
  }
}

export const createGetReviewInbox = (reader: ReviewInboxReader) => {
  return async (
    requestInput: ReviewInboxRequest,
  ): Promise<ReviewInboxResponse> => {
    let request: ReviewInboxRequest

    try {
      request = parseReviewInboxRequest(requestInput)
    } catch (error) {
      logger.warn('Rejected review inbox request at background boundary', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      return parseReviewInboxResponse({
        status: 'error',
        correlationId: getSafeCorrelationId(requestInput?.correlationId),
        error: {
          code: 'invalid-request',
          message: 'Invalid review inbox request',
        },
      })
    }

    logger.info('Handling review inbox request')
    logger.debug('Review inbox request accepted', {
      correlationId: request.correlationId,
      sectionLimit: SECTION_LIMIT,
    })

    try {
      const [reviewRequests, assigned, recentActivity] = await Promise.all([
        reader.readSection({ kind: 'review-requests', limit: SECTION_LIMIT }),
        reader.readSection({ kind: 'assigned', limit: SECTION_LIMIT }),
        reader.readSection({ kind: 'recent-activity', limit: SECTION_LIMIT }),
      ])
      const data = normalizeInboxData({
        reviewRequests,
        assigned,
        recentActivity,
      })
      const response = parseReviewInboxResponse({
        status: 'success',
        correlationId: request.correlationId,
        data,
      })

      logger.info('Review inbox request completed', {
        sectionStatuses: {
          reviewRequests: data.reviewRequests.status,
          assigned: data.assigned.status,
          recentActivity: data.recentActivity.status,
        },
      })
      if (Object.values(data).some((section) => section.status === 'error')) {
        logger.warn('Review inbox request completed with partial data')
      }

      return response
    } catch (error) {
      logger.error('Unexpected review inbox handler failure', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      return parseReviewInboxResponse({
        status: 'error',
        correlationId: request.correlationId,
        error: {
          code: 'unknown-error',
          message: 'Unable to load review inbox',
        },
      })
    }
  }
}
