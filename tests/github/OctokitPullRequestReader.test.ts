import { describe, expect, it, vi } from 'vitest'
import { OctokitPullRequestReader } from '@/modules/pull-requests/adapters/OctokitPullRequestReader'

vi.mock('@/shared/github/auth/localToken', () => ({
  readLocalGitHubToken: vi.fn(),
}))

const pullRequestData = {
  html_url: 'https://github.com/octo/example/pull/42',
  title: 'Add PR toolbar',
  state: 'open',
  merged: false,
  draft: false,
  user: { login: 'octocat' },
  head: { sha: 'abc123' },
}

const input = { owner: 'octo', repository: 'example', pullNumber: 42 }

const createClient = (
  pullsGet: ReturnType<typeof vi.fn>,
  checksListForRef: ReturnType<typeof vi.fn> = vi.fn(),
) => {
  return {
    rest: {
      pulls: { get: pullsGet },
      checks: { listForRef: checksListForRef },
    },
  } as never
}

const createRequestError = (
  status: number,
  headers: Record<string, string> = {},
) => {
  return Object.assign(new Error('GitHub request failed'), {
    status,
    response: { headers },
  })
}

describe('OctokitPullRequestReader', () => {
  it('returns a typed missing-token error before creating a client', async () => {
    const clientFactory = vi.fn()
    const reader = new OctokitPullRequestReader(
      vi.fn().mockResolvedValue(null),
      clientFactory,
    )

    await expect(reader.read(input)).resolves.toEqual({
      status: 'error',
      error: {
        code: 'missing-token',
        message: 'GitHub token is not configured',
      },
    })
    expect(clientFactory).not.toHaveBeenCalled()
  })

  it('loads and normalizes pull request data without exposing the token', async () => {
    const pullsGet = vi.fn().mockResolvedValue({ data: pullRequestData })
    const checksListForRef = vi.fn().mockResolvedValue({
      data: { check_runs: [] },
      headers: { 'x-ratelimit-remaining': '4999' },
    })
    const clientFactory = vi.fn(() => createClient(pullsGet, checksListForRef))
    const reader = new OctokitPullRequestReader(
      vi.fn().mockResolvedValue('test-token'),
      clientFactory,
    )

    const result = await reader.read(input)

    expect(result).toMatchObject({ status: 'success', data: { checks: [] } })
    expect(clientFactory).toHaveBeenCalledWith('test-token')
    expect(pullsGet).toHaveBeenCalledWith({
      owner: 'octo',
      repo: 'example',
      pull_number: 42,
    })
    expect(checksListForRef).toHaveBeenCalledWith({
      owner: 'octo',
      repo: 'example',
      ref: 'abc123',
      per_page: 100,
    })
    expect(JSON.stringify(result)).not.toContain('test-token')
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'rate-limited'],
    [429, 'rate-limited'],
    [503, 'network-error'],
  ] as const)('maps HTTP %s to %s', async (status, errorCode) => {
    const pullsGet = vi.fn().mockRejectedValue(createRequestError(status))
    const reader = new OctokitPullRequestReader(
      vi.fn().mockResolvedValue('test-token'),
      () => createClient(pullsGet),
    )

    const result = await reader.read(input)

    expect(result).toMatchObject({
      status: 'error',
      error: { code: errorCode },
    })
  })

  it('returns retry timing from rate-limit headers', async () => {
    const pullsGet = vi
      .fn()
      .mockRejectedValue(createRequestError(403, { 'retry-after': '30' }))
    const reader = new OctokitPullRequestReader(
      vi.fn().mockResolvedValue('test-token'),
      () => createClient(pullsGet),
    )

    await expect(reader.read(input)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'rate-limited', retryAfterSeconds: 30 },
    })
  })

  it('maps malformed and transport failures to stable errors', async () => {
    const malformedReader = new OctokitPullRequestReader(
      vi.fn().mockResolvedValue('test-token'),
      () => createClient(vi.fn().mockResolvedValue({ data: { title: 42 } })),
    )
    const networkReader = new OctokitPullRequestReader(
      vi.fn().mockResolvedValue('test-token'),
      () =>
        createClient(
          vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
        ),
    )

    await expect(malformedReader.read(input)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'invalid-response' },
    })
    await expect(networkReader.read(input)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'network-error' },
    })
  })
})
