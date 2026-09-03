import { logger as rootLogger } from '@/shared/logging'
import type { SavedInboxFilter } from '../domain/WorkspacePreferences'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'
import type { WorkspacePreferencesResult } from './contracts'
import {
  getWorkspacePreferencesErrorName,
  isExpectedWorkspacePreferencesError,
  toWorkspacePreferencesError,
} from './operation'

const logger = rootLogger.child({ scope: "workspacePreferences.listSavedFilters" })

export const createListSavedFilters =
  (repository: WorkspacePreferencesRepository) =>
  async (): Promise<WorkspacePreferencesResult<SavedInboxFilter[]>> => {
    logger.debug('Listing saved inbox filters')
    try {
      const filters = await repository.listSavedFilters()
      logger.debug('Listed saved inbox filters', {
        filterCount: filters.length,
      })
      return { status: 'success', data: filters }
    } catch (error) {
      const mappedError = toWorkspacePreferencesError(error)
      const log = isExpectedWorkspacePreferencesError(error)
        ? logger.warn
        : logger.error
      log('Failed to list saved inbox filters', {
        code: mappedError.code,
        errorName: getWorkspacePreferencesErrorName(error),
      })
      return { status: 'error', error: mappedError }
    }
  }
