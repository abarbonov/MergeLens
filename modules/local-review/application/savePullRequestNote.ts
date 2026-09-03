import { logger as rootLogger } from '@/shared/logging'
import {
  parseSavePullRequestNoteRequest,
  parseSavePullRequestNoteResponse,
} from '@/shared/messaging/protocol'
import {
  createPullRequestKey,
  normalizePullRequestNoteBody,
  type PullRequestNote,
} from '../domain/LocalReview'
import type { LocalReviewRepository } from '../ports/LocalReviewRepository'
import type {
  LocalReviewUseCaseDependencies,
  SavePullRequestNoteRequest,
  SavePullRequestNoteResult,
} from './contracts'
import {
  getRequestCorrelationId,
  getErrorName,
  toLocalReviewError,
} from './operation'

const logger = rootLogger.child({ scope: "localReview.saveNote" })

export const createSavePullRequestNote = (
  repository: LocalReviewRepository,
  dependencies: Pick<LocalReviewUseCaseDependencies, 'now'> = {},
) => {
  const now = dependencies.now ?? (() => new Date())

  return async (
    requestInput: SavePullRequestNoteRequest,
  ): Promise<SavePullRequestNoteResult> => {
    let request: SavePullRequestNoteRequest

    try {
      request = parseSavePullRequestNoteRequest(requestInput)
    } catch (error) {
      logger.warn('Rejected pull request note save at background boundary', {
        errorName: getErrorName(error),
      })
      return parseSavePullRequestNoteResponse({
        status: 'error',
        correlationId: getRequestCorrelationId(requestInput),
        error: {
          code: 'invalid-input',
          message: 'Invalid pull request note save request',
        },
      })
    }

    const correlationId = request.correlationId
    logger.info('Handling pull request note save', { correlationId })

    try {
      const identity = createPullRequestKey(request.context)
      const body = normalizePullRequestNoteBody(request.body)
      const note: PullRequestNote = {
        ...identity,
        body,
        updatedAt: now().toISOString(),
      }
      logger.debug('Persisting pull request note', {
        correlationId,
        prKey: identity.prKey,
        bodyLength: body.length,
        isDelete: body.length === 0,
      })
      const savedNote = await repository.saveNote(note)
      logger.info('Pull request note save completed', {
        correlationId,
        prKey: identity.prKey,
        isPresent: Boolean(savedNote),
      })
      return parseSavePullRequestNoteResponse({
        status: 'success',
        correlationId,
        data: { note: savedNote },
      })
    } catch (error) {
      const localReviewError = toLocalReviewError(error)
      const log =
        localReviewError.code === 'storage-unavailable'
          ? logger.error
          : logger.warn
      log('Pull request note save failed', {
        correlationId,
        code: localReviewError.code,
        errorName: getErrorName(error),
      })
      return parseSavePullRequestNoteResponse({
        status: 'error',
        correlationId,
        error: localReviewError,
      })
    }
  }
}
