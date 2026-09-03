import { logger as rootLogger } from '@/shared/logging'
import {
  normalizeRepositoryKey,
  normalizeRepositoryWorkspacePreferences,
} from '../domain/WorkspacePreferences'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'
import type {
  UpdateWorkspacePreferencesInput,
  WorkspacePreferenceOverridesState,
  WorkspacePreferencesResult,
} from './contracts'
import {
  getWorkspacePreferencesErrorName,
  isExpectedWorkspacePreferencesError,
  toWorkspacePreferencesError,
} from './operation'

const logger = rootLogger.child({ scope: "workspacePreferences.updateWorkspacePreferences" })

export const createUpdateWorkspacePreferences =
  (repository: WorkspacePreferencesRepository) =>
  async (
    input: UpdateWorkspacePreferencesInput,
  ): Promise<WorkspacePreferencesResult<WorkspacePreferenceOverridesState>> => {
    logger.debug('Updating workspace preference overrides', {
      kind: input.kind,
    })
    try {
      let globalPreferences
      let repositoryPreferences

      if (input.kind === 'global') {
        ;[globalPreferences, repositoryPreferences] = await Promise.all([
          repository.saveGlobalPreferences(input.preferences),
          repository.listRepositoryPreferences(),
        ])
        logger.info('Updated global workspace preferences', {
          savedFiltersEnabled: globalPreferences.featureFlags?.savedFilters,
          customShortcutEnabled:
            globalPreferences.featureFlags?.customCommandPaletteShortcut,
          hasShortcut: globalPreferences.commandPaletteShortcut !== undefined,
        })
      } else if (input.kind === 'repository-upsert') {
        const preferences = normalizeRepositoryWorkspacePreferences(
          input.preferences,
        )
        ;[globalPreferences, repositoryPreferences] = await Promise.all([
          repository.getGlobalPreferences(),
          repository.upsertRepositoryPreferences(preferences),
        ])
        logger.info('Upserted repository workspace preferences', {
          repositoryKey: preferences.repositoryKey,
          repositoryCount: repositoryPreferences.length,
        })
      } else {
        const repositoryKey = normalizeRepositoryKey(input.repositoryKey)
        ;[globalPreferences, repositoryPreferences] = await Promise.all([
          repository.getGlobalPreferences(),
          repository.deleteRepositoryPreferences(repositoryKey),
        ])
        logger.info('Deleted repository workspace preferences', {
          repositoryKey,
          repositoryCount: repositoryPreferences.length,
        })
      }

      return {
        status: 'success',
        data: { globalPreferences, repositoryPreferences },
      }
    } catch (error) {
      const mappedError = toWorkspacePreferencesError(error)
      const log = isExpectedWorkspacePreferencesError(error)
        ? logger.warn
        : logger.error
      log('Failed to update workspace preference overrides', {
        kind: input.kind,
        code: mappedError.code,
        errorName: getWorkspacePreferencesErrorName(error),
      })
      return { status: 'error', error: mappedError }
    }
  }
