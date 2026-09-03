import { z } from 'zod'
import { logger as rootLogger } from '@/shared/logging'
import {
  MAX_PULL_REQUEST_NOTE_LENGTH,
  MAX_REVIEW_TEMPLATE_BODY_LENGTH,
  MAX_REVIEW_TEMPLATE_COUNT,
  MAX_REVIEW_TEMPLATE_TITLE_LENGTH,
  LocalReviewRepositoryError,
  LocalReviewValidationError,
  createPullRequestKey,
  normalizePullRequestNoteBody,
  sortReviewTemplates,
  type CanonicalPullRequestIdentity,
  type PullRequestNote,
  type ReviewTemplate,
} from '../domain/LocalReview'
import type { LocalReviewRepository } from '../ports/LocalReviewRepository'
import {
  LOCAL_REVIEW_DATABASE_VERSION,
  LocalReviewDatabase,
  type StoredPullRequestNote,
  type StoredReviewTemplate,
} from './LocalReviewDatabase'

const logger = rootLogger.child({ scope: "localReview.dexieRepository" })

const storedPullRequestNoteSchema = z.object({
  schemaVersion: z.literal(1),
  prKey: z.string().min(1),
  owner: z.string().min(1).max(100),
  repository: z.string().min(1).max(100),
  pullNumber: z.number().int().positive(),
  body: z.string().max(MAX_PULL_REQUEST_NOTE_LENGTH),
  updatedAt: z.iso.datetime({ offset: true }),
})

const storedReviewTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(MAX_REVIEW_TEMPLATE_TITLE_LENGTH),
  body: z.string().min(1).max(MAX_REVIEW_TEMPLATE_BODY_LENGTH),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})

const isQuotaError = (error: unknown): boolean => {
  return (
    error instanceof Error &&
    (error.name === 'QuotaExceededError' ||
      error.message.toLowerCase().includes('quota'))
  )
}

const mapStorageError = (error: unknown): LocalReviewRepositoryError => {
  if (isQuotaError(error)) {
    return new LocalReviewRepositoryError(
      'quota-exceeded',
      'Local review storage quota was exceeded',
      { cause: error },
    )
  }

  return new LocalReviewRepositoryError(
    'storage-unavailable',
    'Local review storage is unavailable',
    { cause: error },
  )
}

const toPullRequestNote = (input: unknown): PullRequestNote | null => {
  if (input === undefined || input === null) {
    return null
  }

  const result = storedPullRequestNoteSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Ignored invalid stored pull request note', {
      issueCount: result.error.issues.length,
    })
    return null
  }

  try {
    const identity = createPullRequestKey(result.data)
    if (identity.prKey !== result.data.prKey) {
      logger.warn('Ignored stored note with a non-canonical PR key', {
        prKey: result.data.prKey,
      })
      return null
    }

    const { schemaVersion: _schemaVersion, ...note } = result.data
    return note
  } catch (error) {
    logger.warn('Ignored stored note with invalid PR identity', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return null
  }
}

const toReviewTemplate = (input: unknown): ReviewTemplate | null => {
  const result = storedReviewTemplateSchema.safeParse(input)
  if (!result.success) {
    logger.warn('Ignored invalid stored review template', {
      issueCount: result.error.issues.length,
    })
    return null
  }

  const { schemaVersion: _schemaVersion, ...template } = result.data
  return template
}

export class DexieLocalReviewRepository implements LocalReviewRepository {
  constructor(private readonly database = new LocalReviewDatabase()) {}

  private async ensureOpen(): Promise<void> {
    if (this.database.isOpen()) {
      return
    }

    logger.debug('Opening local review database', {
      databaseVersion: LOCAL_REVIEW_DATABASE_VERSION,
    })
    await this.database.open()
    logger.info('Local review database opened', {
      databaseVersion: LOCAL_REVIEW_DATABASE_VERSION,
    })
  }

