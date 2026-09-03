import { logger as rootLogger } from '@/shared/logging'
import type { SavedInboxFilter } from '../domain/WorkspacePreferences'
import { WorkspacePreferencesValidationError } from '../domain/WorkspacePreferences'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'
import type {
  UpsertSavedInboxFilterInput,
  WorkspacePreferencesResult,
  WorkspacePreferencesUseCaseDependencies,
} from './contracts'
import {
  getWorkspacePreferencesErrorName,
  isExpectedWorkspacePreferencesError,
  toWorkspacePreferencesError,
  upsertSavedInboxFilter,
} from './operation'

const logger = rootLogger.child({ scope: "workspacePreferences.upsertSavedFilter" })

const createDefaultId = (): string => crypto.randomUUID()

export const createUpsertSavedFilter = (
  repository: WorkspacePreferencesRepository,
  dependencies: WorkspacePreferencesUseCaseDependencies = {},
) => {
  const createId = dependencies.createId ?? createDefaultId

  return async ({
    filter,
  }: UpsertSavedInboxFilterInput): Promise<
    WorkspacePreferencesResult<{
      filter: SavedInboxFilter
      filters: SavedInboxFilter[]
    }>
  > => {
    logger.debug('Upserting saved inbox filter', {
      filterId: filter.id,
      isEditing: filter.id !== undefined,
      repositoryCount: filter.criteria.repositories.length,
      authorCount: filter.criteria.authors.length,
    })
    try {
      const current = await repository.listSavedFilters()
      const filterId = filter.id ?? createId()
      if (
        filter.id === undefined &&
        current.some(({ id }) => id === filterId.trim())
      ) {
        throw new WorkspacePreferencesValidationError(
          'Generated filter ID must be unique',
          'id',
        )
      }
      const next = upsertSavedInboxFilter(
        current,
        { ...filter, id: filterId },
        createId,
      )
      const savedFilter = next.find(({ id }) => id === filterId.trim())
      if (!savedFilter) {
        throw new Error('Saved filter upsert did not produce a filter')
      }
      const filters = await repository.upsertSavedFilter(savedFilter)
      logger.info('Upserted saved inbox filter', {
        filterId: savedFilter.id,
        isEditing: filter.id !== undefined,
        filterCount: filters.length,
      })
      return { status: 'success', data: { filter: savedFilter, filters } }
    } catch (error) {
      const mappedError = toWorkspacePreferencesError(error)
      const log = isExpectedWorkspacePreferencesError(error)
        ? logger.warn
        : logger.error
      log('Failed to upsert saved inbox filter', {
        filterId: filter.id,
        code: mappedError.code,
        errorName: getWorkspacePreferencesErrorName(error),
      })
      return { status: 'error', error: mappedError }
    }
  }
}
