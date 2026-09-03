import { Command as CommandIcon, RefreshCw, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  ReviewInboxData,
  ReviewInboxError,
  ReviewInboxPullRequest,
  ReviewInboxSectionResult,
} from '@/modules/pull-requests'
import {
  matchesSavedInboxFilter,
  type ReviewInboxView,
  type SavedInboxFilter,
} from '@/modules/workspace-preferences'
import { logger as rootLogger } from '@/shared/logging'
import { ReviewInboxItem } from './ReviewInboxItem'
import './ReviewInbox.css'

const logger = rootLogger.child({ scope: "reviewInbox.ui" })

interface ReviewInboxProps {
  data?: ReviewInboxData
  error?: ReviewInboxError
  isLoading: boolean
  isRefreshing: boolean
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenCommandPalette: () => void
  savedFilters: SavedInboxFilter[]
  savedFiltersEnabled?: boolean
  activeFilterId: string | null
  isFiltersLoading: boolean
  hasFiltersLoadError: boolean
  onFilterChange: (filterId: string | null) => void
  commandPaletteShortcutLabel?: string
}

const VIEWS: Array<{ id: ReviewInboxView; label: string }> = [
  { id: 'reviewRequests', label: 'Review' },
  { id: 'assigned', label: 'Assigned' },
  { id: 'recentActivity', label: 'Recent' },
]

const getSectionCount = (
  section: ReviewInboxSectionResult | undefined,
  filter?: SavedInboxFilter,
  view?: ReviewInboxView,
): number => {
  if (section?.status !== 'success') return 0
  if (!filter || filter.view !== view) return section.items.length
  return section.items.filter((item) => matchesSavedInboxFilter(item, filter))
    .length
}

const getVisibleItems = (
  section: ReviewInboxSectionResult | undefined,
  filter: SavedInboxFilter | undefined,
  view: ReviewInboxView,
): ReviewInboxPullRequest[] => {
  if (section?.status !== 'success') return []
  if (!filter || filter.view !== view) return section.items
  return section.items.filter((item) => matchesSavedInboxFilter(item, filter))
}

const getErrorContent = (error: ReviewInboxError) => {
  const content: Partial<
    Record<ReviewInboxError['code'], { title: string; message: string }>
  > = {
    'invalid-response': {
      title: 'Unexpected GitHub response',
      message: 'Refresh the inbox to try again.',
    },
    'missing-token': {
      title: 'Connect GitHub',
      message: 'Add a personal access token to load your review inbox.',
    },
    'network-error': {
      title: 'GitHub is unreachable',
      message: 'Check your connection and retry.',
    },
    'rate-limited': {
      title: 'Search limit reached',
      message:
        error.retryAfterSeconds === undefined
          ? 'GitHub will allow more searches shortly.'
          : `Retry in about ${error.retryAfterSeconds} seconds.`,
    },
    'receiver-unavailable': {
      title: 'MergeLens is reconnecting',
      message: 'Reload the extension and retry.',
    },
    unauthorized: {
      title: 'Token needs attention',
      message: 'Update your GitHub token in settings.',
    },
  }

  return (
    content[error.code] ?? {
      title: 'Inbox unavailable',
      message: error.message,
    }
  )
}

const InboxSkeleton = () => {
  return (
    <div className="review-inbox__skeleton" role="status" aria-live="polite">
      <span className="review-inbox__sr-only">Loading review inbox</span>
      {[0, 1, 2].map((index) => (
        <div
          className="review-inbox__skeleton-row"
          key={index}
          aria-hidden="true"
        >
          <span />
          <strong />
          <small />
        </div>
      ))}
    </div>
  )
}

