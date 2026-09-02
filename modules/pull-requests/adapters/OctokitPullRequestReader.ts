import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import { readLocalGitHubToken } from '@/shared/github/auth/localToken'
import { createLogger } from '@/shared/logging/logger'
import type {
  PullRequestReader,
  PullRequestReadResult,
  ReadPullRequestInput,
} from '../ports/PullRequestReader'
import { getPullRequestHeadSha, mapGitHubResponse } from './mapGitHubResponse'

const logger = createLogger('github.api.pullRequestReader')

type TokenReader = () => Promise<string | null>
type GitHubClient = Pick<Octokit, 'rest'>
type GitHubClientFactory = (token: string) => GitHubClient

const createGitHubClient: GitHubClientFactory = (token) => {
  return new Octokit({ auth: token })
}

interface GitHubRequestError extends Error {
  status: number
  response?: {
    headers: Record<string, string | undefined>
  }
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

  if (rateLimitReset) {
    const resetAt = Number(rateLimitReset)
    return Number.isFinite(resetAt)
      ? Math.max(0, Math.ceil(resetAt - Date.now() / 1000))
      : undefined
  }

  return undefined
}

const mapRequestError = (error: unknown): PullRequestReadResult => {
  if (error instanceof z.ZodError) {
    logger.error('GitHub returned an invalid response', {
      issueCount: error.issues.length,
    })
    return {
      status: 'error',
      error: {
        code: 'invalid-response',
        message: 'GitHub returned invalid data',
      },
    }
  }

  if (isGitHubRequestError(error)) {
    if (error.status === 401) {
      logger.warn('GitHub rejected the configured token', {
        status: error.status,
      })
      return {
        status: 'error',
        error: {
          code: 'unauthorized',
          message: 'GitHub token is not authorized',
        },
      }
    }

    if (error.status === 403 || error.status === 429) {
      const retryAfterSeconds = getRetryAfterSeconds(error)
      logger.warn('GitHub rate limit blocked the request', {
        status: error.status,
        retryAfterSeconds,
      })
      return {
        status: 'error',
        error: {
          code: 'rate-limited',
          message: 'GitHub API rate limit exceeded',
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        },
      }
    }

    logger.error('GitHub request failed', { status: error.status })
    return {
      status: 'error',
      error: {
        code: error.status >= 500 ? 'network-error' : 'unknown-error',
        message: 'GitHub request failed',
      },
    }
  }

  logger.error('GitHub transport failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })
  return {
    status: 'error',
    error: { code: 'network-error', message: 'Unable to reach GitHub' },
  }
}

export class OctokitPullRequestReader implements PullRequestReader {
  constructor(
    private readonly readToken: TokenReader = readLocalGitHubToken,
    private readonly createClient: GitHubClientFactory = createGitHubClient,
  ) {}

  async read(input: ReadPullRequestInput): Promise<PullRequestReadResult> {
    logger.info('Loading PR toolbar data from GitHub')
    logger.debug('GitHub pull request input', {
      owner: input.owner,
      repository: input.repository,
      pullNumber: input.pullNumber,
    })

    const token = await this.readToken()
    if (!token) {
      logger.warn('Cannot load PR toolbar data without a token')
      return {
        status: 'error',
        error: {
          code: 'missing-token',
          message: 'GitHub token is not configured',
        },
      }
    }

    try {
      const octokit = this.createClient(token)
      const pullRequestResponse = await octokit.rest.pulls.get({
        owner: input.owner,
        repo: input.repository,
        pull_number: input.pullNumber,
      })
      const headSha = getPullRequestHeadSha(pullRequestResponse.data)
      const checkRunsResponse = await octokit.rest.checks.listForRef({
        owner: input.owner,
        repo: input.repository,
        ref: headSha,
        per_page: 100,
      })
      const listFiles = octokit.rest.pulls.listFiles
      let filesData: unknown[] | undefined
      let filesTruncated = false
      if (listFiles) {
        try {
          const filesResponse = await listFiles({
            owner: input.owner,
            repo: input.repository,
            pull_number: input.pullNumber,
            per_page: 100,
            page: 1,
          })
          filesData = filesResponse.data
          const filesHeaders = filesResponse.headers as Record<
            string,
            string | undefined
          >
          filesTruncated =
            filesResponse.data.length >= 100 ||
            Number(filesHeaders['x-total-count'] ?? 0) >
              filesResponse.data.length
        } catch (error) {
          logger.warn(
            'Changed-file metadata is unavailable; preserving PR toolbar data',
            {
              errorName: error instanceof Error ? error.name : 'UnknownError',
            },
          )
        }
      }
      const data = mapGitHubResponse(
        pullRequestResponse.data,
        checkRunsResponse.data,
        filesData,
        filesTruncated,
      )

      logger.info('Loaded PR toolbar data from GitHub', {
        checkCount: data.checks.length,
        fileCount: data.files?.length ?? 0,
        filesTruncated,
        rateLimitRemaining:
          checkRunsResponse.headers['x-ratelimit-remaining'] ?? 'unknown',
      })
      if (data.checks.length === 0) {
        logger.warn('GitHub returned no checks for the pull request')
      }

      return { status: 'success', data }
    } catch (error) {
      return mapRequestError(error)
    }
  }
}
