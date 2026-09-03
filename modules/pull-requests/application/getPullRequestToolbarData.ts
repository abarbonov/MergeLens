import { logger as rootLogger } from '@/shared/logging'
import {
  parseToolbarRequest,
  parseToolbarResponse,
} from '@/shared/messaging/protocol'
import type {
  ToolbarRequest,
  ToolbarResponse,
} from '@/shared/messaging/schemas'
import type { PullRequestReader } from '../ports/PullRequestReader'
import { estimatePullRequest } from '@/modules/pull-request-estimation'

const logger = rootLogger.child({ scope: "pullRequests.getToolbarData" })

const getSafeCorrelationId = (input: unknown): string => {
  if (typeof input === 'string' && input.length >= 1 && input.length <= 128) {
    return input
  }

  return 'invalid-request'
}

export const createGetPullRequestToolbarData = (
  pullRequestReader: PullRequestReader,
) => {
  return async (requestInput: ToolbarRequest): Promise<ToolbarResponse> => {
    let request: ToolbarRequest

    try {
      request = parseToolbarRequest(requestInput)
    } catch (error) {
      logger.warn('Rejected toolbar request at background boundary', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      return parseToolbarResponse({
        status: 'error',
        correlationId: getSafeCorrelationId(requestInput?.correlationId),
        error: {
          code: 'invalid-request',
          message: 'Invalid PR toolbar request',
        },
      })
    }

    logger.info('Handling PR toolbar data request')
    logger.debug('Normalized PR toolbar request', {
      correlationId: request.correlationId,
      owner: request.context.owner,
      repository: request.context.repository,
      pullNumber: request.context.pullNumber,
    })

    try {
      const result = await pullRequestReader.read({
        owner: request.context.owner,
        repository: request.context.repository,
        pullNumber: request.context.pullNumber,
      })

      const resultData =
        result.status === 'success' && result.data.files !== undefined
          ? {
              ...result.data,
              estimation: estimatePullRequest({
                files: result.data.files,
                checks: result.data.checks,
                truncated: {
                  files: result.data.filesTruncated === true,
                  checks: false,
                },
              }),
            }
          : result.status === 'success'
            ? result.data
            : undefined
      const response =
        result.status === 'success'
          ? {
              status: 'success' as const,
              correlationId: request.correlationId,
              data: resultData,
            }
          : {
              status: 'error' as const,
              correlationId: request.correlationId,
              error: result.error,
            }
      const validatedResponse = parseToolbarResponse(response)

      if (validatedResponse.status === 'success') {
        logger.info('PR toolbar data request completed', {
          checkCount: validatedResponse.data.checks.length,
          hasEstimation: validatedResponse.data.estimation !== undefined,
        })
      } else {
        logger.warn('PR toolbar data request returned an expected error', {
          code: validatedResponse.error.code,
        })
      }

      return validatedResponse
    } catch (error) {
      logger.error('Unexpected PR toolbar handler failure', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      return parseToolbarResponse({
        status: 'error',
        correlationId: request.correlationId,
        error: {
          code: 'unknown-error',
          message: 'Unable to load PR toolbar data',
        },
      })
    }
  }
}
