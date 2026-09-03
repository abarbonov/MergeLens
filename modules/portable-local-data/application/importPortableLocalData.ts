import type { LocalReviewRepository } from '@/modules/local-review'
import type { ReviewNotificationStateRepository } from '@/modules/review-notifications'
import type { WorkspacePreferencesRepository } from '@/modules/workspace-preferences'
import { logger as rootLogger } from '@/shared/logging'
import {
  getPortableDataConflictKey,
  parsePortableLocalData,
  type PortableDataConflictCategory,
  type PortableDataConflictDecisions,
  type PortableLocalData,
} from '../domain/PortableLocalData'
import type {
  ApplyPortableLocalDataImportInput,
  ApplyPortableLocalDataImportResult,
  PortableLocalDataCounts,
  PortableLocalDataError,
  PortableLocalDataImportPreview,
  PreviewPortableLocalDataImportResult,
} from './contracts'

const logger = rootLogger.child({ scope: "portableLocalData.import" })

export interface ImportPortableLocalDataDependencies {
  localReviewRepository: LocalReviewRepository
  workspacePreferencesRepository: WorkspacePreferencesRepository
  reviewNotificationRepository: ReviewNotificationStateRepository
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

const toStorageError = (
  error: unknown,
  failedCategory?: keyof PortableLocalDataCounts,
): PortableLocalDataError => {
  const candidate = error as { code?: unknown; message?: unknown }
  const code = candidate.code
  const mappedCode =
    code === 'quota-exceeded' || code === 'storage-unavailable'
      ? code
      : 'storage-unavailable'
  return {
    code: mappedCode,
    message:
      typeof candidate.message === 'string'
        ? candidate.message
        : 'Portable local data storage operation failed',
    failedCategory,
  }
}

const valuesEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const increment = (
  counts: PortableLocalDataCounts,
  category: keyof PortableLocalDataCounts,
): void => {
  counts[category] += 1
}

const categoryKeys = (
  category: PortableDataConflictCategory,
  data: PortableLocalData,
): string[] => {
  switch (category) {
    case 'notes':
      return data.data.notes.map(
        (record) => getPortableDataConflictKey(category, record).key,
      )
    case 'reviewTemplates':
      return data.data.reviewTemplates.map(
        (record) => getPortableDataConflictKey(category, record).key,
      )
    case 'savedFilters':
      return data.data.savedFilters.map(
        (record) => getPortableDataConflictKey(category, record).key,
      )
    case 'repositoryWorkspacePreferences':
      return data.data.repositoryWorkspacePreferences.map(
        (record) => getPortableDataConflictKey(category, record).key,
      )
    case 'globalWorkspacePreferences':
    case 'reviewNotificationPreferences':
      return ['singleton']
  }
}

const createConflictSet = (
  category: PortableDataConflictCategory,
  keys: readonly string[],
) => new Set(keys.map((key) => `${category}:${key}`))

const createPreview = async (
  input: unknown,
  dependencies: ImportPortableLocalDataDependencies,
): Promise<PortableLocalDataImportPreview> => {
  const data = parsePortableLocalData(
    typeof input === 'string' ? JSON.parse(input) : input,
  )
  const [
    existingNotes,
    existingTemplates,
    existingFilters,
    existingGlobal,
    existingRepositories,
    existingNotifications,
  ] = await Promise.all([
    dependencies.localReviewRepository.listNotes(),
    dependencies.localReviewRepository.listTemplates(),
    dependencies.workspacePreferencesRepository.listSavedFilters(),
    dependencies.workspacePreferencesRepository.getGlobalPreferences(),
    dependencies.workspacePreferencesRepository.listRepositoryPreferences(),
    dependencies.reviewNotificationRepository.getPreferences(),
  ])

  const existing = {
    notes: createConflictSet(
      'notes',
      existingNotes.map((record) => record.prKey),
    ),
    reviewTemplates: createConflictSet(
      'reviewTemplates',
      existingTemplates.map((record) => record.id),
    ),
    savedFilters: createConflictSet(
      'savedFilters',
      existingFilters.map((record) => record.id),
    ),
    repositoryWorkspacePreferences: createConflictSet(
      'repositoryWorkspacePreferences',
      existingRepositories.map((record) => record.repositoryKey),
    ),
    globalWorkspacePreferences: valuesEqual(
      existingGlobal,
      data.data.globalWorkspacePreferences,
    )
      ? new Set<string>()
      : createConflictSet('globalWorkspacePreferences', ['singleton']),
    reviewNotificationPreferences: valuesEqual(
      existingNotifications,
      data.data.reviewNotificationPreferences,
    )
      ? new Set<string>()
      : createConflictSet('reviewNotificationPreferences', ['singleton']),
  }
  const additions = emptyCounts()
  const conflicts = [] as PortableLocalDataImportPreview['conflicts']
  const categories: PortableDataConflictCategory[] = [
    'notes',
    'reviewTemplates',
    'savedFilters',
    'globalWorkspacePreferences',
    'repositoryWorkspacePreferences',
    'reviewNotificationPreferences',
  ]
  for (const category of categories) {
    for (const key of categoryKeys(category, data)) {
      if (existing[category].has(`${category}:${key}`)) {
        conflicts.push({ category, key })
      } else {
        increment(additions, category)
      }
    }
  }
  logger.info('Portable local data import preview created', {
    conflictCount: conflicts.length,
    noteCount: data.data.notes.length,
    templateCount: data.data.reviewTemplates.length,
    savedFilterCount: data.data.savedFilters.length,
  })
  return { data, additions, conflicts, skipped: emptyCounts() }
}

const applyCategory = async (
  category: PortableDataConflictCategory,
  preview: PortableLocalDataImportPreview,
  decisions: PortableDataConflictDecisions,
  dependencies: ImportPortableLocalDataDependencies,
  imported: PortableLocalDataCounts,
  skipped: PortableLocalDataCounts,
): Promise<void> => {
  const decision = decisions[category]
  const conflicts = preview.conflicts.filter(
    ({ category: item }) => item === category,
  )
  if (conflicts.length > 0 && decision === undefined) {
    throw new Error(`Conflict decision is required for ${category}`)
  }
  const conflictKeys = new Set(conflicts.map(({ key }) => key))
  const shouldImportRecord = (key: string): boolean => {
    if (!conflictKeys.has(key)) return true
    if (decision === 'keep-existing') {
      increment(skipped, category)
      return false
    }
    return true
  }
  switch (category) {
    case 'notes':
      for (const record of preview.data.data.notes) {
        if (!shouldImportRecord(record.prKey)) continue
        await dependencies.localReviewRepository.saveNote(record)
        increment(imported, category)
      }
      return
    case 'reviewTemplates':
      for (const record of preview.data.data.reviewTemplates) {
        if (!shouldImportRecord(record.id)) continue
        await dependencies.localReviewRepository.upsertTemplate(record)
        increment(imported, category)
      }
      return
    case 'savedFilters':
      for (const record of preview.data.data.savedFilters) {
        if (!shouldImportRecord(record.id)) continue
        await dependencies.workspacePreferencesRepository.upsertSavedFilter(
          record,
        )
        increment(imported, category)
      }
      return
    case 'globalWorkspacePreferences':
      if (!shouldImportRecord('singleton')) return
      await dependencies.workspacePreferencesRepository.saveGlobalPreferences(
        preview.data.data.globalWorkspacePreferences,
      )
      increment(imported, category)
      return
    case 'repositoryWorkspacePreferences':
      for (const record of preview.data.data.repositoryWorkspacePreferences) {
        if (!shouldImportRecord(record.repositoryKey)) continue
        await dependencies.workspacePreferencesRepository.upsertRepositoryPreferences(
          record,
        )
        increment(imported, category)
      }
      return
    case 'reviewNotificationPreferences':
      if (!shouldImportRecord('singleton')) return
      await dependencies.reviewNotificationRepository.savePreferences(
        preview.data.data.reviewNotificationPreferences,
      )
      increment(imported, category)
  }
}

export const createPreviewPortableLocalDataImport =
  (dependencies: ImportPortableLocalDataDependencies) =>
  async (input: unknown): Promise<PreviewPortableLocalDataImportResult> => {
    logger.debug('Starting portable local data import preview')
    try {
      return {
        status: 'success',
        preview: await createPreview(input, dependencies),
      }
    } catch (error) {
      logger.warn('Portable local data import preview failed', {
        errorName: getErrorName(error),
      })
      const candidate = error as {
        code?: unknown
        issueCount?: unknown
        message?: unknown
      }
      return {
        status: 'error',
        error: {
          code:
            candidate.code === 'unsupported-version'
              ? 'unsupported-version'
              : 'invalid-data',
          message:
            typeof candidate.message === 'string'
              ? candidate.message
              : 'Portable local data import is invalid',
          issueCount:
            typeof candidate.issueCount === 'number' ? candidate.issueCount : 1,
        },
      }
    }
  }

export const createApplyPortableLocalDataImport =
  (dependencies: ImportPortableLocalDataDependencies) =>
  async ({
    preview,
    conflictDecisions,
  }: ApplyPortableLocalDataImportInput): Promise<ApplyPortableLocalDataImportResult> => {
    const imported = emptyCounts()
    const skipped = emptyCounts()
    const categories: PortableDataConflictCategory[] = [
      'notes',
      'reviewTemplates',
      'savedFilters',
      'globalWorkspacePreferences',
      'repositoryWorkspacePreferences',
      'reviewNotificationPreferences',
    ]
    logger.debug('Starting portable local data import apply', {
      conflictCount: preview.conflicts.length,
    })
    try {
      for (const category of categories) {
        await applyCategory(
          category,
          preview,
          conflictDecisions,
          dependencies,
          imported,
          skipped,
        )
      }
      logger.info('Portable local data import completed', {
        importedCount: Object.values(imported).reduce(
          (sum, count) => sum + count,
          0,
        ),
        skippedCount: Object.values(skipped).reduce(
          (sum, count) => sum + count,
          0,
        ),
      })
      return { status: 'success', imported, skipped }
    } catch (error) {
      const mapped = toStorageError(error)
      logger.error('Portable local data import partially applied', {
        errorName: getErrorName(error),
        importedCount: Object.values(imported).reduce(
          (sum, count) => sum + count,
          0,
        ),
      })
      return importedCount(imported) === 0
        ? { status: 'error', error: mapped }
        : { status: 'partial', imported, skipped, error: mapped }
    }
  }

const importedCount = (counts: PortableLocalDataCounts): number =>
  Object.values(counts).reduce((sum, count) => sum + count, 0)
