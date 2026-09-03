import { z } from 'zod'
import { storage, type WxtStorageItem } from 'wxt/utils/storage'
import { logger as rootLogger } from '@/shared/logging'
import {
  MAX_REPOSITORY_PREFERENCE_COUNT,
  MAX_SAVED_FILTER_COUNT,
  MAX_SAVED_FILTER_CRITERION_COUNT,
  MAX_SAVED_FILTER_NAME_LENGTH,
  MAX_ESTIMATION_PATTERN_COUNT,
  MAX_ESTIMATION_PATTERN_LENGTH,
  WorkspacePreferencesRepositoryError,
  WorkspacePreferencesValidationError,
  normalizeGlobalWorkspacePreferences,
  normalizeRepositoryKey,
  normalizeRepositoryWorkspacePreferences,
  normalizeSavedInboxFilters,
  type GlobalWorkspacePreferences,
  type RepositoryWorkspacePreferences,
  type SavedInboxFilter,
} from '../domain/WorkspacePreferences'
import type { WorkspacePreferencesRepository } from '../ports/WorkspacePreferencesRepository'

const logger = rootLogger.child({ scope: "workspacePreferences.storage" })

export const WORKSPACE_PREFERENCES_STORAGE_VERSION = 1
export const MAX_WORKSPACE_PREFERENCES_SYNC_ITEM_BYTES = 7_500

const SAVED_FILTERS_STORAGE_KEY = 'sync:workspacePreferences.savedFilters'
const GLOBAL_PREFERENCES_STORAGE_KEY = 'sync:workspacePreferences.global'
const REPOSITORY_PREFERENCES_STORAGE_KEY =
  'sync:workspacePreferences.repositories'

const featureFlagsSchema = z
  .object({
    savedFilters: z.boolean().optional(),
    customCommandPaletteShortcut: z.boolean().optional(),
  })
  .strict()
const shortcutSchema = z.enum([
  'primary-k',
  'primary-shift-k',
  'primary-shift-p',
])
const estimationPreferencesSchema = z
  .object({
    version: z.string().trim().min(1).max(32).optional(),
    weights: z
      .object({
        changes: z.number().finite().positive().max(100_000).optional(),
        files: z.number().finite().positive().max(100_000).optional(),
        generatedFiles: z.number().finite().positive().max(100_000).optional(),
        checks: z.number().finite().positive().max(100_000).optional(),
      })
      .strict()
      .optional(),
    thresholds: z
      .object({
        medium: z.number().finite().positive().max(100_000).optional(),
        high: z.number().finite().positive().max(100_000).optional(),
        critical: z.number().finite().positive().max(100_000).optional(),
      })
      .strict()
      .optional(),
    maxChangeCount: z.number().finite().positive().max(100_000).optional(),
    maxFileCount: z.number().finite().positive().max(100_000).optional(),
    generatedFilePatterns: z
      .array(z.string().trim().min(1).max(MAX_ESTIMATION_PATTERN_LENGTH))
      .max(MAX_ESTIMATION_PATTERN_COUNT)
      .optional(),
  })
  .strict()
const preferenceOverridesShape = {
  featureFlags: featureFlagsSchema.optional(),
  commandPaletteShortcut: shortcutSchema.optional(),
  pullRequestEstimation: estimationPreferencesSchema.optional(),
}
const globalPreferencesSchema = z.object(preferenceOverridesShape).strict()
const repositoryPreferencesSchema = z
  .object({
    repositoryKey: z.string().min(3).max(201),
    ...preferenceOverridesShape,
  })
  .strict()
const savedFilterSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(MAX_SAVED_FILTER_NAME_LENGTH),
    view: z.enum(['reviewRequests', 'assigned', 'recentActivity']),
    criteria: z
      .object({
        repositories: z
          .array(z.string().min(3).max(201))
          .max(MAX_SAVED_FILTER_CRITERION_COUNT),
        authors: z
          .array(z.string().min(1).max(39))
          .max(MAX_SAVED_FILTER_CRITERION_COUNT),
        draftState: z.enum(['any', 'draft', 'ready']),
      })
      .strict(),
  })
  .strict()
const savedFiltersSchema = z
  .array(savedFilterSchema)
  .max(MAX_SAVED_FILTER_COUNT)
const repositoryPreferencesListSchema = z
  .array(repositoryPreferencesSchema)
  .max(MAX_REPOSITORY_PREFERENCE_COUNT)

const createStoredRecordSchema = <T extends z.ZodType>(valueSchema: T) =>
  z
    .object({
      schemaVersion: z.literal(WORKSPACE_PREFERENCES_STORAGE_VERSION),
      value: valueSchema,
    })
    .strict()

