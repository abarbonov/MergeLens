import { defineExtensionMessaging } from '@webext-core/messaging'
import { logger as rootLogger } from '@/shared/logging'
import {
  deleteReviewTemplateRequestSchema,
  deleteReviewTemplateResponseSchema,
  getLocalReviewWorkspaceRequestSchema,
  getLocalReviewWorkspaceResponseSchema,
  listReviewTemplatesRequestSchema,
  listReviewTemplatesResponseSchema,
  reviewInboxRequestSchema,
  reviewInboxResponseSchema,
  quickLinksRequestSchema,
  quickLinksResponseSchema,
  savePullRequestNoteRequestSchema,
  savePullRequestNoteResponseSchema,
  toolbarRequestSchema,
  toolbarResponseSchema,
  upsertReviewTemplateRequestSchema,
  upsertReviewTemplateResponseSchema,
  type DeleteReviewTemplateRequest,
  type DeleteReviewTemplateResponse,
  type GetLocalReviewWorkspaceRequest,
  type GetLocalReviewWorkspaceResponse,
  type ListReviewTemplatesRequest,
  type ListReviewTemplatesResponse,
  type OpenOptionsPageResponse,
  type QuickLinksRequest,
  type QuickLinksResponse,
  type OpenCommandPaletteResponse,
  type ReviewInboxRequest,
  type ReviewInboxResponse,
  type SavePullRequestNoteRequest,
  type SavePullRequestNoteResponse,
  type ToolbarRequest,
  type ToolbarResponse,
  type UpsertReviewTemplateRequest,
  type UpsertReviewTemplateResponse,
} from './schemas'

const logger = rootLogger.child({ scope: "messaging" })

export interface MergeLensProtocolMap {
  getPullRequestToolbarData(data: ToolbarRequest): ToolbarResponse
  getPullRequestQuickLinks(data: QuickLinksRequest): QuickLinksResponse
  getReviewInbox(data: ReviewInboxRequest): ReviewInboxResponse
  getLocalReviewWorkspace(
    data: GetLocalReviewWorkspaceRequest,
  ): GetLocalReviewWorkspaceResponse
  savePullRequestNote(
    data: SavePullRequestNoteRequest,
  ): SavePullRequestNoteResponse
  listReviewTemplates(
    data: ListReviewTemplatesRequest,
  ): ListReviewTemplatesResponse
  upsertReviewTemplate(
    data: UpsertReviewTemplateRequest,
  ): UpsertReviewTemplateResponse
  deleteReviewTemplate(
    data: DeleteReviewTemplateRequest,
  ): DeleteReviewTemplateResponse
  openOptionsPage(): OpenOptionsPageResponse
  openCommandPalette(): OpenCommandPaletteResponse
}

export const { onMessage, removeAllListeners, sendMessage } =
  defineExtensionMessaging<MergeLensProtocolMap>({
    logger: {
      debug: (...args) =>
        logger.debug('Message debug event', {
          argumentCount: args.length,
        }),
      log: (...args) =>
        logger.info('Message lifecycle event', {
          argumentCount: args.length,
        }),
      warn: (...args) =>
        logger.warn('Message warning', {
          argumentCount: args.length,
        }),
      error: (...args) =>
        logger.error('Message failure', {
          argumentCount: args.length,
        }),
    },
    throwOnUnknownMessageFormat: false,
  })

export const parseToolbarRequest = (input: unknown): ToolbarRequest => {
  const result = toolbarRequestSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Rejected invalid toolbar request', {
      issueCount: result.error.issues.length,
    })
    throw new Error('Invalid PR toolbar request')
  }

  logger.debug('Validated toolbar request', {
    correlationId: result.data.correlationId,
    owner: result.data.context.owner,
    repository: result.data.context.repository,
    pullNumber: result.data.context.pullNumber,
  })
  return result.data
}

export const parseToolbarResponse = (input: unknown): ToolbarResponse => {
  const result = toolbarResponseSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Rejected invalid toolbar response', {
      issueCount: result.error.issues.length,
    })
    throw new Error('Invalid PR toolbar response')
  }

  logger.debug('Validated toolbar response', {
    correlationId: result.data.correlationId,
    status: result.data.status,
  })
  return result.data
}

export const parseQuickLinksRequest = (input: unknown): QuickLinksRequest => {
  const result = quickLinksRequestSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Rejected invalid quick links request', {
      issueCount: result.error.issues.length,
    })
    throw new Error('Invalid quick links request')
  }
  logger.debug('Validated quick links request', {
    correlationId: result.data.correlationId,
    owner: result.data.context.owner,
    repository: result.data.context.repository,
    pullNumber: result.data.context.pullNumber,
  })
  return result.data
}

export const parseQuickLinksResponse = (input: unknown): QuickLinksResponse => {
  const result = quickLinksResponseSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Rejected invalid quick links response', {
      issueCount: result.error.issues.length,
    })
    throw new Error('Invalid quick links response')
  }
  logger.debug('Validated quick links response', {
    correlationId: result.data.correlationId,
    status: result.data.status,
  })
  return result.data
}

