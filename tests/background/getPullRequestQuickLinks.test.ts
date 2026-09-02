import { describe, expect, it, vi } from 'vitest'
import {
  createGetPullRequestQuickLinks,
  type QuickLinksReader,
} from '@/modules/quick-links'

vi.mock('@/shared/github/auth/localToken', () => ({
  readLocalGitHubToken: vi.fn(),
}))

const request = {
  correlationId: 'quick-1',
  context: {
    kind: 'pull-request' as const,
    owner: 'facebook',
    repository: 'react',
    pullNumber: 42,
    url: 'https://github.com/facebook/react/pull/42',
  },
}

describe('getPullRequestQuickLinks', () => {
  it('preserves correlation ID and normalized data', async () => {
    const reader: QuickLinksReader = {
      read: vi.fn().mockResolvedValue({
        status: 'success',
        data: { deployments: [], configuredLinks: [] },
      }),
    }
    await expect(
      createGetPullRequestQuickLinks(reader)(request),
    ).resolves.toEqual({
      status: 'success',
      correlationId: 'quick-1',
      data: { deployments: [], configuredLinks: [] },
    })
  })

  it('rejects malformed input before calling the reader', async () => {
    const reader: QuickLinksReader = { read: vi.fn() }
    await expect(
      createGetPullRequestQuickLinks(reader)({
        ...request,
        context: null,
      } as never),
    ).resolves.toMatchObject({
      status: 'error',
      correlationId: 'quick-1',
      error: { code: 'invalid-request' },
    })
    expect(reader.read).not.toHaveBeenCalled()
  })
})
