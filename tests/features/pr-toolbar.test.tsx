import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LocalReviewController } from '@/features/local-review/types'
import { PRToolbar } from '@/features/pr-toolbar/PRToolbar'
import type { ToolbarData } from '@/shared/messaging/schemas'

const toolbarData: ToolbarData = {
  pullRequest: {
    title: 'Add resilient PR toolbar',
    url: 'https://github.com/facebook/react/pull/42',
    state: 'open',
    isDraft: false,
    authorLogin: 'octocat',
  },
  checks: [
    {
      id: '1',
      name: 'Unit tests',
      status: 'success',
      detailsUrl: 'https://github.com/facebook/react/actions/runs/1',
    },
    {
      id: '2',
      name: 'Browser tests',
      status: 'in-progress',
      detailsUrl: null,
    },
  ],
  diffUrl: 'https://github.com/facebook/react/pull/42.diff',
}

const createLocalReviewController = (): LocalReviewController => {
  const state = {
    context: {
      owner: 'facebook',
      repository: 'react',
      pullNumber: 42,
      prKey: 'facebook/react#42',
    },
    generation: 1,
    revision: 0,
    loadStatus: 'loading' as const,
    saveStatus: 'idle' as const,
    clipboardStatus: 'idle' as const,
    draft: '',
    templates: [],
    loadError: null,
    saveError: null,
    clipboardError: null,
    validationMessage: null,
  }

  return {
    getState: () => state,
    subscribe: () => () => {},
    reconcileContext: vi.fn(),
    setDraft: vi.fn(),
    insertTemplate: vi.fn(() => ({ inserted: false, cursorPosition: 0 })),
    retry: vi.fn(),
    copyDraft: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
  }
}

describe('PRToolbar', () => {
  it('keeps the Notes action available across PR data states', () => {
    const controller = createLocalReviewController()
    const onToggleLocalReview = vi.fn()
    const { rerender } = render(
      <PRToolbar
        state={{ status: 'loading' }}
        localReviewController={controller}
        onToggleLocalReview={onToggleLocalReview}
      />,
    )

    expect(screen.getByRole('button', { name: 'Notes' })).toBeVisible()

    rerender(
      <PRToolbar
        state={{
          status: 'error',
          error: { code: 'missing-token', message: 'Token required' },
        }}
        localReviewController={controller}
        onToggleLocalReview={onToggleLocalReview}
      />,
    )
    expect(screen.getByRole('button', { name: 'Notes' })).toBeVisible()

    rerender(
      <PRToolbar
        state={{ status: 'success', data: toolbarData }}
        localReviewController={controller}
        onToggleLocalReview={onToggleLocalReview}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
    expect(onToggleLocalReview).toHaveBeenCalledOnce()
  })

  it('renders the local review panel inside the toolbar when opened', () => {
    render(
      <PRToolbar
        state={{ status: 'loading' }}
        localReviewController={createLocalReviewController()}
        isLocalReviewOpen
        onToggleLocalReview={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(
      screen.getByRole('region', { name: 'Local review workspace' }),
    ).toBeVisible()
  })

  it('renders an accessible loading state', () => {
    render(<PRToolbar state={{ status: 'loading' }} />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading pull request')
  })

  it('renders normalized PR data and safe external links', () => {
    render(<PRToolbar state={{ status: 'success', data: toolbarData }} />)

    const pullRequestLink = screen.getByRole('link', {
      name: 'Add resilient PR toolbar',
    })
    const checkLink = screen.getByRole('link', { name: /Unit tests/ })
    const diffLink = screen.getByRole('link', { name: 'Diff' })

    expect(pullRequestLink).toHaveAttribute('href', toolbarData.pullRequest.url)
    expect(checkLink).toHaveAttribute('href', toolbarData.checks[0]?.detailsUrl)
    expect(diffLink).toHaveAttribute('href', toolbarData.diffUrl)
    expect(diffLink).toHaveAttribute('target', '_blank')
    expect(diffLink).toHaveAttribute('rel', 'noreferrer')
    expect(pullRequestLink).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByText('Browser tests').closest('a')).toBeNull()
  })

  it('renders configured links and deployment states with safe links', () => {
    render(
      <PRToolbar
        state={{
          status: 'success',
          quickLinksStatus: 'success',
          data: {
            ...toolbarData,
            quickLinks: {
              configuredLinks: [
                {
                  id: 'docs',
                  label: 'Project docs',
                  url: 'https://docs.example.com/',
                },
              ],
              deployments: [
                {
                  id: '7',
                  environment: 'Preview',
                  state: 'success',
                  url: 'https://preview.example.com/',
                  updatedAt: '2026-08-14T01:00:00Z',
                },
              ],
            },
          },
        }}
      />,
    )

    expect(screen.getByRole('link', { name: 'Project docs' })).toHaveAttribute(
      'rel',
      'noreferrer',
    )
    expect(
      screen.getByRole('link', { name: 'Preview: success' }),
    ).toHaveAttribute('href', 'https://preview.example.com/')
    expect(
      Array.from(
        screen
          .getByLabelText('Quick links and deployments')
          .querySelectorAll('a'),
      ).map((link) => link.getAttribute('aria-label') ?? link.textContent?.trim()),
    ).toEqual(['Diff', 'Project docs', 'Preview: success'])
  })

  it('preserves toolbar content and offers retry while deployments are unavailable', () => {
    const onRetry = vi.fn()
    render(
      <PRToolbar
        state={{
          status: 'success',
          data: toolbarData,
          quickLinksStatus: 'error',
          quickLinksError: { code: 'rate-limited', message: 'Try later' },
        }}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('link', { name: 'Diff' })).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Deployments rate limited',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders the empty checks state without treating the PR as an error', () => {
    render(
      <PRToolbar
        state={{ status: 'success', data: { ...toolbarData, checks: [] } }}
      />,
    )

    expect(screen.getByText('No checks reported')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Diff' })).toBeInTheDocument()
  })

  it('opens settings for a missing token without displaying credentials', () => {
    const onOpenSettings = vi.fn()
    render(
      <PRToolbar
        state={{
          status: 'error',
          error: {
            code: 'missing-token',
            message: 'GitHub token is not configured',
          },
        }}
        onOpenSettings={onOpenSettings}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(screen.queryByText(/github_pat_/i)).not.toBeInTheDocument()
  })

  it('renders retryable API errors and invokes retry', () => {
    const onRetry = vi.fn()
    render(
      <PRToolbar
        state={{
          status: 'error',
          error: {
            code: 'rate-limited',
            message: 'GitHub API rate limit exceeded',
            retryAfterSeconds: 30,
          },
        }}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Retry available in about 30 seconds',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders unsupported context without actions', () => {
    render(<PRToolbar state={{ status: 'unsupported-context' }} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'Pull request context unavailable',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
