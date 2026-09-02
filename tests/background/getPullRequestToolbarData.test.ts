import { describe, expect, it, vi } from 'vitest'
import { createGetPullRequestToolbarData } from '@/modules/pull-requests'
import type { PullRequestReader } from '@/modules/pull-requests'

vi.mock('@/shared/github/auth/localToken', () => ({
  readLocalGitHubToken: vi.fn(),
}))

const request = {
  correlationId: 'request-1',
  context: {
    kind: 'pull-request' as const,
    owner: 'openai',
    repository: 'codex',
    pullNumber: 42,
    url: 'https://github.com/openai/codex/pull/42',
  },
}

const toolbarData = {
  pullRequest: {
    title: 'Add PR toolbar',
    url: 'https://github.com/openai/codex/pull/42',
    state: 'open' as const,
    isDraft: false,
    authorLogin: 'octocat',
  },
  checks: [],
  diffUrl: 'https://github.com/openai/codex/pull/42.diff',
}

const createReader = (
  result: Awaited<ReturnType<PullRequestReader['read']>>,
): PullRequestReader => {
  return { read: vi.fn().mockResolvedValue(result) }
}

describe('getPullRequestToolbarData', () => {
  it('returns normalized success data with the request correlation ID', async () => {
    const reader = createReader({ status: 'success', data: toolbarData })
    const getPullRequestToolbarData = createGetPullRequestToolbarData(reader)

    await expect(getPullRequestToolbarData(request)).resolves.toEqual({
      status: 'success',
      correlationId: 'request-1',
      data: toolbarData,
    })
    expect(reader.read).toHaveBeenCalledWith({
      owner: 'openai',
      repository: 'codex',
      pullNumber: 42,
    })
  })

  it('preserves typed reader errors', async () => {
    const reader = createReader({
      status: 'error',
      error: {
        code: 'missing-token',
        message: 'GitHub token is not configured',
      },
    })
    const getPullRequestToolbarData = createGetPullRequestToolbarData(reader)

    await expect(getPullRequestToolbarData(request)).resolves.toEqual({
      status: 'error',
      correlationId: 'request-1',
      error: {
        code: 'missing-token',
        message: 'GitHub token is not configured',
      },
    })
  })

  it('rejects malformed background input before calling the reader', async () => {
    const reader = createReader({ status: 'success', data: toolbarData })
    const getPullRequestToolbarData = createGetPullRequestToolbarData(reader)

    const response = await getPullRequestToolbarData({
      ...request,
      context: { ...request.context, pullNumber: 0 },
    } as never)

    expect(response).toMatchObject({
      status: 'error',
      correlationId: 'request-1',
      error: { code: 'invalid-request' },
    })
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('uses a safe correlation ID for wholly malformed requests', async () => {
    const reader = createReader({ status: 'success', data: toolbarData })
    const getPullRequestToolbarData = createGetPullRequestToolbarData(reader)

    const response = await getPullRequestToolbarData({
      correlationId: '',
      context: null,
    } as never)

    expect(response).toMatchObject({
      status: 'error',
      correlationId: 'invalid-request',
      error: { code: 'invalid-request' },
    })
    expect(reader.read).not.toHaveBeenCalled()
  })

  it('contains unexpected reader failures as a stable response', async () => {
    const reader: PullRequestReader = {
      read: vi.fn().mockRejectedValue(new Error('Unexpected failure')),
    }
    const getPullRequestToolbarData = createGetPullRequestToolbarData(reader)

    await expect(getPullRequestToolbarData(request)).resolves.toMatchObject({
      status: 'error',
      correlationId: 'request-1',
      error: { code: 'unknown-error' },
    })
  })
})
