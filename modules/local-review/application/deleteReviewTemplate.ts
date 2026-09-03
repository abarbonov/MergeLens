import { logger as rootLogger } from '@/shared/logging'
import {
  parseDeleteReviewTemplateRequest,
  parseDeleteReviewTemplateResponse,
} from '@/shared/messaging/protocol'
import {
  LocalReviewValidationError,
  sortReviewTemplates,
} from '../domain/LocalReview'
import type { LocalReviewRepository } from '../ports/LocalReviewRepository'
import type {
  DeleteReviewTemplateRequest,
  DeleteReviewTemplateResult,
} from './contracts'
import {
  getRequestCorrelationId,
  getErrorName,
  toLocalReviewError,
} from './operation'

const logger = rootLogger.child({ scope: "localReview.deleteTemplate" })

export const createDeleteReviewTemplate = (
  repository: LocalReviewRepository,
) => {
  return async (
    requestInput: DeleteReviewTemplateRequest,
  ): Promise<DeleteReviewTemplateResult> => {
    let request: DeleteReviewTemplateRequest

    try {
      request = parseDeleteReviewTemplateRequest(requestInput)
    } catch (error) {
      logger.warn('Rejected review template deletion at background boundary', {
        errorName: getErrorName(error),
      })
      return parseDeleteReviewTemplateResponse({
        status: 'error',
        correlationId: getRequestCorrelationId(requestInput),
        error: {
          code: 'invalid-input',
          message: 'Invalid review template deletion request',
        },
      })
    }

    const correlationId = request.correlationId
    logger.info('Handling review template deletion', { correlationId })

    try {
      const templateId = request.templateId.trim()
      if (templateId.length === 0) {
        throw new LocalReviewValidationError(
          'Template ID cannot be empty',
          'templateId',
        )
      }

      logger.debug('Deleting review template through repository', {
        correlationId,
        templateId,
      })
      await repository.deleteTemplate(templateId)
      const templates = sortReviewTemplates(await repository.listTemplates())
      logger.info('Review template deletion completed', {
        correlationId,
        templateId,
        templateCount: templates.length,
      })
      return parseDeleteReviewTemplateResponse({
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
      log('Review template deletion failed', {
        correlationId,
        code: localReviewError.code,
        errorName: getErrorName(error),
      })
      return parseDeleteReviewTemplateResponse({
        status: 'error',
        correlationId,
        error: localReviewError,
      })
    }
  }
}