const ErrorState = ({
  error,
  onOpenSettings,
  onRetry,
}: {
  error: ReviewInboxError
  onOpenSettings: () => void
  onRetry: () => void
}) => {
  const content = getErrorContent(error)
  const requiresSettings =
    error.code === 'missing-token' || error.code === 'unauthorized'

  return (
    <div
      className="review-inbox__state review-inbox__state--error"
      role="alert"
    >
      <span className="review-inbox__state-mark" aria-hidden="true">
        !
      </span>
      <strong>{content.title}</strong>
      <p>{content.message}</p>
      <button
        className="review-inbox__command"
        type="button"
        onClick={requiresSettings ? onOpenSettings : onRetry}
      >
        {requiresSettings ? 'Open settings' : 'Retry'}
      </button>
    </div>
  )
}

export const ReviewInbox = ({
  data,
  error,
  isLoading,
  isRefreshing,
  onRefresh,
  onOpenSettings,
  onOpenCommandPalette,
  savedFilters,
  savedFiltersEnabled = true,
  activeFilterId,
  isFiltersLoading,
  hasFiltersLoadError,
  onFilterChange,
  commandPaletteShortcutLabel = 'Ctrl / Cmd K',
}: ReviewInboxProps) => {
  const [activeView, setActiveView] =
    useState<ReviewInboxView>('reviewRequests')
  const activeSection = data?.[activeView]
  const activeFilter = savedFilters.find(({ id }) => id === activeFilterId)
  const visibleItems = getVisibleItems(activeSection, activeFilter, activeView)

  useEffect(() => {
    logger.debug('Review inbox UI state changed', {
      activeView,
      isLoading,
      isRefreshing,
      activeFilterId: activeFilterId ?? undefined,
      sourceItemCount: getSectionCount(activeSection),
      visibleItemCount: visibleItems.length,
      sectionStatus: activeSection?.status,
    })
    if (activeSection?.status === 'error') {
      logger.warn('Review inbox rendered a recoverable section error', {
        activeView,
        code: activeSection.error.code,
      })
    }
  }, [
    activeFilterId,
    activeSection,
    activeView,
    isLoading,
    isRefreshing,
    visibleItems.length,
  ])

  useEffect(() => {
    if (
      activeFilterId === null ||
      isFiltersLoading ||
      activeFilter !== undefined
    ) {
      return
    }

    logger.debug('Reset unavailable active filter in review inbox', {
      filterId: activeFilterId,
      filterCount: savedFilters.length,
    })
    onFilterChange(null)
  }, [
    activeFilter,
    activeFilterId,
    isFiltersLoading,
    onFilterChange,
    savedFilters.length,
  ])

  const handleViewChange = (view: ReviewInboxView) => {
    logger.debug('Review inbox view selected', { view })
    if (activeFilter && activeFilter.view !== view) {
      logger.info('Cleared saved filter after inbox view change', {
        filterId: activeFilter.id,
        selectedView: view,
      })
      onFilterChange(null)
    }
    setActiveView(view)
  }

  const handleFilterChange = (filterId: string): void => {
    if (filterId.length === 0) {
      logger.info('Cleared saved filter from review inbox', {
        previousFilterId: activeFilterId ?? undefined,
      })
      onFilterChange(null)
      return
    }

    const filter = savedFilters.find(({ id }) => id === filterId)
    if (!filter) {
      logger.warn('Ignored unavailable saved filter in review inbox', {
        filterId,
      })
      onFilterChange(null)
      return
    }

    logger.info('Applied saved filter in review inbox', {
      filterId: filter.id,
      selectedView: filter.view,
    })
    setActiveView(filter.view)
    onFilterChange(filter.id)
  }

  return (
    <main className="review-inbox">
      <header className="review-inbox__header">
        <div>
          <span className="review-inbox__product">MergeLens</span>
          <h1>Review inbox</h1>
        </div>
        <div className="review-inbox__tools">
          <button
            className="review-inbox__icon-button"
            type="button"
            aria-label="Refresh inbox"
            title="Refresh inbox"
            onClick={onRefresh}
            disabled={isLoading || isRefreshing}
          >
            <RefreshCw
              aria-hidden="true"
              size={17}
              className={isRefreshing ? 'review-inbox__spin' : undefined}
            />
          </button>
          <button
            className="review-inbox__icon-button"
            type="button"
            aria-label="Open settings"
            title="Open settings"
            onClick={onOpenSettings}
          >
            <Settings aria-hidden="true" size={17} />
          </button>
        </div>
      </header>

      <div className="review-inbox__controls">
        <nav className="review-inbox__tabs" aria-label="Review inbox views">
          {VIEWS.map((view) => (
            <button
              className="review-inbox__tab"
              type="button"
              aria-current={activeView === view.id ? 'page' : undefined}
              onClick={() => handleViewChange(view.id)}
              key={view.id}
            >
              <span>{view.label}</span>
              <span className="review-inbox__count">
                {getSectionCount(data?.[view.id], activeFilter, view.id)}
              </span>
            </button>
          ))}
        </nav>
        {savedFiltersEnabled ? (
          <div className="review-inbox__filter-control">
            <label htmlFor="review-inbox-saved-filter">Saved filter</label>
            <select
              id="review-inbox-saved-filter"
              value={activeFilter?.id ?? ''}
              disabled={isFiltersLoading || hasFiltersLoadError}
              aria-describedby={
                hasFiltersLoadError ? 'review-inbox-filter-status' : undefined
              }
              onChange={(event) => handleFilterChange(event.target.value)}
            >
              <option value="">
                {isFiltersLoading ? 'Loading filters...' : 'All pull requests'}
              </option>
              {savedFilters.map((filter) => (
                <option value={filter.id} key={filter.id}>
                  {filter.name}
                </option>
              ))}
            </select>
            {hasFiltersLoadError ? (
              <span id="review-inbox-filter-status" role="status">
                Filters unavailable
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="review-inbox__content" aria-live="polite">
        {isLoading ? <InboxSkeleton /> : null}
        {!isLoading && error ? (
          <ErrorState
            error={error}
            onOpenSettings={onOpenSettings}
            onRetry={onRefresh}
          />
        ) : null}
        {!isLoading && !error && activeSection?.status === 'error' ? (
          <ErrorState
            error={activeSection.error}
            onOpenSettings={onOpenSettings}
            onRetry={onRefresh}
          />
        ) : null}
        {!isLoading && !error && activeSection?.status === 'success' ? (
          visibleItems.length > 0 ? (
            <div className="review-inbox__list">
              {visibleItems.map((item) => (
                <ReviewInboxItem
                  item={item}
                  key={`${item.repository.fullName}#${item.number}`}
                />
              ))}
            </div>
          ) : (
            <div className="review-inbox__state" role="status">
              <span
                className="review-inbox__state-mark review-inbox__state-mark--success"
                aria-hidden="true"
              >
                ✓
              </span>
              <strong>All clear</strong>
              <p>
                {activeFilter?.view === activeView
                  ? 'No pull requests match this filter.'
                  : 'No pull requests in this view.'}
              </p>
            </div>
          )
        ) : null}
      </section>

      <section
        className="review-inbox__palette-launcher"
        aria-label="Command palette"
      >
        <div>
          <strong>Command palette</strong>
          <span>Run GitHub actions from the current page</span>
        </div>
        <button
          className="review-inbox__palette-button"
          type="button"
          aria-label="Open command palette"
          onClick={onOpenCommandPalette}
        >
          <CommandIcon aria-hidden="true" size={15} />
          <span>Open</span>
          <kbd>{commandPaletteShortcutLabel}</kbd>
        </button>
      </section>

      <footer className="review-inbox__footer">
        <span
          className={`review-inbox__connection ${error ? 'review-inbox__connection--error' : ''}`}
        />
        <span>
          {isRefreshing ? 'Refreshing from GitHub' : 'GitHub REST API'}
        </span>
      </footer>
    </main>
  )
}
