import { logger as rootLogger } from '@/shared/logging'
import type { SavedInboxFilter } from '../domain/WorkspacePreferences'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'
import type {
  DeleteSavedInboxFilterInput,
  WorkspacePreferencesResult,
} from './contracts'
import {
  deleteSavedInboxFilter,
  getWorkspacePreferencesErrorName,
  isExpectedWorkspacePreferencesError,
  toWorkspacePreferencesError,
} from './operation'

const logger = rootLogger.child({ scope: "workspacePreferences.deleteSavedFilter" })

export const createDeleteSavedFilter =
  (repository: WorkspacePreferencesRepository) =>
  async ({
    filterId,
  }: DeleteSavedInboxFilterInput): Promise<
    WorkspacePreferencesResult<SavedInboxFilter[]>
  > => {
    logger.debug('Deleting saved inbox filter', { filterId })
    try {
      const current = await repository.listSavedFilters()
      deleteSavedInboxFilter(current, filterId)
      const filters = await repository.deleteSavedFilter(filterId)
      logger.info('Deleted saved inbox filter', {
        filterId,
        filterCount: filters.length,
      })
      return { status: 'success', data: filters }
    } catch (error) {
      const mappedError = toWorkspacePreferencesError(error)
      const log = isExpectedWorkspacePreferencesError(error)
        ? logger.warn
        : logger.error
      log('Failed to delete saved inbox filter', {
        filterId,
        code: mappedError.code,
        errorName: getWorkspacePreferencesErrorName(error),
      })
      return { status: 'error', error: mappedError }
    }
  }
