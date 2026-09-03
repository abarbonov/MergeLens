import {
  QueryClient,
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import { logger as rootLogger } from '@/shared/logging'
import {
  createCorrelationId,
  isReceiverUnavailableError,
  parseReviewInboxResponse,
  sendMessage,
} from '@/shared/messaging/protocol'
import { ReviewInboxQueryError, type ReviewInboxQueryData } from './types'

const logger = rootLogger.child({ scope: "reviewInbox.query" })

export const REVIEW_INBOX_QUERY_KEY = ['review-inbox'] as const
export const REVIEW_INBOX_STALE_TIME = 30_000

export const createPopupQueryClient = (): QueryClient => {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: REVIEW_INBOX_STALE_TIME,
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  })
}

export const fetchReviewInbox = async (): Promise<ReviewInboxQueryData> => {
  const correlationId = createCorrelationId()
  logger.debug('Starting review inbox query', { correlationId })

  try {
    const response = parseReviewInboxResponse(
      await sendMessage('getReviewInbox', { correlationId }),
    )

    if (response.status === 'error') {
      logger.warn('Review inbox query returned an expected error', {
        correlationId,
        code: response.error.code,
      })
      throw new ReviewInboxQueryError(
        response.error.code,
        response.error.message,
        response.error.retryAfterSeconds,
      )
    }

    logger.info('Review inbox query completed', {
      correlationId,
      sectionStatuses: {
        reviewRequests: response.data.reviewRequests.status,
        assigned: response.data.assigned.status,
        recentActivity: response.data.recentActivity.status,
      },
    })
    return response.data
  } catch (error) {
    if (error instanceof ReviewInboxQueryError) {
      throw error
    }

    if (isReceiverUnavailableError(error)) {
      logger.warn('Review inbox background receiver is unavailable', {
        correlationId,
      })
      throw new ReviewInboxQueryError(
        'receiver-unavailable',
        'MergeLens background service is unavailable',
      )
    }

    logger.error('Review inbox query failed unexpectedly', {
      correlationId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    throw new ReviewInboxQueryError(
      'invalid-response',
      'Unable to read review inbox response',
    )
  }
}

export const useReviewInboxQuery = (): UseQueryResult<
  ReviewInboxQueryData,
  ReviewInboxQueryError
> => {
  const query = useQuery<ReviewInboxQueryData, ReviewInboxQueryError>({
    queryKey: REVIEW_INBOX_QUERY_KEY,
    queryFn: fetchReviewInbox,
  })

  useEffect(() => {
    logger.debug('Review inbox query state changed', {
      status: query.status,
      fetchStatus: query.fetchStatus,
      isRefetching: query.isRefetching,
    })
  }, [query.fetchStatus, query.isRefetching, query.status])

  return query
}
