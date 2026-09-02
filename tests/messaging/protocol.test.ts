import { describe, expect, it } from 'vitest'
import {
  isReceiverUnavailableError,
  parseReviewInboxRequest,
  parseReviewInboxResponse,
  parseQuickLinksRequest,
  parseQuickLinksResponse,
  parseToolbarRequest,
  parseToolbarResponse,
} from '@/shared/messaging/protocol'
import type { MergeLensProtocolMap } from '@/shared/messaging/protocol'

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

const unsafeUrls = [
  'javascript:alert(1)',
  'data:text/plain,unsafe',
  'http://github.com/openai/codex/pull/42.diff',
]

describe('PR toolbar messaging protocol', () => {
  it('defines a typed options-page command response', () => {
    const response: ReturnType<MergeLensProtocolMap['openOptionsPage']> = {
      status: 'success',
    }

    expect(response).toEqual({ status: 'success' })
  })
  it('validates a safe toolbar request', () => {
    expect(parseToolbarRequest(request)).toEqual(request)
  })

  it('rejects malformed request data', () => {
    expect(() =>
      parseToolbarRequest({
        ...request,
        context: { ...request.context, pullNumber: 0 },
      }),
    ).toThrow('Invalid PR toolbar request')
  })

  it('validates a normalized success response', () => {
    const response = {
      status: 'success' as const,
      correlationId: 'request-1',
      data: {
        pullRequest: {
          title: 'Add toolbar',
          url: 'https://github.com/openai/codex/pull/42',
          state: 'open' as const,
          isDraft: false,
          authorLogin: 'octocat',
        },
        checks: [],
        diffUrl: 'https://github.com/openai/codex/pull/42.diff',
      },
    }

    expect(parseToolbarResponse(response)).toEqual(response)
  })

  it.each(unsafeUrls)(
    'rejects unsafe diff URL %s in toolbar responses',
    (diffUrl) => {
      expect(() =>
        parseToolbarResponse({
          status: 'success',
          correlationId: 'request-1',
          data: {
            pullRequest: {
              title: 'Add toolbar',
              url: 'https://github.com/openai/codex/pull/42',
              state: 'open',
              isDraft: false,
              authorLogin: 'octocat',
            },
            checks: [],
            diffUrl,
          },
        }),
      ).toThrow('Invalid PR toolbar response')
    },
  )

  it.each(unsafeUrls)(
    'rejects unsafe pull request URL %s in toolbar responses',
    (url) => {
      expect(() =>
        parseToolbarResponse({
          status: 'success',
          correlationId: 'request-1',
          data: {
            pullRequest: {
              title: 'Add toolbar',
              url,
              state: 'open',
              isDraft: false,
              authorLogin: 'octocat',
            },
            checks: [],
            diffUrl: 'https://github.com/openai/codex/pull/42.diff',
          },
        }),
      ).toThrow('Invalid PR toolbar response')
    },
  )

  it.each(unsafeUrls)(
    'rejects unsafe check details URL %s in toolbar responses',
    (detailsUrl) => {
      expect(() =>
        parseToolbarResponse({
          status: 'success',
          correlationId: 'request-1',
          data: {
            pullRequest: {
              title: 'Add toolbar',
              url: 'https://github.com/openai/codex/pull/42',
              state: 'open',
              isDraft: false,
              authorLogin: 'octocat',
            },
            checks: [
              {
                id: 'check-1',
                name: 'Unit tests',
                status: 'success',
                detailsUrl,
              },
            ],
            diffUrl: 'https://github.com/openai/codex/pull/42.diff',
          },
        }),
      ).toThrow('Invalid PR toolbar response')
    },
  )

  it('identifies common missing receiver errors', () => {
    expect(
      isReceiverUnavailableError(
        new Error(
          'Could not establish connection. Receiving end does not exist.',
        ),
      ),
    ).toBe(true)
    expect(
      isReceiverUnavailableError(new Error('Network request failed')),
    ).toBe(false)
  })

  it('validates quick links messages and rejects unsafe URLs', () => {
    expect(parseQuickLinksRequest(request)).toEqual(request)
    expect(
      parseQuickLinksResponse({
        status: 'success',
        correlationId: 'quick-1',
        data: { deployments: [], configuredLinks: [] },
      }),
    ).toMatchObject({ status: 'success', correlationId: 'quick-1' })
    expect(() =>
      parseQuickLinksResponse({
        status: 'success',
        correlationId: 'quick-1',
        data: {
          deployments: [],
          configuredLinks: [
            { id: 'bad', label: 'Bad', url: 'javascript:alert(1)' },
          ],
        },
      }),
    ).toThrow('Invalid quick links response')
  })

  it('validates a review inbox request and partial response', () => {
    expect(parseReviewInboxRequest({ correlationId: 'inbox-1' })).toEqual({
      correlationId: 'inbox-1',
    })

    const response = {
      status: 'success' as const,
      correlationId: 'inbox-1',
      data: {
        reviewRequests: { status: 'success' as const, items: [] },
        assigned: {
          status: 'error' as const,
          error: { code: 'rate-limited' as const, message: 'Try later' },
        },
        recentActivity: { status: 'success' as const, items: [] },
      },
    }

    expect(parseReviewInboxResponse(response)).toEqual(response)
  })

  it('rejects malformed review inbox data', () => {
    expect(() => parseReviewInboxRequest({ correlationId: '' })).toThrow(
      'Invalid review inbox request',
    )
    expect(() =>
      parseReviewInboxResponse({
        status: 'success',
        correlationId: 'inbox-1',
        data: { reviewRequests: null },
      }),
    ).toThrow('Invalid review inbox response')
  })
})
