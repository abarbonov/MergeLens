import { logger as rootLogger } from '@/shared/logging'
import {
  parseListReviewTemplatesRequest,
  parseListReviewTemplatesResponse,
} from '@/shared/messaging/protocol'
import { sortReviewTemplates } from '../domain/LocalReview'
import type { LocalReviewRepository } from '../ports/LocalReviewRepository'
import type {
  ListReviewTemplatesRequest,
  ListReviewTemplatesResult,
} from './contracts'
import {
  getRequestCorrelationId,
  getErrorName,
  toLocalReviewError,
} from './operation'

const logger = rootLogger.child({ scope: "localReview.listTemplates" })

export const createListReviewTemplates = (
  repository: LocalReviewRepository,
) => {
  return async (
    requestInput: ListReviewTemplatesRequest,
  ): Promise<ListReviewTemplatesResult> => {
    let request: ListReviewTemplatesRequest

    try {
      request = parseListReviewTemplatesRequest(requestInput)
    } catch (error) {
      logger.warn(
        'Rejected review template list request at background boundary',
        {
          errorName: getErrorName(error),
        },
      )
      return parseListReviewTemplatesResponse({
        status: 'error',
        correlationId: getRequestCorrelationId(requestInput),
        error: {
          code: 'invalid-input',
          message: 'Invalid review template list request',
        },
      })
    }

    const correlationId = request.correlationId
    logger.info('Handling review template list request', { correlationId })

    try {
      const templates = sortReviewTemplates(await repository.listTemplates())
      logger.info('Review template list request completed', {
        correlationId,
        templateCount: templates.length,
      })
      return parseListReviewTemplatesResponse({
        status: 'success',
        correlationId,
        data: { templates },
      })
    } catch (error) {
      const localReviewError = toLocalReviewError(error)
      const log =
        localReviewError.code === 'storage-unavailable'
          ? logger.error
          : logger.warn
      log('Review template list request failed', {
        correlationId,
        code: localReviewError.code,
        errorName: getErrorName(error),
      })
      return parseListReviewTemplatesResponse({
        status: 'error',
        correlationId,
        error: localReviewError,
      })
    }
  }
}
