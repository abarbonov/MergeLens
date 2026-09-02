import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  MAX_SAVED_FILTER_CRITERION_COUNT,
  MAX_SAVED_FILTER_COUNT,
  WorkspacePreferencesRepositoryError,
  WorkspacePreferencesValidationError,
  createDeleteSavedFilter,
  createGetEffectiveWorkspacePreferences,
  createGetWorkspacePreferences,
  createListSavedFilters,
  createRepositoryKey,
  createUpdateWorkspacePreferences,
  createUpsertSavedFilter,
  matchesSavedInboxFilter,
  normalizeRepositoryKey,
  normalizeSavedInboxFilterDraft,
  normalizeSavedInboxFilters,
  resolveEffectiveWorkspacePreferences,
  toWorkspacePreferencesError,
  upsertSavedInboxFilter,
  type SavedInboxFilter,
  type WorkspacePreferencesRepository,
} from '@/modules/workspace-preferences'
import type { ReviewInboxPullRequest } from '@/modules/pull-requests'

const createFilter = (
  overrides: Partial<SavedInboxFilter> = {},
): SavedInboxFilter => ({
  id: 'filter-1',
  name: 'Ready reviews',
  view: 'reviewRequests',
  criteria: {
    repositories: [],
    authors: [],
    draftState: 'ready',
  },
  ...overrides,
})

const pullRequest: ReviewInboxPullRequest = {
  id: 'pr-42',
  number: 42,
  title: 'Add workspace preferences',
  url: 'https://github.com/Octo/Example/pull/42',
  repository: {
    owner: 'Octo',
    name: 'Example',
    fullName: 'Octo/Example',
    url: 'https://github.com/Octo/Example',
  },
  authorLogin: 'Octo-Cat',
  isDraft: false,
  updatedAt: '2026-08-17T10:00:00.000Z',
  reasons: ['review-requested'],
}

const createRepository = (
  overrides: Partial<WorkspacePreferencesRepository> = {},
): WorkspacePreferencesRepository => ({
  listSavedFilters: vi.fn(async () => []),
  upsertSavedFilter: vi.fn(async (filter) => [filter]),
  deleteSavedFilter: vi.fn(async () => []),
  getGlobalPreferences: vi.fn(async () => ({})),
  saveGlobalPreferences: vi.fn(async (preferences) => preferences),
  listRepositoryPreferences: vi.fn(async () => []),
  getRepositoryPreferences: vi.fn(async () => null),
  upsertRepositoryPreferences: vi.fn(async (preferences) => [preferences]),
  deleteRepositoryPreferences: vi.fn(async () => []),
  ...overrides,
})