const savedFiltersRecordSchema = createStoredRecordSchema(savedFiltersSchema)
const globalPreferencesRecordSchema = createStoredRecordSchema(
  globalPreferencesSchema,
)
const repositoryPreferencesRecordSchema = createStoredRecordSchema(
  repositoryPreferencesListSchema,
)

const createFallbackRecord = <T>(value: T) => ({
  schemaVersion: WORKSPACE_PREFERENCES_STORAGE_VERSION,
  value,
})

interface WorkspacePreferencesStorageItems {
  savedFilters: WxtStorageItem<unknown, Record<string, unknown>>
  globalPreferences: WxtStorageItem<unknown, Record<string, unknown>>
  repositoryPreferences: WxtStorageItem<unknown, Record<string, unknown>>
}

let storageItems: WorkspacePreferencesStorageItems | undefined

const getStorageItems = (): WorkspacePreferencesStorageItems => {
  if (storageItems) return storageItems

  storageItems = {
    savedFilters: storage.defineItem<unknown>(SAVED_FILTERS_STORAGE_KEY, {
      fallback: createFallbackRecord([]),
      version: WORKSPACE_PREFERENCES_STORAGE_VERSION,
    }),
    globalPreferences: storage.defineItem<unknown>(
      GLOBAL_PREFERENCES_STORAGE_KEY,
      {
        fallback: createFallbackRecord({}),
        version: WORKSPACE_PREFERENCES_STORAGE_VERSION,
      },
    ),
    repositoryPreferences: storage.defineItem<unknown>(
      REPOSITORY_PREFERENCES_STORAGE_KEY,
      {
        fallback: createFallbackRecord([]),
        version: WORKSPACE_PREFERENCES_STORAGE_VERSION,
      },
    ),
  }
  return storageItems
}

/*
 * WXT starts migration work when defineItem is called. Keeping item creation
 * behind repository use makes importing domain exports side-effect free.
 */
const getSavedFiltersItem = () => getStorageItems().savedFilters
const getGlobalPreferencesItem = () => getStorageItems().globalPreferences
const getRepositoryPreferencesItem = () =>
  getStorageItems().repositoryPreferences

type StorageCategory = 'saved-filters' | 'global' | 'repositories'
type StorageOperation = 'read' | 'write'

export type WorkspacePreferencesStorageChangeCategory = StorageCategory

export const subscribeWorkspacePreferencesStorage = (
  listener: (category: WorkspacePreferencesStorageChangeCategory) => void,
): (() => void) => {
  const items = getStorageItems()
  const subscriptions = [
    items.savedFilters.watch(() => listener('saved-filters')),
    items.globalPreferences.watch(() => listener('global')),
    items.repositoryPreferences.watch(() => listener('repositories')),
  ]
  logger.debug('Subscribed to workspace preference storage changes', {
    categoryCount: subscriptions.length,
  })

  return () => {
    subscriptions.forEach((unsubscribe) => unsubscribe())
    logger.debug('Unsubscribed from workspace preference storage changes', {
      categoryCount: subscriptions.length,
    })
  }
}

let mutationQueue: Promise<void> = Promise.resolve()

const runSerializedMutation = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const isQuotaError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; message?: unknown }
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  const message =
    typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  return name === 'QuotaExceededError' || message.includes('quota')
}

const mapStorageError = (
  error: unknown,
): WorkspacePreferencesRepositoryError => {
  if (error instanceof WorkspacePreferencesRepositoryError) return error
  if (isQuotaError(error)) {
    return new WorkspacePreferencesRepositoryError(
      'quota-exceeded',
      'Workspace preferences storage quota was exceeded',
      { cause: error },
    )
  }
  return new WorkspacePreferencesRepositoryError(
    'storage-unavailable',
    'Workspace preferences storage is unavailable',
    { cause: error },
  )
}

const getErrorName = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return 'UnknownError'
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' && name.length > 0 ? name : 'UnknownError'
}

const logStorageFailure = (
  category: StorageCategory,
  operation: StorageOperation,
  error: unknown,
): void => {
  const metadata = { category, operation, errorName: getErrorName(error) }
  if (isQuotaError(error)) {
    logger.warn('Workspace preferences storage quota was exceeded', metadata)
  } else {
    logger.error('Workspace preferences storage operation failed', metadata)
  }
}

const toValidationError = (
  error: z.ZodError,
  field: string,
): WorkspacePreferencesValidationError => {
  return new WorkspacePreferencesValidationError(
    `Invalid workspace preferences ${field}`,
    field,
    error.issues.length,
  )
}

