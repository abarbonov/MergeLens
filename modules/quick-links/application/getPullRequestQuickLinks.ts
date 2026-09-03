import { logger as rootLogger } from '@/shared/logging'
import {
  parseQuickLinksRequest,
  parseQuickLinksResponse,
} from '@/shared/messaging/protocol'
import type {
  QuickLinksRequest,
  QuickLinksResponse,
} from '@/shared/messaging/schemas'
import type { QuickLinksReader } from '../ports/QuickLinksReader'

const logger = rootLogger.child({ scope: "quickLinks.getPullRequestQuickLinks" })

const getSafeCorrelationId = (input: unknown): string => {
  return typeof input === 'string' && input.length >= 1 && input.length <= 128
    ? input
    : 'invalid-request'
}

export const createGetPullRequestQuickLinks = (reader: QuickLinksReader) => {
  return async (
    requestInput: QuickLinksRequest,
  ): Promise<QuickLinksResponse> => {
    let request: QuickLinksRequest
    try {
      request = parseQuickLinksRequest(requestInput)
    } catch (error) {
      logger.warn('Rejected quick links request at background boundary', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      return parseQuickLinksResponse({
        status: 'error',
        correlationId: getSafeCorrelationId(requestInput?.correlationId),
        error: {
          code: 'invalid-request',
          message: 'Invalid quick links request',
        },
      })
    }

    logger.info('Handling pull request quick links request')
    logger.debug('Normalized quick links request', {
      correlationId: request.correlationId,
      owner: request.context.owner,
      repository: request.context.repository,
      pullNumber: request.context.pullNumber,
    })

    try {
      const result = await reader.read({
        owner: request.context.owner,
        repository: request.context.repository,
        pullNumber: request.context.pullNumber,
      })
      const response =
        result.status === 'success'
          ? {
              status: 'success' as const,
              correlationId: request.correlationId,
              data: result.data,
            }
          : {
              status: 'error' as const,
              correlationId: request.correlationId,
              error: result.error,
            }
      const validated = parseQuickLinksResponse(response)
      if (validated.status === 'success') {
        logger.info('Pull request quick links request completed', {
          deploymentCount: validated.data.deployments.length,
          configuredLinkCount: validated.data.configuredLinks.length,
        })
      } else {
        logger.warn('Pull request quick links returned an expected error', {
          code: validated.error.code,
        })
      }
      return validated
    } catch (error) {
      logger.error('Unexpected quick links handler failure', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      return parseQuickLinksResponse({
        status: 'error',
        correlationId: request.correlationId,
        error: { code: 'unknown-error', message: 'Unable to load quick links' },
      })
    }
  }
}
