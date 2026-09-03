import { z } from 'zod'
import { storage } from 'wxt/utils/storage'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "github.auth.localToken" })
const githubTokenSchema = z.string().trim().min(1)
const githubTokenItem = storage.defineItem<string | null>('local:githubToken', {
  fallback: null,
})

export const hasLocalGitHubToken = async (): Promise<boolean> => {
  const token = await githubTokenItem.getValue()
  const isConfigured =
    token !== null && githubTokenSchema.safeParse(token).success
  logger.debug('Resolved local GitHub token status', { isConfigured })
  return isConfigured
}

export const saveLocalGitHubToken = async (token: string): Promise<void> => {
  const normalizedToken = githubTokenSchema.parse(token)
  logger.info('Saving local GitHub token')
  await githubTokenItem.setValue(normalizedToken)
  logger.info('Local GitHub token saved')
}

export const clearLocalGitHubToken = async (): Promise<void> => {
  logger.info('Clearing local GitHub token')
  await githubTokenItem.removeValue()
  logger.info('Local GitHub token cleared')
}

export const readLocalGitHubToken = async (): Promise<string | null> => {
  const token = await githubTokenItem.getValue()
  const result = githubTokenSchema.safeParse(token)

  if (!result.success) {
    logger.warn('Local GitHub token is unavailable')
    return null
  }

  logger.debug('Local GitHub token loaded for background request')
  return result.data
}
