import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import { readLocalGitHubToken } from '@/shared/github/auth/localToken'
import { logger as rootLogger } from '@/shared/logging'
import type {
  ReviewInboxError,
  ReviewInboxSectionKind,
} from '../domain/ReviewInbox'
import type {
  ReadReviewInboxSectionInput,
  ReviewInboxReader,
  ReviewInboxReadSectionResult,
} from '../ports/ReviewInboxReader'
import { mapReviewInboxSearchItems } from './mapReviewInboxResponse'

const logger = rootLogger.child({ scope: "github.api.reviewInboxReader" })
const MAX_SECTION_ITEMS = 20

type TokenReader = () => Promise<string | null>
type SearchResponse = {
  data: { items: unknown[] }
  headers: Record<string, string | number | undefined>
}
interface GitHubSearchClient {
  rest: {
    search: {
      issuesAndPullRequests(input: {
        q: string
        sort: 'updated'
        order: 'desc'
        per_page: number
        page: number
      }): Promise<SearchResponse>
    }
  }
}
type GitHubClientFactory = (token: string) => GitHubSearchClient

const createGitHubClient: GitHubClientFactory = (token) => {
  return new Octokit({ auth: token }) as GitHubSearchClient
}

interface GitHubRequestError extends Error {
  status: number
  response?: { headers: Record<string, string | undefined> }
}

const isGitHubRequestError = (error: unknown): error is GitHubRequestError => {
  return (
    error instanceof Error &&
    'status' in error &&
    typeof error.status === 'number'
  )
}

const getRetryAfterSeconds = (
  error: GitHubRequestError,
): number | undefined => {
  const retryAfter = error.response?.headers['retry-after']
  const rateLimitReset = error.response?.headers['x-ratelimit-reset']

  if (retryAfter) {
    const parsedRetryAfter = Number(retryAfter)
    return Number.isFinite(parsedRetryAfter)
      ? Math.max(0, parsedRetryAfter)
      : undefined
  }

  if (!rateLimitReset) {
    return undefined
  }

  const resetAt = Number(rateLimitReset)
  return Number.isFinite(resetAt)
    ? Math.max(0, Math.ceil(resetAt - Date.now() / 1000))
    : undefined
}

const mapRequestError = (error: unknown): ReviewInboxError => {
  if (error instanceof z.ZodError) {
    logger.error('GitHub returned invalid review inbox data', {
      issueCount: error.issues.length,
    })
    return {
      code: 'invalid-response',
      message: 'GitHub returned invalid inbox data',
    }
  }

  if (isGitHubRequestError(error)) {
    if (error.status === 401) {
      logger.warn('GitHub rejected the configured inbox token', {
        status: error.status,
      })
      return {
        code: 'unauthorized',
        message: 'GitHub token is not authorized',
      }
    }

    if (error.status === 403 || error.status === 429) {
      const retryAfterSeconds = getRetryAfterSeconds(error)
      logger.warn('GitHub Search API rate limit blocked the inbox request', {
        status: error.status,
        retryAfterSeconds,
      })
      return {
        code: 'rate-limited',
        message: 'GitHub Search API rate limit exceeded',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      }
    }

    logger.error('GitHub inbox request failed', { status: error.status })
    return {
      code: error.status >= 500 ? 'network-error' : 'unknown-error',
      message: 'GitHub inbox request failed',
    }
  }

  logger.error('GitHub inbox transport failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })
  return { code: 'network-error', message: 'Unable to reach GitHub' }
}

const getSearchQuery = (kind: ReviewInboxSectionKind): string => {
  const queries: Record<ReviewInboxSectionKind, string> = {
    'review-requests': 'is:pr is:open review-requested:@me',
    assigned: 'is:pr is:open assignee:@me',
    'recent-activity': 'is:pr is:open involves:@me',
  }

  return queries[kind]
}

export class OctokitReviewInboxReader implements ReviewInboxReader {
  constructor(
    private readonly readToken: TokenReader = readLocalGitHubToken,
    private readonly createClient: GitHubClientFactory = createGitHubClient,
  ) {}

  async readSection(
    input: ReadReviewInboxSectionInput,
  ): Promise<ReviewInboxReadSectionResult> {
    const limit = Math.max(1, Math.min(input.limit, MAX_SECTION_ITEMS))
    logger.info('Loading review inbox section from GitHub', {
      section: input.kind,
    })
    logger.debug('Review inbox Search API request prepared', {
      section: input.kind,
      limit,
      page: 1,
    })

    const token = await this.readToken()
    if (!token) {
      logger.warn('Cannot load review inbox section without a token', {
        section: input.kind,
      })
      return {
        status: 'error',
        error: {
          code: 'missing-token',
          message: 'GitHub token is not configured',
        },
      }
    }

    try {
      const response = await this.createClient(
        token,
      ).rest.search.issuesAndPullRequests({
        q: getSearchQuery(input.kind),
        sort: 'updated',
        order: 'desc',
        per_page: limit,
        page: 1,
      })
      const items = mapReviewInboxSearchItems(response.data.items, input.kind)

      logger.info('Loaded review inbox section from GitHub', {
        section: input.kind,
        itemCount: items.length,
        rateLimitRemaining:
          response.headers['x-ratelimit-remaining'] ?? 'unknown',
      })
      return { status: 'success', items }
    } catch (error) {
      return { status: 'error', error: mapRequestError(error) }
    }
  }
}
