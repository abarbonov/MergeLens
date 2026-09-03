import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import { readLocalGitHubToken } from '@/shared/github/auth/localToken'
import { logger as rootLogger } from '@/shared/logging'
import type { ConfiguredQuickLink, QuickLinksError } from '../domain/QuickLinks'
import type {
  QuickLinksReader,
  QuickLinksReadResult,
  ReadQuickLinksInput,
} from '../ports/QuickLinksReader'
import { mapQuickLinksResponse } from './mapQuickLinksResponse'

const logger = rootLogger.child({ scope: "github.api.quickLinksReader" })
const MAX_DEPLOYMENTS = 6

type TokenReader = () => Promise<string | null>
type ConfiguredLinksReader = () => Promise<ConfiguredQuickLink[]>
type PullResponse = { data: unknown }
type DeploymentsResponse = {
  data: unknown[]
  headers: Record<string, string | number | undefined>
}
type StatusesResponse = { data: unknown[] }

interface QuickLinksGitHubClient {
  rest: {
    pulls: {
      get(input: {
        owner: string
        repo: string
        pull_number: number
      }): Promise<PullResponse>
    }
    repos: {
      listDeployments(input: {
        owner: string
        repo: string
        sha: string
        per_page: number
      }): Promise<DeploymentsResponse>
      listDeploymentStatuses(input: {
        owner: string
        repo: string
        deployment_id: number
        per_page: number
      }): Promise<StatusesResponse>
    }
  }
}

type GitHubClientFactory = (token: string) => QuickLinksGitHubClient

const createGitHubClient: GitHubClientFactory = (token) => {
  return new Octokit({ auth: token }) as unknown as QuickLinksGitHubClient
}

const pullHeadSchema = z.object({ head: z.object({ sha: z.string().min(1) }) })
const deploymentIdSchema = z.object({ id: z.union([z.number(), z.string()]) })

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
    const parsed = Number(retryAfter)
    return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined
  }
  if (!rateLimitReset) return undefined
  const resetAt = Number(rateLimitReset)
  return Number.isFinite(resetAt)
    ? Math.max(0, Math.ceil(resetAt - Date.now() / 1000))
    : undefined
}

const mapRequestError = (error: unknown): QuickLinksError => {
  if (error instanceof z.ZodError) {
    logger.error('GitHub returned invalid deployment data', {
      issueCount: error.issues.length,
    })
    return {
      code: 'invalid-response',
      message: 'GitHub returned invalid deployment data',
    }
  }
  if (isGitHubRequestError(error)) {
    if (error.status === 401) {
      logger.warn('GitHub rejected the configured deployment token', {
        status: error.status,
      })
      return { code: 'unauthorized', message: 'GitHub token is not authorized' }
    }
    if (error.status === 403 || error.status === 429) {
      const retryAfterSeconds = getRetryAfterSeconds(error)
      logger.warn('GitHub rate limit blocked deployment loading', {
        status: error.status,
        retryAfterSeconds,
      })
      return {
        code: 'rate-limited',
        message: 'GitHub API rate limit exceeded',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      }
    }
    logger.error('GitHub deployment request failed', { status: error.status })
    return {
      code: error.status >= 500 ? 'network-error' : 'unknown-error',
      message: 'GitHub deployment request failed',
    }
  }
  logger.error('GitHub deployment transport failed', {
    errorName: error instanceof Error ? error.name : 'UnknownError',
  })
  return { code: 'network-error', message: 'Unable to reach GitHub' }
}

export class OctokitQuickLinksReader implements QuickLinksReader {
  constructor(
    private readonly readToken: TokenReader = readLocalGitHubToken,
    private readonly createClient: GitHubClientFactory = createGitHubClient,
    private readonly readConfiguredLinks: ConfiguredLinksReader = async () => [],
  ) {}

  async read(input: ReadQuickLinksInput): Promise<QuickLinksReadResult> {
    logger.info('Loading pull request quick links from GitHub')
    logger.debug('Quick links request prepared', {
      owner: input.owner,
      repository: input.repository,
      pullNumber: input.pullNumber,
      deploymentLimit: MAX_DEPLOYMENTS,
    })

    const configuredLinks = await this.readConfiguredLinks()
    const token = await this.readToken()
    if (!token) {
      logger.warn('Cannot load deployments without a GitHub token', {
        configuredLinkCount: configuredLinks.length,
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
      const client = this.createClient(token)
      const pullResponse = await client.rest.pulls.get({
        owner: input.owner,
        repo: input.repository,
        pull_number: input.pullNumber,
      })
      const headSha = pullHeadSchema.parse(pullResponse.data).head.sha
      const deploymentsResponse = await client.rest.repos.listDeployments({
        owner: input.owner,
        repo: input.repository,
        sha: headSha,
        per_page: MAX_DEPLOYMENTS,
      })
      const deployments = z
        .array(deploymentIdSchema)
        .parse(deploymentsResponse.data)
      const statuses = new Map<string, unknown[]>()

      await Promise.all(
        deployments.map(async ({ id }) => {
          const numericId = Number(id)
          if (!Number.isSafeInteger(numericId) || numericId <= 0) {
            throw new z.ZodError([])
          }
          const response = await client.rest.repos.listDeploymentStatuses({
            owner: input.owner,
            repo: input.repository,
            deployment_id: numericId,
            per_page: 1,
          })
          statuses.set(String(id), response.data)
        }),
      )

      const data = mapQuickLinksResponse(
        deploymentsResponse.data,
        statuses,
        configuredLinks,
      )
      logger.info('Loaded pull request quick links', {
        deploymentCount: data.deployments.length,
        configuredLinkCount: data.configuredLinks.length,
        rateLimitRemaining:
          deploymentsResponse.headers['x-ratelimit-remaining'] ?? 'unknown',
      })
      return { status: 'success', data }
    } catch (error) {
      return { status: 'error', error: mapRequestError(error) }
    }
  }
}