const assertRecordFitsSyncQuota = (
  record: unknown,
  category: StorageCategory,
): void => {
  const byteLength = new TextEncoder().encode(JSON.stringify(record)).byteLength
  if (byteLength <= MAX_WORKSPACE_PREFERENCES_SYNC_ITEM_BYTES) return

  logger.warn('Rejected oversized workspace preferences record', {
    category,
    byteLength,
    byteLimit: MAX_WORKSPACE_PREFERENCES_SYNC_ITEM_BYTES,
  })
  throw new WorkspacePreferencesRepositoryError(
    'quota-exceeded',
    'Workspace preferences exceed the sync storage size limit',
  )
}

const writeRecord = async (
  item: WxtStorageItem<unknown, Record<string, unknown>>,
  value: unknown,
  category: StorageCategory,
): Promise<void> => {
  const record = createFallbackRecord(value)
  assertRecordFitsSyncQuota(record, category)
  try {
    logger.debug('Writing workspace preferences record', { category })
    await item.setValue(record)
  } catch (error) {
    logStorageFailure(category, 'write', error)
    throw mapStorageError(error)
  }
}

const parseSavedFilters = (input: unknown): SavedInboxFilter[] => {
  const result = savedFiltersRecordSchema.safeParse(input)
  if (!result.success) throw toValidationError(result.error, 'savedFilters')
  return normalizeSavedInboxFilters(result.data.value)
}

const parseGlobalPreferences = (input: unknown): GlobalWorkspacePreferences => {
  const result = globalPreferencesRecordSchema.safeParse(input)
  if (!result.success)
    throw toValidationError(result.error, 'globalPreferences')
  return normalizeGlobalWorkspacePreferences(result.data.value)
}

const normalizeRepositoryPreferencesList = (
  preferences: readonly RepositoryWorkspacePreferences[],
): RepositoryWorkspacePreferences[] => {
  if (preferences.length > MAX_REPOSITORY_PREFERENCE_COUNT) {
    throw new WorkspacePreferencesValidationError(
      `No more than ${MAX_REPOSITORY_PREFERENCE_COUNT} repository preferences are allowed`,
      'repositoryPreferences',
    )
  }
  const normalized = preferences.map(normalizeRepositoryWorkspacePreferences)
  const repositoryKeys = new Set(
    normalized.map(({ repositoryKey }) => repositoryKey),
  )
  if (repositoryKeys.size !== normalized.length) {
    throw new WorkspacePreferencesValidationError(
      'Repository preference keys must be unique',
      'repositoryKey',
    )
  }
  return normalized.sort((left, right) =>
    left.repositoryKey.localeCompare(right.repositoryKey),
  )
}

const parseRepositoryPreferences = (
  input: unknown,
): RepositoryWorkspacePreferences[] => {
  const result = repositoryPreferencesRecordSchema.safeParse(input)
  if (!result.success) {
    throw toValidationError(result.error, 'repositoryPreferences')
  }
  return normalizeRepositoryPreferencesList(result.data.value)
}

const readStoredValue = async <T>(
  item: WxtStorageItem<unknown, Record<string, unknown>>,
  parse: (input: unknown) => T,
  fallback: T,
  category: StorageCategory,
): Promise<T> => {
  let stored: unknown
  try {
    logger.debug('Reading workspace preferences record', { category })
    stored = await item.getValue()
  } catch (error) {
    logStorageFailure(category, 'read', error)
    throw mapStorageError(error)
  }

  try {
    return parse(stored)
  } catch (error) {
    if (error instanceof WorkspacePreferencesValidationError) {
      logger.warn('Ignored invalid workspace preferences storage value', {
        category,
        issueCount: error.issueCount,
      })
      return fallback
    }
    throw error
  }
}

const readSavedFilters = async (): Promise<SavedInboxFilter[]> => {
  const filters = await readStoredValue(
    getSavedFiltersItem(),
    parseSavedFilters,
    [],
    'saved-filters',
  )
  logger.debug('Loaded saved inbox filters', { filterCount: filters.length })
  return filters
}

const readGlobalPreferences = async (): Promise<GlobalWorkspacePreferences> => {
  const preferences = await readStoredValue(
    getGlobalPreferencesItem(),
    parseGlobalPreferences,
    {},
    'global',
  )
  logger.debug('Loaded global workspace preferences', {
    featureFlagCount: Object.keys(preferences.featureFlags ?? {}).length,
    hasShortcut: preferences.commandPaletteShortcut !== undefined,
  })
  return preferences
}

const readRepositoryPreferences = async (): Promise<
  RepositoryWorkspacePreferences[]
