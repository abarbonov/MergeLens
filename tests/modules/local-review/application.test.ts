import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LocalReviewRepositoryError,
  createDeleteReviewTemplate,
  createGetLocalReviewWorkspace,
  createPullRequestKey,
  createSavePullRequestNote,
  createUpsertReviewTemplate,
  sortReviewTemplates,
  type CanonicalPullRequestIdentity,
  type LocalReviewRepository,
  type PullRequestNote,
  type ReviewTemplate,
} from '@/modules/local-review'

class InMemoryLocalReviewRepository implements LocalReviewRepository {
  readonly notes = new Map<string, PullRequestNote>()
  readonly templates = new Map<string, ReviewTemplate>()

  async readNote(
    identity: CanonicalPullRequestIdentity,
  ): Promise<PullRequestNote | null> {
    return this.notes.get(identity.prKey) ?? null
  }

  async saveNote(note: PullRequestNote): Promise<PullRequestNote | null> {
    if (note.body.length === 0) {
      this.notes.delete(note.prKey)
      return null
    }
    const existing = this.notes.get(note.prKey)
    if (existing && existing.updatedAt > note.updatedAt) {
      return existing
    }
    this.notes.set(note.prKey, note)
    return note
  }

  async deleteNote(prKey: string): Promise<void> {
    this.notes.delete(prKey)
  }

  async listNotes(): Promise<PullRequestNote[]> {
    return [...this.notes.values()].sort((left, right) =>
      left.prKey.localeCompare(right.prKey),
    )
  }

  async listTemplates(): Promise<ReviewTemplate[]> {
    return sortReviewTemplates([...this.templates.values()])
  }

  async upsertTemplate(template: ReviewTemplate): Promise<ReviewTemplate> {
    const existing = this.templates.get(template.id)
    const next = {
      ...template,
      createdAt: existing?.createdAt ?? template.createdAt,
    }
    this.templates.set(template.id, next)
    return next
  }

  async deleteTemplate(templateId: string): Promise<void> {
    this.templates.delete(templateId)
  }
}

const context = {
  owner: 'Octo',
  repository: 'Example',
  pullNumber: 42,
}

describe('local review application use cases', () => {
  let repository: InMemoryLocalReviewRepository

  beforeEach(() => {
    repository = new InMemoryLocalReviewRepository()
  })

  it('loads a canonical PR note and deterministically sorted templates', async () => {
    const identity = createPullRequestKey(context)
    repository.notes.set(identity.prKey, {
      ...identity,
      body: 'Private draft',
      updatedAt: '2026-08-14T10:00:00.000Z',
    })
    repository.templates.set('z', {
      id: 'z',
      title: 'Zeta',
      body: 'Later',
      createdAt: '2026-08-14T10:00:00.000Z',
      updatedAt: '2026-08-14T10:00:00.000Z',
    })
    repository.templates.set('a', {
      id: 'a',
      title: 'Alpha',
      body: 'First',
      createdAt: '2026-08-14T10:00:00.000Z',
      updatedAt: '2026-08-14T10:00:00.000Z',
    })

    const result = await createGetLocalReviewWorkspace(repository)({
      correlationId: 'workspace-1',
      context,
    })

    expect(result).toMatchObject({
      status: 'success',
      correlationId: 'workspace-1',
      data: {
        note: { prKey: 'octo/example#42', body: 'Private draft' },
      },
    })
    expect(
      result.status === 'success' && result.data.templates.map(({ id }) => id),
    ).toEqual(['a', 'z'])
  })

  it('lists notes in deterministic pull request key order', async () => {
    repository.notes.set('zeta/repo#2', {
      owner: 'zeta',
      repository: 'repo',
      pullNumber: 2,
      prKey: 'zeta/repo#2',
      body: 'Second',
      updatedAt: '2026-08-14T10:00:00.000Z',
    })
    repository.notes.set('alpha/repo#1', {
      owner: 'alpha',
      repository: 'repo',
      pullNumber: 1,
      prKey: 'alpha/repo#1',
      body: 'First',
      updatedAt: '2026-08-14T10:00:00.000Z',
    })

    await expect(repository.listNotes()).resolves.toEqual([
      expect.objectContaining({ prKey: 'alpha/repo#1' }),
      expect.objectContaining({ prKey: 'zeta/repo#2' }),
    ])
  })

  it('saves notes with an injected timestamp and deletes blank drafts', async () => {
    const saveNote = createSavePullRequestNote(repository, {
      now: () => new Date('2026-08-14T11:00:00.000Z'),
    })

    const saved = await saveNote({
      correlationId: 'note-1',
      context,
      body: 'Keep this local',
    })
    expect(saved).toMatchObject({
      status: 'success',
      correlationId: 'note-1',
      data: {
        note: {
          prKey: 'octo/example#42',
          body: 'Keep this local',
          updatedAt: '2026-08-14T11:00:00.000Z',
        },
      },
    })

    await expect(
      saveNote({
        correlationId: 'note-2',
        context,
        body: '   ',
      }),
    ).resolves.toMatchObject({
      status: 'success',
      data: { note: null },
    })
    expect(repository.notes).toHaveLength(0)
  })

  it('returns authoritative template lists after upsert and delete', async () => {
    const upsertTemplate = createUpsertReviewTemplate(repository, {
      now: () => new Date('2026-08-14T12:00:00.000Z'),
      createId: () => 'template-1',
    })
    const upserted = await upsertTemplate({
      correlationId: 'template-upsert-1',
      template: { title: '  Correctness  ', body: 'Please cover this case.' },
    })

    expect(upserted).toMatchObject({
      status: 'success',
      correlationId: 'template-upsert-1',
      data: {
        template: { id: 'template-1', title: 'Correctness' },
        templates: [{ id: 'template-1' }],
      },
    })

    await expect(
      createDeleteReviewTemplate(repository)({
        correlationId: 'template-delete-1',
        templateId: 'template-1',
      }),
    ).resolves.toEqual({
      status: 'success',
      correlationId: 'template-delete-1',
      data: { templates: [] },
    })
  })

  it('maps validation and repository failures to typed results', async () => {
    const invalid = await createSavePullRequestNote(repository)({
      correlationId: 'invalid-note',
      context: { ...context, pullNumber: 0 },
      body: 'Draft',
    })
    expect(invalid).toMatchObject({
      status: 'error',
      correlationId: 'invalid-note',
      error: { code: 'invalid-input' },
    })

    const failingRepository: LocalReviewRepository = {
      readNote: vi.fn().mockResolvedValue(null),
      saveNote: vi.fn(),
      deleteNote: vi.fn(),
      listNotes: vi.fn().mockResolvedValue([]),
      listTemplates: vi
        .fn()
        .mockRejectedValue(
          new LocalReviewRepositoryError(
            'quota-exceeded',
            'Local review storage quota was exceeded',
          ),
        ),
      upsertTemplate: vi.fn(),
      deleteTemplate: vi.fn(),
    }
    const failed = await createGetLocalReviewWorkspace(failingRepository)({
      correlationId: 'failed-workspace',
      context,
    })
    expect(failed).toEqual({
      status: 'error',
      correlationId: 'failed-workspace',
      error: {
        code: 'quota-exceeded',
        message: 'Local review storage quota was exceeded',
      },
    })
  })
})
