import { describe, expect, it, vi } from 'vitest'
import type { LocalReviewController } from '@/features/local-review/types'
import { mountPrToolbar } from '@/features/pr-toolbar/mountPrToolbar'
import type { PRToolbarState } from '@/features/pr-toolbar/types'
import type { PullRequestPageContext } from '@/shared/github/context/PageContext'

const context: PullRequestPageContext = {
  kind: 'pull-request',
  owner: 'facebook',
  repository: 'react',
  pullNumber: 42,
  url: 'https://github.com/facebook/react/pull/42',
}

const nextContext: PullRequestPageContext = {
  ...context,
  pullNumber: 43,
  url: 'https://github.com/facebook/react/pull/43',
}

const successResponse = {
  status: 'success' as const,
  correlationId: 'request-1',
  data: {
    pullRequest: {
      title: 'React toolbar',
      url: context.url,
      state: 'open' as const,
      isDraft: false,
      authorLogin: 'sebmarkbage',
    },
    checks: [],
    diffUrl: 'https://github.com/facebook/react/pull/42.diff',
  },
}

const quickLinksResponse = {
  status: 'success' as const,
  correlationId: 'quick-1',
  data: {
    deployments: [],
    configuredLinks: [
      { id: 'docs', label: 'Docs', url: 'https://docs.example.com/' },
    ],
  },
}

const createFakeContext = () => {
  let invalidationHandler: (() => void) | undefined
  return {
    context: {
      onInvalidated: vi.fn((handler: () => void) => {
        invalidationHandler = handler
      }),
    },
    invalidate: () => invalidationHandler?.(),
  }
}

const createFakeUi = () => ({
  autoMount: vi.fn(),
  remove: vi.fn(),
  render: vi.fn<(state: PRToolbarState) => void>(),
})

const createFakeReviewController = (): LocalReviewController => ({
  getState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  reconcileContext: vi.fn(),
  setDraft: vi.fn(),
  insertTemplate: vi.fn(() => ({ inserted: false, cursorPosition: 0 })),
  retry: vi.fn(),
  copyDraft: vi.fn().mockResolvedValue(undefined),
  flush: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn().mockResolvedValue(undefined),
})