export const parseReviewInboxRequest = (input: unknown): ReviewInboxRequest => {
  const result = reviewInboxRequestSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Rejected invalid review inbox request', {
      issueCount: result.error.issues.length,
    })
    throw new Error('Invalid review inbox request')
  }

  logger.debug('Validated review inbox request', {
    correlationId: result.data.correlationId,
  })
  return result.data
}

export const parseReviewInboxResponse = (
  input: unknown,
): ReviewInboxResponse => {
  const result = reviewInboxResponseSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Rejected invalid review inbox response', {
      issueCount: result.error.issues.length,
    })
    throw new Error('Invalid review inbox response')
  }

  logger.debug('Validated review inbox response', {
    correlationId: result.data.correlationId,
    status: result.data.status,
    sectionStatuses:
      result.data.status === 'success'
        ? {
            reviewRequests: result.data.data.reviewRequests.status,
            assigned: result.data.data.assigned.status,
            recentActivity: result.data.data.recentActivity.status,
          }
        : undefined,
  })
  return result.data
}

const parseLocalReviewMessage = <T>(
  schema: {
    safeParse: (
      input: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: unknown[] } }
  },
  input: unknown,
  label: string,
  metadata: (data: T) => Record<string, unknown>,
): T => {
  const result = schema.safeParse(input)
  if (!result.success) {
    logger.warn(`Rejected invalid ${label}`, {
      issueCount: result.error.issues.length,
    })
    throw new Error(`Invalid ${label}`)
  }

  logger.debug(`Validated ${label}`, metadata(result.data))
  return result.data
}

const responseMetadata = (response: {
  correlationId: string
  status: 'success' | 'error'
}) => ({
  correlationId: response.correlationId,
  status: response.status,
})

export const parseGetLocalReviewWorkspaceRequest = (
  input: unknown,
): GetLocalReviewWorkspaceRequest =>
  parseLocalReviewMessage(
    getLocalReviewWorkspaceRequestSchema,
    input,
    'local review workspace request',
    (request) => ({
      correlationId: request.correlationId,
      owner: request.context.owner,
      repository: request.context.repository,
      pullNumber: request.context.pullNumber,
    }),
  )

export const parseGetLocalReviewWorkspaceResponse = (
  input: unknown,
): GetLocalReviewWorkspaceResponse =>
  parseLocalReviewMessage(
    getLocalReviewWorkspaceResponseSchema,
    input,
    'local review workspace response',
    responseMetadata,
  )

export const parseSavePullRequestNoteRequest = (
  input: unknown,
): SavePullRequestNoteRequest =>
  parseLocalReviewMessage(
    savePullRequestNoteRequestSchema,
    input,
    'pull request note save request',
    (request) => ({
      correlationId: request.correlationId,
      owner: request.context.owner,
      repository: request.context.repository,
      pullNumber: request.context.pullNumber,
      bodyLength: request.body.length,
    }),
  )

export const parseSavePullRequestNoteResponse = (
  input: unknown,
): SavePullRequestNoteResponse =>
  parseLocalReviewMessage(
    savePullRequestNoteResponseSchema,
    input,
    'pull request note save response',
    responseMetadata,
  )

export const parseListReviewTemplatesRequest = (
  input: unknown,
): ListReviewTemplatesRequest =>
  parseLocalReviewMessage(
    listReviewTemplatesRequestSchema,
    input,
    'review template list request',
    (request) => ({ correlationId: request.correlationId }),
  )

export const parseListReviewTemplatesResponse = (
  input: unknown,
): ListReviewTemplatesResponse =>
  parseLocalReviewMessage(
    listReviewTemplatesResponseSchema,
    input,
    'review template list response',
    responseMetadata,
  )

export const parseUpsertReviewTemplateRequest = (
  input: unknown,
): UpsertReviewTemplateRequest =>
  parseLocalReviewMessage(
    upsertReviewTemplateRequestSchema,
    input,
    'review template upsert request',
    (request) => ({
      correlationId: request.correlationId,
      templateId: request.template.id,
      titleLength: request.template.title.length,
      bodyLength: request.template.body.length,
    }),
  )

export const parseUpsertReviewTemplateResponse = (
  input: unknown,
): UpsertReviewTemplateResponse =>
  parseLocalReviewMessage(
    upsertReviewTemplateResponseSchema,
    input,
    'review template upsert response',
    responseMetadata,
  )

export const parseDeleteReviewTemplateRequest = (
  input: unknown,
): DeleteReviewTemplateRequest =>
  parseLocalReviewMessage(
    deleteReviewTemplateRequestSchema,
    input,
    'review template delete request',
    (request) => ({
      correlationId: request.correlationId,
      templateId: request.templateId,
    }),
  )

export const parseDeleteReviewTemplateResponse = (
  input: unknown,
): DeleteReviewTemplateResponse =>
  parseLocalReviewMessage(
    deleteReviewTemplateResponseSchema,
    input,
    'review template delete response',
    responseMetadata,
  )

export const createCorrelationId = (): string => {
  return crypto.randomUUID()
}

export const isReceiverUnavailableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes('Receiving end does not exist') ||
    error.message.includes('Could not establish connection') ||
    error.message.includes('No listener was registered')
  )
}
