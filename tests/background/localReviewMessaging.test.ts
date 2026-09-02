import { describe, expect, it, vi } from 'vitest'
import {
  createDeleteReviewTemplate,
  createGetLocalReviewWorkspace,
  createListReviewTemplates,
  createSavePullRequestNote,
  createUpsertReviewTemplate,
  LocalReviewRepositoryError,
  type LocalReviewRepository,
} from '@/modules/local-review'

const context = {
  owner: 'Octo',
  repository: 'Example',
  pullNumber: 42,
}

const createRepository = (): LocalReviewRepository => ({
  readNote: vi.fn().mockResolvedValue(null),
  saveNote: vi.fn().mockImplementation(async (note) => note),
  deleteNote: vi.fn().mockResolvedValue(undefined),
  listNotes: vi.fn().mockResolvedValue([]),
  listTemplates: vi.fn().mockResolvedValue([]),
  upsertTemplate: vi.fn().mockImplementation(async (template) => template),
  deleteTemplate: vi.fn().mockResolvedValue(undefined),
})

describe('local review background messaging boundary', () => {
  it('loads a workspace through a normalized repository identity', async () => {
    const repository = createRepository()

    await expect(
      createGetLocalReviewWorkspace(repository)({
        correlationId: 'workspace-1',
        context,
      }),
    ).resolves.toEqual({
      status: 'success',
      correlationId: 'workspace-1',
      data: { note: null, templates: [] },
    })
    expect(repository.readNote).toHaveBeenCalledWith({
      owner: 'octo',
      repository: 'example',
      pullNumber: 42,
      prKey: 'octo/example#42',
    })
  })

  it('rejects malformed messages before touching local storage', async () => {
    const repository = createRepository()
    const saveNote = createSavePullRequestNote(repository)

    await expect(
      saveNote({
        correlationId: '',
        context: null,
        body: 'private-note-marker',
      } as never),
    ).resolves.toEqual({
      status: 'error',
      correlationId: 'invalid-request',
      error: {
        code: 'invalid-input',
        message: 'Invalid pull request note save request',
      },
    })
    expect(repository.saveNote).not.toHaveBeenCalled()
  })

  it('contains repository failures as typed message responses', async () => {
    const repository = createRepository()
    vi.mocked(repository.listTemplates).mockRejectedValue(
      new LocalReviewRepositoryError(
        'quota-exceeded',
        'Local review storage quota was exceeded',
      ),
    )

    await expect(
      createListReviewTemplates(repository)({
        correlationId: 'list-1',
      }),
    ).resolves.toEqual({
      status: 'error',
      correlationId: 'list-1',
      error: {
        code: 'quota-exceeded',
        message: 'Local review storage quota was exceeded',
      },
    })
  })

  it('returns authoritative results for note and template mutations', async () => {
    const repository = createRepository()
    const saveNote = createSavePullRequestNote(repository, {
      now: () => new Date('2026-08-14T10:00:00.000Z'),
    })
    const upsertTemplate = createUpsertReviewTemplate(repository, {
      now: () => new Date('2026-08-14T10:00:00.000Z'),
      createId: () => 'template-1',
    })
    const deleteTemplate = createDeleteReviewTemplate(repository)

    await expect(
      saveNote({
        correlationId: 'note-1',
        context,
        body: 'Private note',
      }),
    ).resolves.toMatchObject({
      status: 'success',
      data: { note: { prKey: 'octo/example#42', body: 'Private note' } },
    })
    await expect(
      upsertTemplate({
        correlationId: 'upsert-1',
        template: { title: 'Correctness', body: 'Check edge cases' },
      }),
    ).resolves.toMatchObject({
      status: 'success',
      data: { template: { id: 'template-1' }, templates: [] },
    })
    await expect(
      deleteTemplate({
        correlationId: 'delete-1',
        templateId: 'template-1',
      }),
    ).resolves.toEqual({
      status: 'success',
      correlationId: 'delete-1',
      data: { templates: [] },
    })
  })
})