describe('workspace preferences domain', () => {
  it('resolves repository overrides and falls back safely for malformed context', async () => {
    const repository: WorkspacePreferencesRepository = {
      listSavedFilters: async () => [],
      upsertSavedFilter: async () => [],
      deleteSavedFilter: async () => [],
      getGlobalPreferences: async () => ({
        featureFlags: { savedFilters: false },
      }),
      saveGlobalPreferences: async (preferences) => preferences,
      listRepositoryPreferences: async () => [],
      getRepositoryPreferences: async () => ({
        repositoryKey: 'octo/example',
        featureFlags: { savedFilters: true },
      }),
      upsertRepositoryPreferences: async () => [],
      deleteRepositoryPreferences: async () => [],
    }
    const resolve = createGetEffectiveWorkspacePreferences(repository)

    await expect(resolve(' Octo/Example ')).resolves.toMatchObject({
      repositoryKey: 'octo/example',
      source: 'repository',
      preferences: {
        featureFlags: { savedFilters: true },
      },
    })
    await expect(resolve('malformed')).resolves.toMatchObject({
      repositoryKey: null,
      source: 'global',
      preferences: { featureFlags: { savedFilters: false } },
    })
  })
  it('creates canonical repository keys', () => {
    expect(
      createRepositoryKey({ owner: ' Octo ', repository: ' Example ' }),
    ).toBe('octo/example')
    expect(normalizeRepositoryKey(' Octo/Example ')).toBe('octo/example')
    expect(() => normalizeRepositoryKey('octo/example/extra')).toThrow(
      WorkspacePreferencesValidationError,
    )
  })

  it('normalizes filter criteria without duplicate values', () => {
    expect(
      normalizeSavedInboxFilterDraft({
        name: '  My reviews  ',
        view: 'assigned',
        criteria: {
          repositories: ['Octo/Example', 'octo/example'],
          authors: ['@Octo-Cat', 'octo-cat'],
          draftState: 'any',
        },
      }),
    ).toEqual({
      name: 'My reviews',
      view: 'assigned',
      criteria: {
        repositories: ['octo/example'],
        authors: ['octo-cat'],
        draftState: 'any',
      },
    })
  })

  it('sorts filters and rejects duplicate names', () => {
    expect(
      normalizeSavedInboxFilters([
        createFilter({ id: 'z', name: 'Zeta' }),
        createFilter({ id: 'a', name: 'Alpha' }),
      ]).map(({ id }) => id),
    ).toEqual(['a', 'z'])

    expect(() =>
      normalizeSavedInboxFilters([
        createFilter({ id: 'a', name: 'Ready' }),
        createFilter({ id: 'b', name: ' ready ' }),
      ]),
    ).toThrow('Saved filter names must be unique')
  })

  it('rejects filters that exceed bounded criterion counts', () => {
    expect(() =>
      normalizeSavedInboxFilterDraft({
        name: 'Too broad',
        view: 'reviewRequests',
        criteria: {
          repositories: Array.from(
            { length: MAX_SAVED_FILTER_CRITERION_COUNT + 1 },
            (_, index) => `owner/repository-${index}`,
          ),
          authors: [],
          draftState: 'any',
        },
      }),
    ).toThrow(
      `repositories cannot contain more than ${MAX_SAVED_FILTER_CRITERION_COUNT} entries`,
    )
  })

  it('applies default, global, and repository preference precedence', () => {
    expect(resolveEffectiveWorkspacePreferences()).toEqual(
      DEFAULT_WORKSPACE_PREFERENCES,
    )
    expect(
      resolveEffectiveWorkspacePreferences(
        {
          featureFlags: { savedFilters: false },
          commandPaletteShortcut: 'primary-shift-k',
        },
        {
          repositoryKey: 'Octo/Example',
          featureFlags: { savedFilters: true },
          commandPaletteShortcut: 'primary-shift-p',
        },
      ),
    ).toEqual({
      featureFlags: {
        savedFilters: true,
        customCommandPaletteShortcut: true,
      },
      commandPaletteShortcut: 'primary-shift-p',
    })
  })

  it('matches normalized inbox items against all filter criteria', () => {
    const filter = createFilter({
      criteria: {
        repositories: ['octo/example'],
        authors: ['octo-cat'],
        draftState: 'ready',
      },
    })
    expect(matchesSavedInboxFilter(pullRequest, filter)).toBe(true)
    expect(
      matchesSavedInboxFilter({ ...pullRequest, authorLogin: null }, filter),
    ).toBe(false)
    expect(
      matchesSavedInboxFilter({ ...pullRequest, isDraft: true }, filter),
    ).toBe(false)
    expect(
      matchesSavedInboxFilter(
        {
          ...pullRequest,
          repository: { ...pullRequest.repository, fullName: 'other/repo' },
        },
        filter,
      ),
    ).toBe(false)
  })
})

