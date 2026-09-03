import { logger as rootLogger } from '@/shared/logging'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'
import type {
  WorkspacePreferencesResult,
  WorkspacePreferencesState,
} from './contracts'
import {
  getWorkspacePreferencesErrorName,
  isExpectedWorkspacePreferencesError,
  toWorkspacePreferencesError,
} from './operation'

const logger = rootLogger.child({ scope: "workspacePreferences.getWorkspacePreferences" })

export const createGetWorkspacePreferences =
  (repository: WorkspacePreferencesRepository) =>
  async (): Promise<WorkspacePreferencesResult<WorkspacePreferencesState>> => {
    logger.debug('Loading workspace preferences state')
    try {
      const [savedFilters, globalPreferences, repositoryPreferences] =
        await Promise.all([
          repository.listSavedFilters(),
          repository.getGlobalPreferences(),
          repository.listRepositoryPreferences(),
        ])
      logger.debug('Loaded workspace preferences state', {
        filterCount: savedFilters.length,
        repositoryCount: repositoryPreferences.length,
        featureFlagCount: Object.keys(globalPreferences.featureFlags ?? {})
          .length,
        hasShortcut: globalPreferences.commandPaletteShortcut !== undefined,
      })
      return {
        status: 'success',
        data: { savedFilters, globalPreferences, repositoryPreferences },
      }
    } catch (error) {
      const mappedError = toWorkspacePreferencesError(error)
      const log = isExpectedWorkspacePreferencesError(error)
        ? logger.warn
        : logger.error
      log('Failed to load workspace preferences state', {
        code: mappedError.code,
        errorName: getWorkspacePreferencesErrorName(error),
      })
      return { status: 'error', error: mappedError }
    }
  }