  private async runStorageOperation<T>(
    operation: string,
    callback: () => Promise<T>,
  ): Promise<T> {
    try {
      await this.ensureOpen()
      return await callback()
    } catch (error) {
      if (
        error instanceof LocalReviewRepositoryError ||
        error instanceof LocalReviewValidationError
      ) {
        throw error
      }

      const mappedError = mapStorageError(error)
      logger.error('Local review database operation failed', {
        operation,
        code: mappedError.code,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      throw mappedError
    }
  }

  async readNote(
    identity: CanonicalPullRequestIdentity,
  ): Promise<PullRequestNote | null> {
    logger.debug('Reading pull request note', { prKey: identity.prKey })
    return this.runStorageOperation('read-note', async () => {
      const note = toPullRequestNote(
        await this.database.notes.get(identity.prKey),
      )
      logger.debug('Pull request note read completed', {
        prKey: identity.prKey,
        isPresent: Boolean(note),
      })
      return note
    })
  }

  async saveNote(note: PullRequestNote): Promise<PullRequestNote | null> {
    const normalizedBody = normalizePullRequestNoteBody(note.body)
    logger.debug('Saving pull request note', {
      prKey: note.prKey,
      bodyLength: normalizedBody.length,
    })

    return this.runStorageOperation('save-note', async () => {
      if (normalizedBody.length === 0) {
        await this.database.notes.delete(note.prKey)
        logger.info('Deleted blank pull request note', { prKey: note.prKey })
        return null
      }

      const storedNote: StoredPullRequestNote =
        storedPullRequestNoteSchema.parse({
          ...note,
          body: normalizedBody,
          schemaVersion: 1,
        })

      return this.database.transaction('rw', this.database.notes, async () => {
        const existing = toPullRequestNote(
          await this.database.notes.get(storedNote.prKey),
        )
        if (existing && existing.updatedAt > storedNote.updatedAt) {
          logger.warn('Ignored stale pull request note write', {
            prKey: storedNote.prKey,
          })
          return existing
        }

        await this.database.notes.put(storedNote)
        logger.info('Saved pull request note', {
          prKey: storedNote.prKey,
          bodyLength: storedNote.body.length,
        })
        return toPullRequestNote(storedNote)
      })
    })
  }

  async deleteNote(prKey: string): Promise<void> {
    logger.debug('Deleting pull request note', { prKey })
    await this.runStorageOperation('delete-note', async () => {
      await this.database.notes.delete(prKey)
      logger.info('Deleted pull request note', { prKey })
    })
  }

  async listNotes(): Promise<PullRequestNote[]> {
    logger.debug('Listing pull request notes')
    return this.runStorageOperation('list-notes', async () => {
      const notes = (await this.database.notes.toArray())
        .map(toPullRequestNote)
        .filter((note): note is PullRequestNote => note !== null)
        .sort((left, right) => left.prKey.localeCompare(right.prKey))
      logger.info('Listed pull request notes', {
        noteCount: notes.length,
      })
      return notes
    })
  }

  async listTemplates(): Promise<ReviewTemplate[]> {
    logger.debug('Listing review templates')
    return this.runStorageOperation('list-templates', async () => {
      const templates = sortReviewTemplates(
        (await this.database.templates.toArray())
          .map(toReviewTemplate)
          .filter((template): template is ReviewTemplate => template !== null),
      )
      logger.debug('Review template listing completed', {
        templateCount: templates.length,
      })
      return templates
    })
  }

  async upsertTemplate(template: ReviewTemplate): Promise<ReviewTemplate> {
    logger.debug('Upserting review template', {
      templateId: template.id,
      titleLength: template.title.length,
      bodyLength: template.body.length,
    })

    return this.runStorageOperation('upsert-template', async () => {
      const candidate: StoredReviewTemplate = storedReviewTemplateSchema.parse({
        ...template,
        schemaVersion: 1,
      })

      return this.database.transaction(
        'rw',
        this.database.templates,
        async () => {
          const existing = toReviewTemplate(
            await this.database.templates.get(candidate.id),
          )
          if (
            !existing &&
            (await this.database.templates.count()) >= MAX_REVIEW_TEMPLATE_COUNT
          ) {
            throw new LocalReviewValidationError(
              `No more than ${MAX_REVIEW_TEMPLATE_COUNT} review templates are allowed`,
              'templates',
            )
          }
          if (existing && existing.updatedAt > candidate.updatedAt) {
            logger.warn('Ignored stale review template write', {
              templateId: candidate.id,
            })
            return existing
          }

          const nextTemplate: StoredReviewTemplate = {
            ...candidate,
            createdAt: existing?.createdAt ?? candidate.createdAt,
          }
          await this.database.templates.put(nextTemplate)
          logger.info('Upserted review template', {
            templateId: nextTemplate.id,
            templateCount: await this.database.templates.count(),
          })
          const { schemaVersion: _schemaVersion, ...savedTemplate } =
            nextTemplate
          return savedTemplate
        },
      )
    })
  }

  async deleteTemplate(templateId: string): Promise<void> {
    logger.debug('Deleting review template', { templateId })
    await this.runStorageOperation('delete-template', async () => {
      await this.database.templates.delete(templateId)
      logger.info('Deleted review template', { templateId })
    })
  }
}