describe('workspace preferences application operations', () => {
  it('orchestrates saved-filter list, upsert, and delete use cases', async () => {
    const repository = createRepository()
    const list = createListSavedFilters(repository)
    const upsert = createUpsertSavedFilter(repository, {
      createId: () => 'created-filter',
    })
    const remove = createDeleteSavedFilter(repository)

    await expect(list()).resolves.toEqual({ status: 'success', data: [] })
    await expect(
      upsert({
        filter: {
          name: 'Created',
          view: 'assigned',
          criteria: { repositories: [], authors: [], draftState: 'any' },
        },
      }),
    ).resolves.toMatchObject({
      status: 'success',
      data: { filter: { id: 'created-filter', name: 'Created' } },
    })
    vi.mocked(repository.listSavedFilters).mockResolvedValueOnce([
      createFilter({ id: 'created-filter', name: 'Created' }),
    ])
    await expect(remove({ filterId: 'created-filter' })).resolves.toEqual({
      status: 'success',
      data: [],
    })
    expect(repository.upsertSavedFilter).toHaveBeenCalledOnce()
    expect(repository.deleteSavedFilter).toHaveBeenCalledWith('created-filter')
  })

  it('loads state and normalizes repository override mutations', async () => {
    const repository = createRepository()
    const getPreferences = createGetWorkspacePreferences(repository)
    const updatePreferences = createUpdateWorkspacePreferences(repository)

    await expect(getPreferences()).resolves.toEqual({
      status: 'success',
      data: {
        savedFilters: [],
        globalPreferences: {},
        repositoryPreferences: [],
      },
    })
    await expect(
      updatePreferences({
        kind: 'repository-upsert',
        preferences: {
          repositoryKey: ' Octo/Example ',
          featureFlags: { savedFilters: false },
        },
      }),
    ).resolves.toMatchObject({ status: 'success' })
    expect(repository.upsertRepositoryPreferences).toHaveBeenCalledWith({
      repositoryKey: 'octo/example',
      featureFlags: { savedFilters: false },
    })
  })

  it('maps expected repository failures and defaults effective preferences', async () => {
    const repositoryError = new WorkspacePreferencesRepositoryError(
      'storage-unavailable',
      'Unavailable',
    )
    const repository = createRepository({
      listSavedFilters: vi.fn(async () => {
        throw repositoryError
      }),
      getGlobalPreferences: vi.fn(async () => {
        throw repositoryError
      }),
    })

    await expect(createListSavedFilters(repository)()).resolves.toEqual({
      status: 'error',
      error: {
        code: 'storage-unavailable',
        message: 'Unavailable',
      },
    })
    await expect(
      createGetEffectiveWorkspacePreferences(repository)('octo/example'),
    ).resolves.toEqual({
      preferences: DEFAULT_WORKSPACE_PREFERENCES,
      repositoryKey: 'octo/example',
      source: 'default',
    })
  })

  it('upserts and deterministically sorts filters', () => {
    const next = upsertSavedInboxFilter(
      [createFilter({ id: 'z', name: 'Zeta' })],
      {
        name: ' Alpha ',
        view: 'recentActivity',
        criteria: { repositories: [], authors: [], draftState: 'any' },
      },
      () => 'a',
    )

    expect(next.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'z', name: 'Zeta' },
    ])
  })

  it('rejects insertion beyond the saved-filter limit', () => {
    const filters = Array.from({ length: MAX_SAVED_FILTER_COUNT }, (_, index) =>
      createFilter({ id: `filter-${index}`, name: `Filter ${index}` }),
    )

    expect(() =>
      upsertSavedInboxFilter(
        filters,
        {
          name: 'Overflow',
          view: 'assigned',
          criteria: { repositories: [], authors: [], draftState: 'any' },
        },
        () => 'overflow',
      ),
    ).toThrow(
      `No more than ${MAX_SAVED_FILTER_COUNT} saved filters are allowed`,
    )
  })

  it('maps validation failures without returning invalid input values', () => {
    expect(
      toWorkspacePreferencesError(
        new WorkspacePreferencesValidationError('Invalid filter', 'name', 2),
      ),
    ).toEqual({
      code: 'invalid-input',
      message: 'Invalid filter',
      issueCount: 2,
    })
  })
})