describe('mountPrToolbar', () => {
  it('starts local review independently while toolbar data is still pending', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const reviewController = createFakeReviewController()
    const createReviewController = vi.fn(() => reviewController)
    let resolveToolbarRequest:
      ((value: typeof successResponse) => void) | undefined
    const toolbarRequest = new Promise<typeof successResponse>((resolve) => {
      resolveToolbarRequest = resolve
    })
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      createReviewController,
      sendToolbarMessage: vi.fn().mockReturnValue(toolbarRequest),
      findAnchor: () => document.body,
    })

    const reconciliation = toolbar.reconcile(context)
    await vi.waitFor(() => {
      expect(createReviewController).toHaveBeenCalledWith(context)
    })
    await vi.waitFor(() => {
      expect(fakeUi.render).toHaveBeenCalledWith({ status: 'loading' })
    })

    resolveToolbarRequest?.(successResponse)
    await reconciliation
  })

  it('preserves local review for the same PR and reconciles a different PR', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const reviewController = createFakeReviewController()
    const createReviewController = vi.fn(() => reviewController)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      createReviewController,
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.reconcile({ ...context, url: `${context.url}/files` })
    await toolbar.reconcile(nextContext)

    expect(createReviewController).toHaveBeenCalledOnce()
    expect(reviewController.reconcileContext).toHaveBeenCalledOnce()
    expect(reviewController.reconcileContext).toHaveBeenCalledWith(nextContext)
    expect(fakeUi.remove).not.toHaveBeenCalled()
  })

  it('opens local review through the public toolbar action and ignores duplicates', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    let isLocalReviewOpen: (() => boolean) | undefined
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: async (_ctx, callbacks) => {
        isLocalReviewOpen = callbacks.isLocalReviewOpen
        return fakeUi
      },
      createReviewController: () => createFakeReviewController(),
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.openLocalReviewWorkspace()
    const renderCountAfterOpen = fakeUi.render.mock.calls.length
    await toolbar.openLocalReviewWorkspace()

    expect(isLocalReviewOpen?.()).toBe(true)
    expect(fakeUi.render).toHaveBeenCalledTimes(renderCountAfterOpen)
  })

  it('disposes local review when leaving pull request context', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const reviewController = createFakeReviewController()
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      createReviewController: () => reviewController,
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.reconcile(null)

    expect(reviewController.dispose).toHaveBeenCalledOnce()
    expect(fakeUi.remove).toHaveBeenCalledOnce()
  })

  it('mounts once and ignores duplicate reconciliation for the same PR', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const createUi = vi.fn().mockResolvedValue(fakeUi)
    const sendToolbarMessage = vi.fn().mockResolvedValue(successResponse)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi,
      sendToolbarMessage,
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.reconcile({ ...context, url: `${context.url}/files` })

    expect(createUi).toHaveBeenCalledOnce()
    expect(fakeUi.autoMount).toHaveBeenCalledOnce()
    expect(sendToolbarMessage).toHaveBeenCalledOnce()
    expect(fakeUi.render).toHaveBeenLastCalledWith({
      status: 'success',
      data: successResponse.data,
    })
  })

  it('merges quick links after the primary toolbar response', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const sendQuickLinksMessage = vi.fn().mockResolvedValue(quickLinksResponse)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      sendQuickLinksMessage,
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)

    expect(sendQuickLinksMessage).toHaveBeenCalledWith(
      'getPullRequestQuickLinks',
      expect.objectContaining({ context }),
    )
    expect(fakeUi.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'success',
        quickLinksStatus: 'success',
        data: expect.objectContaining({ quickLinks: quickLinksResponse.data }),
      }),
    )
  })

  it('preserves primary toolbar data when quick links fail', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      sendQuickLinksMessage: vi.fn().mockResolvedValue({
        status: 'error',
        correlationId: 'quick-1',
        error: { code: 'rate-limited', message: 'Try later' },
      }),
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)

    expect(fakeUi.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'success',
        data: successResponse.data,
        quickLinksStatus: 'error',
        quickLinksError: expect.objectContaining({ code: 'rate-limited' }),
      }),
    )
  })

  it('ignores a stale quick links failure after navigating to another PR', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    let rejectFirstQuickLinksRequest: ((reason: Error) => void) | undefined
    const firstQuickLinksRequest = new Promise<never>((_resolve, reject) => {
      rejectFirstQuickLinksRequest = reject
    })
    const sendToolbarMessage = vi
      .fn()
      .mockResolvedValueOnce(successResponse)
      .mockResolvedValueOnce({
        ...successResponse,
        data: {
          ...successResponse.data,
          pullRequest: {
            ...successResponse.data.pullRequest,
            title: 'New pull request',
            url: nextContext.url,
          },
        },
      })
    const sendQuickLinksMessage = vi
      .fn()
      .mockReturnValueOnce(firstQuickLinksRequest)
      .mockResolvedValueOnce(quickLinksResponse)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage,
      sendQuickLinksMessage,
      findAnchor: () => document.body,
    })

    const firstReconciliation = toolbar.reconcile(context)
    await vi.waitFor(() => expect(sendQuickLinksMessage).toHaveBeenCalledOnce())
    await toolbar.reconcile(nextContext)
    rejectFirstQuickLinksRequest?.(new Error('stale request failed'))
    await firstReconciliation

    expect(fakeUi.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'success',
        quickLinksStatus: 'success',
        data: expect.objectContaining({
          pullRequest: expect.objectContaining({ title: 'New pull request' }),
        }),
      }),
    )
  })

  it('reuses the UI and reloads data when navigating to another PR', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const sendToolbarMessage = vi.fn().mockResolvedValue(successResponse)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage,
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.reconcile(nextContext)

    expect(fakeUi.autoMount).toHaveBeenCalledOnce()
    expect(sendToolbarMessage).toHaveBeenCalledTimes(2)
    expect(fakeUi.remove).not.toHaveBeenCalled()
  })

  it('creates only one UI during concurrent reconciliations', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    let resolveUi: ((value: typeof fakeUi) => void) | undefined
    const pendingUi = new Promise<typeof fakeUi>((resolve) => {
      resolveUi = resolve
    })
    const createUi = vi.fn().mockReturnValue(pendingUi)
    const sendToolbarMessage = vi.fn().mockResolvedValue(successResponse)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi,
      sendToolbarMessage,
      findAnchor: () => document.body,
    })

    const firstReconciliation = toolbar.reconcile(context)
    const secondReconciliation = toolbar.reconcile(nextContext)
    resolveUi?.(fakeUi)
    await Promise.all([firstReconciliation, secondReconciliation])

    expect(createUi).toHaveBeenCalledOnce()
    expect(fakeUi.autoMount).toHaveBeenCalledOnce()
    expect(sendToolbarMessage).toHaveBeenCalledOnce()
    expect(sendToolbarMessage).toHaveBeenCalledWith(
      'getPullRequestToolbarData',
      expect.objectContaining({ context: nextContext }),
    )
  })

  it('removes on non-PR navigation and creates a clean UI when returning', async () => {
    const fakeContext = createFakeContext()
    const firstUi = createFakeUi()
    const secondUi = createFakeUi()
    const createUi = vi
      .fn()
      .mockResolvedValueOnce(firstUi)
      .mockResolvedValueOnce(secondUi)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi,
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.reconcile(null)
    await toolbar.reconcile(context)

    expect(firstUi.remove).toHaveBeenCalledOnce()
    expect(secondUi.autoMount).toHaveBeenCalledOnce()
    expect(createUi).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale response after navigating to another PR', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    let resolveFirstRequest:
      ((value: typeof successResponse) => void) | undefined
    const firstRequest = new Promise<typeof successResponse>((resolve) => {
      resolveFirstRequest = resolve
    })
    const sendToolbarMessage = vi
      .fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({
        ...successResponse,
        data: {
          ...successResponse.data,
          pullRequest: {
            ...successResponse.data.pullRequest,
            title: 'New pull request',
            url: nextContext.url,
          },
        },
      })
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage,
      findAnchor: () => document.body,
    })

    const firstReconciliation = toolbar.reconcile(context)
    await vi.waitFor(() => expect(sendToolbarMessage).toHaveBeenCalledOnce())
    await toolbar.reconcile(nextContext)
    resolveFirstRequest?.(successResponse)
    await firstReconciliation

    expect(fakeUi.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({
          pullRequest: expect.objectContaining({ title: 'New pull request' }),
        }),
      }),
    )
  })

  it('renders a retryable state when the background receiver is unavailable', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage: vi
        .fn()
        .mockRejectedValue(new Error('Receiving end does not exist')),
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)

    expect(fakeUi.render).toHaveBeenLastCalledWith({
      status: 'error',
      error: {
        code: 'receiver-unavailable',
        message: 'MergeLens background is unavailable',
      },
    })
  })

  it('starts dynamic anchor observation when the GitHub anchor is absent', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage: vi.fn().mockResolvedValue(successResponse),
      findAnchor: () => null,
    })

    await toolbar.reconcile(context)

    expect(fakeUi.autoMount).toHaveBeenCalledOnce()
  })

  it('refreshes toolbar data for the current PR on external request', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    const sendToolbarMessage = vi.fn().mockResolvedValue(successResponse)
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage,
      findAnchor: () => document.body,
    })

    await toolbar.reconcile(context)
    await toolbar.refresh()

    expect(sendToolbarMessage).toHaveBeenCalledTimes(2)
  })

  it('removes the UI and invalidates pending requests on context invalidation', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    let resolveRequest: ((value: typeof successResponse) => void) | undefined
    const request = new Promise<typeof successResponse>((resolve) => {
      resolveRequest = resolve
    })
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockResolvedValue(fakeUi),
      sendToolbarMessage: vi.fn().mockReturnValue(request),
      findAnchor: () => document.body,
    })

    const reconciliation = toolbar.reconcile(context)
    await vi.waitFor(() => expect(fakeUi.autoMount).toHaveBeenCalledOnce())
    fakeContext.invalidate()
    resolveRequest?.(successResponse)
    await reconciliation

    expect(fakeUi.remove).toHaveBeenCalledOnce()
    expect(fakeUi.render).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
    )
  })

  it('discards an UI that finishes creating after leaving the PR', async () => {
    const fakeContext = createFakeContext()
    const fakeUi = createFakeUi()
    let resolveUi: ((value: typeof fakeUi) => void) | undefined
    const pendingUi = new Promise<typeof fakeUi>((resolve) => {
      resolveUi = resolve
    })
    const sendToolbarMessage = vi.fn()
    const toolbar = await mountPrToolbar(fakeContext.context as never, {
      createUi: vi.fn().mockReturnValue(pendingUi),
      sendToolbarMessage,
      findAnchor: () => document.body,
    })

    const reconciliation = toolbar.reconcile(context)
    await toolbar.reconcile(null)
    resolveUi?.(fakeUi)
    await reconciliation

    expect(fakeUi.remove).toHaveBeenCalledOnce()
    expect(fakeUi.autoMount).not.toHaveBeenCalled()
    expect(sendToolbarMessage).not.toHaveBeenCalled()
  })
})
