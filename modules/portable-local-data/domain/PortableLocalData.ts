import { z } from 'zod'
import {
  MAX_PULL_REQUEST_NOTE_LENGTH,
  MAX_REVIEW_TEMPLATE_BODY_LENGTH,
  MAX_REVIEW_TEMPLATE_COUNT,
  MAX_REVIEW_TEMPLATE_TITLE_LENGTH,
  createPullRequestKey,
  normalizePullRequestNoteBody,
  normalizeReviewTemplateDraft,
  sortReviewTemplates,
  type PullRequestNote,
  type ReviewTemplate,
} from '@/modules/local-review'
import {
  REVIEW_NOTIFICATION_INTERVALS,
  normalizeReviewNotificationPreferences,
  type ReviewNotificationPreferences,
} from '@/modules/review-notifications'
import {
  MAX_ESTIMATION_PATTERN_COUNT,
  MAX_ESTIMATION_PATTERN_LENGTH,
  MAX_REPOSITORY_PREFERENCE_COUNT,
  MAX_SAVED_FILTER_COUNT,
  MAX_SAVED_FILTER_CRITERION_COUNT,
  MAX_SAVED_FILTER_NAME_LENGTH,
  normalizeGlobalWorkspacePreferences,
  normalizeRepositoryWorkspacePreferences,
  normalizeSavedInboxFilters,
  type GlobalWorkspacePreferences,
  type RepositoryWorkspacePreferences,
  type SavedInboxFilter,
} from '@/modules/workspace-preferences'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "portableLocalData.validation" })

export const PORTABLE_LOCAL_DATA_FORMAT = 'mergelens-portable-local-data'
export const PORTABLE_LOCAL_DATA_SCHEMA_VERSION = 1
export const MAX_PORTABLE_NOTE_COUNT = 10_000

const MAX_IDENTIFIER_LENGTH = 128
const MAX_REPOSITORY_KEY_LENGTH = 201
const MAX_REPOSITORY_SEGMENT_LENGTH = 100
const MAX_GITHUB_LOGIN_LENGTH = 39

export interface PortableLocalDataPayload {
  notes: PullRequestNote[]
  reviewTemplates: ReviewTemplate[]
  savedFilters: SavedInboxFilter[]
  globalWorkspacePreferences: GlobalWorkspacePreferences
  repositoryWorkspacePreferences: RepositoryWorkspacePreferences[]
  reviewNotificationPreferences: ReviewNotificationPreferences
}

export interface PortableLocalData {
  format: typeof PORTABLE_LOCAL_DATA_FORMAT
  schemaVersion: typeof PORTABLE_LOCAL_DATA_SCHEMA_VERSION
  exportedAt: string
  data: PortableLocalDataPayload
}

export type PortableDataConflictCategory =
  | 'notes'
  | 'reviewTemplates'
  | 'savedFilters'
  | 'globalWorkspacePreferences'
  | 'repositoryWorkspacePreferences'
  | 'reviewNotificationPreferences'

export interface PortableDataConflictKey {
  category: PortableDataConflictCategory
  key: string
}

export type PortableDataConflictDecision = 'use-imported' | 'keep-existing'

export type PortableDataConflictDecisions = Partial<
  Record<PortableDataConflictCategory, PortableDataConflictDecision>
>

export type PortableLocalDataValidationErrorCode =
  'invalid-data' | 'unsupported-version'

export class PortableLocalDataValidationError extends Error {
  constructor(
    readonly code: PortableLocalDataValidationErrorCode,
    message: string,
    readonly issueCount: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PortableLocalDataValidationError'
  }
}

