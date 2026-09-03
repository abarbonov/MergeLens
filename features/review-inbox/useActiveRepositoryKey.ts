import { useEffect, useState } from 'react'
import { createCommandContext } from '@/features/command-palette/commands/context'
import { createRepositoryKey } from '@/modules/workspace-preferences'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "reviewInbox.activeRepository" })

export const useActiveRepositoryKey = (): string | null => {
  const [repositoryKey, setRepositoryKey] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([activeTab]) => {
        if (!isCurrent) return
        const context = activeTab?.url
          ? createCommandContext(activeTab.url)
          : null
        const nextRepositoryKey = context?.repositoryContext
          ? createRepositoryKey(context.repositoryContext)
          : null
        setRepositoryKey(nextRepositoryKey)
        logger.debug('Resolved popup workspace context', {
          hasRepositoryContext: nextRepositoryKey !== null,
        })
      })
      .catch((error: unknown) => {
        if (!isCurrent) return
        setRepositoryKey(null)
        logger.warn('Using global popup workspace preferences', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      })

    return () => {
      isCurrent = false
    }
  }, [])

  return repositoryKey
}
