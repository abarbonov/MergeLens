import {
  DEFAULT_COMMAND_SHORTCUT,
  getCommandShortcut,
} from '@/features/command-palette/shortcuts'
import { ReviewInbox } from '@/features/review-inbox/ReviewInbox'
import { useActiveRepositoryKey } from '@/features/review-inbox/useActiveRepositoryKey'
import { useReviewInboxQuery } from '@/features/review-inbox/useReviewInboxQuery'
import { useWorkspacePreferences } from '@/features/review-inbox/useWorkspacePreferences'
import { logger as rootLogger } from '@/shared/logging'
import { sendMessage } from '@/shared/messaging/protocol'
import './App.css'

const logger = rootLogger.child({ scope: "popup.app" })

const App = () => {
  const repositoryKey = useActiveRepositoryKey()
  const inboxQuery = useReviewInboxQuery()
  const workspacePreferences = useWorkspacePreferences(repositoryKey)
  const commandPaletteShortcut =
    getCommandShortcut(workspacePreferences.commandPaletteShortcut) ??
    DEFAULT_COMMAND_SHORTCUT

  const handleRefresh = () => {
    logger.info('Refreshing review inbox from popup')
    void inboxQuery.refetch()
  }

  const handleOpenSettings = () => {
    logger.info('Opening settings from review inbox')
    void sendMessage('openOptionsPage').catch((error: unknown) => {
      logger.error('Failed to open settings from review inbox', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    })
  }

  const handleOpenCommandPalette = () => {
    logger.info(
      '[FIX:command-palette-popup] Opening command palette from popup',
    )
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([activeTab]) => {
        if (activeTab?.id === undefined) {
          throw new Error('Active tab is unavailable')
        }

        await sendMessage('openCommandPalette', undefined, activeTab.id)
        window.close()
      })
      .catch((error: unknown) => {
        logger.warn(
          '[FIX:command-palette-popup] Command palette is unavailable in active tab',
          {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        )
      })
  }

  return (
    <ReviewInbox
      data={inboxQuery.data}
      error={inboxQuery.error ?? undefined}
      isLoading={inboxQuery.isPending}
      isRefreshing={inboxQuery.isRefetching}
      onRefresh={handleRefresh}
      onOpenSettings={handleOpenSettings}
      onOpenCommandPalette={handleOpenCommandPalette}
      savedFilters={workspacePreferences.savedFilters}
      savedFiltersEnabled={workspacePreferences.savedFiltersEnabled}
      activeFilterId={workspacePreferences.activeFilterId}
      isFiltersLoading={workspacePreferences.isLoading}
      hasFiltersLoadError={workspacePreferences.hasLoadError}
      onFilterChange={workspacePreferences.selectFilter}
      commandPaletteShortcutLabel={commandPaletteShortcut.label}
    />
  )
}

export default App
