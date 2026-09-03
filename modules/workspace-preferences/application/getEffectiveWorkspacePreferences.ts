import {
  DEFAULT_WORKSPACE_PREFERENCES,
  normalizeRepositoryKey,
  resolveEffectiveWorkspacePreferences,
  type EffectiveWorkspacePreferences,
} from '../domain/WorkspacePreferences'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'
import {
  getWorkspacePreferencesErrorName,
  isExpectedWorkspacePreferencesError,
  toWorkspacePreferencesError,
} from './operation'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "workspacePreferences.getEffective" })

export interface EffectiveWorkspacePreferencesSnapshot {
  preferences: EffectiveWorkspacePreferences
  repositoryKey: string | null
  source: 'default' | 'global' | 'repository'
}

export const createGetEffectiveWorkspacePreferences =
  (repository: WorkspacePreferencesRepository) =>
  async (
    repositoryKey?: string | null,
  ): Promise<EffectiveWorkspacePreferencesSnapshot> => {
    let normalizedRepositoryKey: string | null = null
    if (repositoryKey) {
      try {
        normalizedRepositoryKey = normalizeRepositoryKey(repositoryKey)
      } catch (error) {
        logger.warn(
          'Using default workspace preferences after malformed context',
          {
            errorName: getWorkspacePreferencesErrorName(error),
          },
        )
      }
    }

    logger.debug('Resolving effective workspace preferences', {
      hasRepositoryContext: normalizedRepositoryKey !== null,
      repositoryKey: normalizedRepositoryKey ?? undefined,
    })

    try {
      const [globalPreferences, repositoryPreferences] = await Promise.all([
        repository.getGlobalPreferences(),
        normalizedRepositoryKey
          ? repository.getRepositoryPreferences(normalizedRepositoryKey)
          : Promise.resolve(null),
      ])
      const preferences = resolveEffectiveWorkspacePreferences(
        globalPreferences,
        repositoryPreferences ?? undefined,
      )
      const source = repositoryPreferences
        ? 'repository'
        : Object.keys(globalPreferences).length > 0
          ? 'global'
          : 'default'
      logger.debug('Resolved workspace preference snapshot', {
        repositoryKey: normalizedRepositoryKey ?? undefined,
        source,
        featureFlagCount: Object.keys(preferences.featureFlags).length,
      })
      return { preferences, repositoryKey: normalizedRepositoryKey, source }
    } catch (error) {
      const mapped = toWorkspacePreferencesError(error)
      const log = isExpectedWorkspacePreferencesError(error)
        ? logger.warn
        : logger.error
      log('Using default workspace preferences after load failure', {
        code: mapped.code,
        errorName: getWorkspacePreferencesErrorName(error),
      })
      return {
        preferences: DEFAULT_WORKSPACE_PREFERENCES,
        repositoryKey: normalizedRepositoryKey,
        source: 'default',
      }
    }
  }