> => {
  const preferences = await readStoredValue(
    getRepositoryPreferencesItem(),
    parseRepositoryPreferences,
    [],
    'repositories',
  )
  logger.debug('Loaded repository workspace preferences', {
    repositoryCount: preferences.length,
  })
  return preferences
}

export class WxtWorkspacePreferencesRepository implements WorkspacePreferencesRepository {
  listSavedFilters(): Promise<SavedInboxFilter[]> {
    return readSavedFilters()
  }

  upsertSavedFilter(filter: SavedInboxFilter): Promise<SavedInboxFilter[]> {
    return runSerializedMutation(async () => {
      const current = await readSavedFilters()
      const next = normalizeSavedInboxFilters([
        ...current.filter(({ id }) => id !== filter.id),
        filter,
      ])
      await writeRecord(getSavedFiltersItem(), next, 'saved-filters')
      logger.info('Saved inbox filter', {
        filterId: filter.id,
        filterCount: next.length,
      })
      return next
    })
  }

  deleteSavedFilter(filterId: string): Promise<SavedInboxFilter[]> {
    return runSerializedMutation(async () => {
      const idResult = z.string().trim().min(1).max(128).safeParse(filterId)
      if (!idResult.success) {
        throw toValidationError(idResult.error, 'filterId')
      }
      const normalizedId = idResult.data
      const next = (await readSavedFilters()).filter(
        ({ id }) => id !== normalizedId,
      )
      await writeRecord(getSavedFiltersItem(), next, 'saved-filters')
      logger.info('Deleted inbox filter', {
        filterId: normalizedId,
        filterCount: next.length,
      })
      return next
    })
  }

  getGlobalPreferences(): Promise<GlobalWorkspacePreferences> {
    return readGlobalPreferences()
  }

  saveGlobalPreferences(
    preferences: GlobalWorkspacePreferences,
  ): Promise<GlobalWorkspacePreferences> {
    return runSerializedMutation(async () => {
      const result = globalPreferencesSchema.safeParse(preferences)
      if (!result.success) {
        throw toValidationError(result.error, 'globalPreferences')
      }
      const normalized = normalizeGlobalWorkspacePreferences(result.data)
      await writeRecord(getGlobalPreferencesItem(), normalized, 'global')
      logger.info('Saved global workspace preferences', {
        featureFlagCount: Object.keys(normalized.featureFlags ?? {}).length,
        hasShortcut: normalized.commandPaletteShortcut !== undefined,
      })
      return normalized
    })
  }

  listRepositoryPreferences(): Promise<RepositoryWorkspacePreferences[]> {
    return readRepositoryPreferences()
  }

  async getRepositoryPreferences(
    repositoryKey: string,
  ): Promise<RepositoryWorkspacePreferences | null> {
    const normalizedKey = normalizeRepositoryKey(repositoryKey)
    const preferences = await readRepositoryPreferences()
    const result =
      preferences.find(({ repositoryKey: key }) => key === normalizedKey) ??
      null
    logger.debug('Resolved repository workspace preferences', {
      repositoryKey: normalizedKey,
      hasOverride: result !== null,
    })
    return result
  }

  upsertRepositoryPreferences(
    preferences: RepositoryWorkspacePreferences,
  ): Promise<RepositoryWorkspacePreferences[]> {
    return runSerializedMutation(async () => {
      const result = repositoryPreferencesSchema.safeParse(preferences)
      if (!result.success) {
        throw toValidationError(result.error, 'repositoryPreferences')
      }
      const normalized = normalizeRepositoryWorkspacePreferences(result.data)
      const next = normalizeRepositoryPreferencesList([
        ...(await readRepositoryPreferences()).filter(
          ({ repositoryKey }) => repositoryKey !== normalized.repositoryKey,
        ),
        normalized,
      ])
      await writeRecord(getRepositoryPreferencesItem(), next, 'repositories')
      logger.info('Saved repository workspace preferences', {
        repositoryKey: normalized.repositoryKey,
        repositoryCount: next.length,
      })
      return next
    })
  }

  deleteRepositoryPreferences(
    repositoryKey: string,
  ): Promise<RepositoryWorkspacePreferences[]> {
    return runSerializedMutation(async () => {
      const normalizedKey = normalizeRepositoryKey(repositoryKey)
      const next = (await readRepositoryPreferences()).filter(
        ({ repositoryKey: key }) => key !== normalizedKey,
      )
      await writeRecord(getRepositoryPreferencesItem(), next, 'repositories')
      logger.info('Deleted repository workspace preferences', {
        repositoryKey: normalizedKey,
        repositoryCount: next.length,
      })
      return next
    })
  }
}
