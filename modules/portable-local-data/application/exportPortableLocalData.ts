import type { LocalReviewRepository } from '@/modules/local-review'
import type { ReviewNotificationStateRepository } from '@/modules/review-notifications'
import type { WorkspacePreferencesRepository } from '@/modules/workspace-preferences'
import { logger as rootLogger } from '@/shared/logging'
import {
  PORTABLE_LOCAL_DATA_FORMAT,
  PORTABLE_LOCAL_DATA_SCHEMA_VERSION,
  parsePortableLocalData,
  type PortableLocalData,
} from '../domain/PortableLocalData'
import type {
  ExportPortableLocalDataResult,
  PortableLocalDataCounts,
} from './contracts'

const logger = rootLogger.child({ scope: "portableLocalData.export" })

export interface ExportPortableLocalDataDependencies {
  localReviewRepository: LocalReviewRepository
  workspacePreferencesRepository: WorkspacePreferencesRepository
  reviewNotificationRepository: ReviewNotificationStateRepository
  now?: () => Date
}

const emptyCounts = (): PortableLocalDataCounts => ({
  notes: 0,
  reviewTemplates: 0,
  savedFilters: 0,
  globalWorkspacePreferences: 0,
  repositoryWorkspacePreferences: 0,
  reviewNotificationPreferences: 0,
})

const getErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : 'UnknownError'

const toExportError = (
  error: unknown,
  failedCategory?: keyof PortableLocalDataCounts,
) => ({
  code: 'storage-unavailable' as const,
  message: 'Portable local data could not be read from local storage',
  failedCategory,
})

const createExportedAt = (now: () => Date): string => {
  const value = now()
  if (Number.isNaN(value.getTime())) {
    throw new Error('Export clock returned an invalid date')
  }
  return value.toISOString()
}

const serializePortableLocalData = (data: PortableLocalData): string => {
  try {
    return JSON.stringify(data, null, 2)
  } catch (error) {
    logger.error('Portable local data serialization failed', {
      errorName: getErrorName(error),
    })
    throw error
  }
}

export const createExportPortableLocalData = ({
  localReviewRepository,
  workspacePreferencesRepository,
  reviewNotificationRepository,
  now = () => new Date(),
}: ExportPortableLocalDataDependencies) => {
  return async (): Promise<ExportPortableLocalDataResult> => {
    const counts = emptyCounts()
    logger.debug('Starting portable local data export', {
      schemaVersion: PORTABLE_LOCAL_DATA_SCHEMA_VERSION,
    })

    let notes
    let reviewTemplates
    let savedFilters
    let globalWorkspacePreferences
    let repositoryWorkspacePreferences
    let reviewNotificationPreferences

    try {
      notes = await localReviewRepository.listNotes()
      counts.notes = notes.length
      reviewTemplates = await localReviewRepository.listTemplates()
      counts.reviewTemplates = reviewTemplates.length
    } catch (error) {
      logger.error(
        'Portable local data export failed while reading local review',
        {
          errorName: getErrorName(error),
        },
      )
      return { status: 'error', error: toExportError(error, 'notes') }
    }

    try {
      savedFilters = await workspacePreferencesRepository.listSavedFilters()
      counts.savedFilters = savedFilters.length
      globalWorkspacePreferences =
        await workspacePreferencesRepository.getGlobalPreferences()
      counts.globalWorkspacePreferences = 1
      repositoryWorkspacePreferences =
        await workspacePreferencesRepository.listRepositoryPreferences()
      counts.repositoryWorkspacePreferences =
        repositoryWorkspacePreferences.length
    } catch (error) {
      logger.error(
        'Portable local data export failed while reading workspace preferences',
        {
          errorName: getErrorName(error),
        },
      )
      return {
        status: 'error',
        error: toExportError(error, 'savedFilters'),
      }
    }

    try {
      reviewNotificationPreferences =
        await reviewNotificationRepository.getPreferences()
      counts.reviewNotificationPreferences = 1
    } catch (error) {
      logger.error(
        'Portable local data export failed while reading notification preferences',
        {
          errorName: getErrorName(error),
        },
      )
      return {
        status: 'error',
        error: toExportError(error, 'reviewNotificationPreferences'),
      }
    }

    try {
      const data = parsePortableLocalData({
        format: PORTABLE_LOCAL_DATA_FORMAT,
        schemaVersion: PORTABLE_LOCAL_DATA_SCHEMA_VERSION,
        exportedAt: createExportedAt(now),
        data: {
          notes,
          reviewTemplates,
          savedFilters,
          globalWorkspacePreferences,
          repositoryWorkspacePreferences,
          reviewNotificationPreferences,
        },
      })
      const serializedData = serializePortableLocalData(data)
      const byteLength = new TextEncoder().encode(serializedData).byteLength

      logger.info('Portable local data export completed', {
        schemaVersion: data.schemaVersion,
        byteLength,
        noteCount: counts.notes,
        templateCount: counts.reviewTemplates,
        savedFilterCount: counts.savedFilters,
        repositoryPreferenceCount: counts.repositoryWorkspacePreferences,
      })
      return { status: 'success', data, serializedData, counts, byteLength }
    } catch (error) {
      const errorName = getErrorName(error)
      logger.error('Portable local data export failed while building payload', {
        errorName,
      })
      return {
        status: 'error',
        error: {
          code: 'serialization-failed',
          message: 'Portable local data could not be serialized',
        },
      }
    }
  }
}
