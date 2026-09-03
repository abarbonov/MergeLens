import { logger as rootLogger } from '@/shared/logging'
import {
  parseGetLocalReviewWorkspaceRequest,
  parseGetLocalReviewWorkspaceResponse,
} from '@/shared/messaging/protocol'
import {
  createPullRequestKey,
  sortReviewTemplates,
} from '../domain/LocalReview'
import type { LocalReviewRepository } from '../ports/LocalReviewRepository'
import type {
  GetLocalReviewWorkspaceRequest,
  GetLocalReviewWorkspaceResult,
} from './contracts'
import {
  getRequestCorrelationId,
  getErrorName,
  toLocalReviewError,
} from './operation'

const logger = rootLogger.child({ scope: "localReview.getWorkspace" })

export const createGetLocalReviewWorkspace = (
  repository: LocalReviewRepository,
) => {
  return async (
    requestInput: GetLocalReviewWorkspaceRequest,
  ): Promise<GetLocalReviewWorkspaceResult> => {
    let request: GetLocalReviewWorkspaceRequest

    try {
      request = parseGetLocalReviewWorkspaceRequest(requestInput)
    } catch (error) {
      logger.warn(
        'Rejected local review workspace request at background boundary',
        {
          errorName: getErrorName(error),
        },
      )
      return parseGetLocalReviewWorkspaceResponse({
        status: 'error',
        correlationId: getRequestCorrelationId(requestInput),
        error: {
          code: 'invalid-input',
          message: 'Invalid local review workspace request',
        },
      })
    }

    const correlationId = request.correlationId
    logger.info('Handling local review workspace request', { correlationId })

    try {
      const identity = createPullRequestKey(request.context)
      logger.debug('Loading local review workspace', {
        correlationId,
        prKey: identity.prKey,
      })
      const [note, templates] = await Promise.all([
        repository.readNote(identity),
        repository.listTemplates(),
      ])
      const sortedTemplates = sortReviewTemplates(templates)
      logger.info('Local review workspace request completed', {
        correlationId,
        prKey: identity.prKey,
        hasNote: Boolean(note),
        templateCount: sortedTemplates.length,
      })
      return parseGetLocalReviewWorkspaceResponse({
        status: 'success',
        correlationId,
        data: { note, templates: sortedTemplates },
      })
    } catch (error) {
      const localReviewError = toLocalReviewError(error)
      const log =
        localReviewError.code === 'storage-unavailable'
          ? logger.error
          : logger.warn
      log('Local review workspace request failed', {
        correlationId,
        code: localReviewError.code,
        errorName: getErrorName(error),
      })
      return parseGetLocalReviewWorkspaceResponse({
        status: 'error',
        correlationId,
        error: localReviewError,
      })
    }
  }
}
