import { logger as rootLogger } from '@/shared/logging'
import {
  parseUpsertReviewTemplateRequest,
  parseUpsertReviewTemplateResponse,
} from '@/shared/messaging/protocol'
import {
  normalizeReviewTemplateDraft,
  sortReviewTemplates,
  type ReviewTemplate,
} from '../domain/LocalReview'
import type { LocalReviewRepository } from '../ports/LocalReviewRepository'
import type {
  LocalReviewUseCaseDependencies,
  UpsertReviewTemplateRequest,
  UpsertReviewTemplateResult,
} from './contracts'
import {
  getRequestCorrelationId,
  getErrorName,
  toLocalReviewError,
} from './operation'

const logger = rootLogger.child({ scope: "localReview.upsertTemplate" })

export const createUpsertReviewTemplate = (
  repository: LocalReviewRepository,
  dependencies: LocalReviewUseCaseDependencies = {},
) => {
  const now = dependencies.now ?? (() => new Date())
  const createId = dependencies.createId ?? (() => crypto.randomUUID())

  return async (
    requestInput: UpsertReviewTemplateRequest,
  ): Promise<UpsertReviewTemplateResult> => {
    let request: UpsertReviewTemplateRequest

    try {
      request = parseUpsertReviewTemplateRequest(requestInput)
    } catch (error) {
      logger.warn('Rejected review template upsert at background boundary', {
        errorName: getErrorName(error),
      })
      return parseUpsertReviewTemplateResponse({
        status: 'error',
        correlationId: getRequestCorrelationId(requestInput),
        error: {
          code: 'invalid-input',
          message: 'Invalid review template upsert request',
        },
      })
    }

    const correlationId = request.correlationId
    logger.info('Handling review template upsert', { correlationId })

    try {
      const draft = normalizeReviewTemplateDraft(request.template)
      const timestamp = now().toISOString()
      const template: ReviewTemplate = {
        id: draft.id ?? createId(),
        title: draft.title,
        body: draft.body,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      logger.debug('Persisting review template', {
        correlationId,
        templateId: template.id,
        titleLength: template.title.length,
        bodyLength: template.body.length,
      })
      const savedTemplate = await repository.upsertTemplate(template)
      const templates = sortReviewTemplates(await repository.listTemplates())
      logger.info('Review template upsert completed', {
        correlationId,
        templateId: savedTemplate.id,
        templateCount: templates.length,
      })
      return parseUpsertReviewTemplateResponse({
        status: 'success',
        correlationId,
        data: { template: savedTemplate, templates },
      })
    } catch (error) {
      const localReviewError = toLocalReviewError(error)
      const log =
        localReviewError.code === 'storage-unavailable'
          ? logger.error
          : logger.warn
      log('Review template upsert failed', {
        correlationId,
        code: localReviewError.code,
        errorName: getErrorName(error),
      })
      return parseUpsertReviewTemplateResponse({
        status: 'error',
        correlationId,
        error: localReviewError,
      })
    }
  }
}