const preferenceOverridesShape = {
  featureFlags: z
    .object({
      savedFilters: z.boolean().optional(),
      customCommandPaletteShortcut: z.boolean().optional(),
    })
    .strict()
    .optional(),
  commandPaletteShortcut: z
    .enum(['primary-k', 'primary-shift-k', 'primary-shift-p'])
    .optional(),
  pullRequestEstimation: z
    .object({
      version: z.string().trim().min(1).max(32).optional(),
      weights: z
        .object({
          changes: z.number().finite().positive().max(100_000).optional(),
          files: z.number().finite().positive().max(100_000).optional(),
          generatedFiles: z
            .number()
            .finite()
            .positive()
            .max(100_000)
            .optional(),
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
    .optional(),
}

const noteSchema = z
  .object({
    prKey: z
      .string()
      .min(1)
      .max(MAX_REPOSITORY_KEY_LENGTH + 12),
    owner: z.string().min(1).max(MAX_REPOSITORY_SEGMENT_LENGTH),
    repository: z.string().min(1).max(MAX_REPOSITORY_SEGMENT_LENGTH),
    pullNumber: z.number().int().positive(),
    body: z.string().min(1).max(MAX_PULL_REQUEST_NOTE_LENGTH),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const reviewTemplateSchema = z
  .object({
    id: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
    title: z.string().trim().min(1).max(MAX_REVIEW_TEMPLATE_TITLE_LENGTH),
    body: z.string().min(1).max(MAX_REVIEW_TEMPLATE_BODY_LENGTH),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()

const savedFilterSchema = z
  .object({
    id: z.string().trim().min(1).max(MAX_IDENTIFIER_LENGTH),
    name: z.string().trim().min(1).max(MAX_SAVED_FILTER_NAME_LENGTH),
    view: z.enum(['reviewRequests', 'assigned', 'recentActivity']),
    criteria: z
      .object({
        repositories: z
          .array(z.string().min(3).max(MAX_REPOSITORY_KEY_LENGTH))
          .max(MAX_SAVED_FILTER_CRITERION_COUNT),
        authors: z
          .array(
            z
              .string()
              .min(1)
              .max(MAX_GITHUB_LOGIN_LENGTH + 1),
          )
          .max(MAX_SAVED_FILTER_CRITERION_COUNT),
        draftState: z.enum(['any', 'draft', 'ready']),
      })
      .strict(),
  })
  .strict()

const globalWorkspacePreferencesSchema = z
  .object(preferenceOverridesShape)
  .strict()

const repositoryWorkspacePreferencesSchema = z
  .object({
    repositoryKey: z.string().min(3).max(MAX_REPOSITORY_KEY_LENGTH),
    ...preferenceOverridesShape,
  })
  .strict()

const reviewNotificationPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    intervalMinutes: z.union(
      REVIEW_NOTIFICATION_INTERVALS.map((interval) => z.literal(interval)),
    ),
  })
  .strict()

export const portableLocalDataSchema = z
  .object({
    format: z.literal(PORTABLE_LOCAL_DATA_FORMAT),
    schemaVersion: z.literal(PORTABLE_LOCAL_DATA_SCHEMA_VERSION),
    exportedAt: z.iso.datetime({ offset: true }),
    data: z
      .object({
        notes: z.array(noteSchema).max(MAX_PORTABLE_NOTE_COUNT),
        reviewTemplates: z
          .array(reviewTemplateSchema)
          .max(MAX_REVIEW_TEMPLATE_COUNT),
        savedFilters: z.array(savedFilterSchema).max(MAX_SAVED_FILTER_COUNT),
        globalWorkspacePreferences: globalWorkspacePreferencesSchema,
        repositoryWorkspacePreferences: z
          .array(repositoryWorkspacePreferencesSchema)
          .max(MAX_REPOSITORY_PREFERENCE_COUNT),
        reviewNotificationPreferences: reviewNotificationPreferencesSchema,
      })
      .strict(),
  })
  .strict()

const requireUnique = (values: readonly string[], field: string): void => {
  if (new Set(values).size !== values.length) {
    throw new PortableLocalDataValidationError(
      'invalid-data',
      `${field} must contain unique values`,
      1,
    )
  }
}

const normalizeNotes = (
  notes: readonly PullRequestNote[],
): PullRequestNote[] => {
  const normalized = notes.map((note) => {
    const identity = createPullRequestKey(note)
    if (identity.prKey !== note.prKey) {
      throw new PortableLocalDataValidationError(
        'invalid-data',
        'notes contains a non-canonical pull request key',
        1,
      )
    }

    const body = normalizePullRequestNoteBody(note.body)
    if (body.length === 0) {
      throw new PortableLocalDataValidationError(
        'invalid-data',
        'notes cannot contain blank bodies',
        1,
      )
    }

    return { ...identity, body, updatedAt: note.updatedAt }
  })
  requireUnique(
    normalized.map(({ prKey }) => prKey),
    'notes.prKey',
  )
  return normalized.sort((left, right) => left.prKey.localeCompare(right.prKey))
}

const normalizeTemplates = (
  templates: readonly ReviewTemplate[],
): ReviewTemplate[] => {
  const normalized = templates.map((template) => {
    const draft = normalizeReviewTemplateDraft(template)
    return {
      id: draft.id ?? template.id,
      title: draft.title,
      body: draft.body,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }
  })
  requireUnique(
    normalized.map(({ id }) => id),
    'reviewTemplates.id',
  )
  return sortReviewTemplates(normalized)
}

const normalizeRepositoryPreferences = (
  preferences: readonly RepositoryWorkspacePreferences[],
): RepositoryWorkspacePreferences[] => {
  const normalized = preferences.map(normalizeRepositoryWorkspacePreferences)
  requireUnique(
    normalized.map(({ repositoryKey }) => repositoryKey),
    'repositoryWorkspacePreferences.repositoryKey',
  )
  return normalized.sort((left, right) =>
    left.repositoryKey.localeCompare(right.repositoryKey),
  )
}

const readSchemaVersion = (input: unknown): unknown => {
  if (typeof input !== 'object' || input === null) return undefined
  return (input as { schemaVersion?: unknown }).schemaVersion
}

const toValidationError = (
  error: unknown,
): PortableLocalDataValidationError => {
  if (error instanceof PortableLocalDataValidationError) return error
  if (error instanceof z.ZodError) {
    return new PortableLocalDataValidationError(
      'invalid-data',
      'Portable local data failed schema validation',
      error.issues.length,
      { cause: error },
    )
  }
  return new PortableLocalDataValidationError(
    'invalid-data',
    'Portable local data failed domain validation',
    1,
    { cause: error },
  )
}

export const parsePortableLocalData = (input: unknown): PortableLocalData => {
  const schemaVersion = readSchemaVersion(input)
  logger.debug('Validating portable local data', {
    schemaVersion: typeof schemaVersion === 'number' ? schemaVersion : null,
  })

  if (
    typeof schemaVersion === 'number' &&
    schemaVersion !== PORTABLE_LOCAL_DATA_SCHEMA_VERSION
  ) {
    logger.warn('Rejected unsupported portable local data version', {
      schemaVersion,
      supportedVersion: PORTABLE_LOCAL_DATA_SCHEMA_VERSION,
    })
    throw new PortableLocalDataValidationError(
      'unsupported-version',
      `Portable local data schema version ${schemaVersion} is not supported`,
      1,
    )
  }

  try {
    const parsed = portableLocalDataSchema.parse(input)
    const normalized: PortableLocalData = {
      ...parsed,
      data: {
        notes: normalizeNotes(parsed.data.notes),
        reviewTemplates: normalizeTemplates(parsed.data.reviewTemplates),
        savedFilters: normalizeSavedInboxFilters(parsed.data.savedFilters),
        globalWorkspacePreferences: normalizeGlobalWorkspacePreferences(
          parsed.data.globalWorkspacePreferences,
        ),
        repositoryWorkspacePreferences: normalizeRepositoryPreferences(
          parsed.data.repositoryWorkspacePreferences,
        ),
        reviewNotificationPreferences: normalizeReviewNotificationPreferences(
          parsed.data.reviewNotificationPreferences,
        ),
      },
    }
    logger.debug('Portable local data validation completed', {
      schemaVersion: normalized.schemaVersion,
      noteCount: normalized.data.notes.length,
      templateCount: normalized.data.reviewTemplates.length,
      savedFilterCount: normalized.data.savedFilters.length,
      repositoryPreferenceCount:
        normalized.data.repositoryWorkspacePreferences.length,
    })
    return normalized
  } catch (error) {
    const validationError = toValidationError(error)
    logger.warn('Rejected invalid portable local data', {
      code: validationError.code,
      issueCount: validationError.issueCount,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    throw validationError
  }
}

export const getPortableDataConflictKey = (
  category: PortableDataConflictCategory,
  record:
    | PullRequestNote
    | ReviewTemplate
    | SavedInboxFilter
    | RepositoryWorkspacePreferences
    | GlobalWorkspacePreferences
    | ReviewNotificationPreferences,
): PortableDataConflictKey => {
  switch (category) {
    case 'notes':
      return { category, key: (record as PullRequestNote).prKey }
    case 'reviewTemplates':
    case 'savedFilters':
      return { category, key: (record as ReviewTemplate | SavedInboxFilter).id }
    case 'repositoryWorkspacePreferences':
      return {
        category,
        key: (record as RepositoryWorkspacePreferences).repositoryKey,
      }
    case 'globalWorkspacePreferences':
    case 'reviewNotificationPreferences':
      return { category, key: 'singleton' }
  }
}
