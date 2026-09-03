import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  MAX_REPOSITORY_PREFERENCE_COUNT,
  MAX_SAVED_FILTER_COUNT,
  MAX_SAVED_FILTER_CRITERION_COUNT,
  MAX_SAVED_FILTER_NAME_LENGTH,
  deleteSavedFilter,
  getWorkspacePreferences,
  normalizeRepositoryKey,
  normalizeSavedInboxFilterDraft,
  updateWorkspacePreferences,
  upsertSavedFilter,
  type CommandPaletteShortcutId,
  type DraftStateFilter,
  type GlobalWorkspacePreferences,
  type RepositoryWorkspacePreferences,
  type ReviewInboxView,
  type SavedInboxFilter,
  type WorkspacePreferencesError,
  type WorkspacePreferencesState,
} from '@/modules/workspace-preferences'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "settings.workspacePreferences" })

type Operation =
  | 'load'
  | 'filter-save'
  | 'filter-delete'
  | 'global-save'
  | 'repository-save'
  | 'repository-delete'
type TriState = 'inherit' | 'enabled' | 'disabled'
type ShortcutSelection = 'inherit' | CommandPaletteShortcutId

const EMPTY_STATE: WorkspacePreferencesState = {
  savedFilters: [],
  globalPreferences: {},
  repositoryPreferences: [],
}

const SHORTCUT_OPTIONS: Array<{ id: CommandPaletteShortcutId; label: string }> =
  [
    { id: 'primary-k', label: 'Ctrl/Cmd + K' },
    { id: 'primary-shift-k', label: 'Ctrl/Cmd + Shift + K' },
    { id: 'primary-shift-p', label: 'Ctrl/Cmd + Shift + P' },
  ]

const VIEW_LABELS: Record<ReviewInboxView, string> = {
  reviewRequests: 'Review requests',
  assigned: 'Assigned',
  recentActivity: 'Recent activity',
}

const splitCriteria = (value: string): string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const operationErrorMessage = (error: WorkspacePreferencesError): string => {
  if (error.code === 'quota-exceeded') {
    return 'Sync storage is full. Remove unused preferences and try again.'
  }
  if (error.code === 'invalid-input') {
    return 'Check the entered values and try again.'
  }
  return 'Workspace preferences are unavailable. Try again.'
}

const toTriState = (value: boolean | undefined): TriState => {
  if (value === undefined) return 'inherit'
  return value ? 'enabled' : 'disabled'
}

const fromTriState = (value: TriState): boolean | undefined => {
  if (value === 'inherit') return undefined
  return value === 'enabled'
}

export const WorkspacePreferencesSettings = () => {
  const [state, setState] = useState<WorkspacePreferencesState>(EMPTY_STATE)
  const [operation, setOperation] = useState<Operation | null>('load')
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const [editingFilterId, setEditingFilterId] = useState<string | null>(null)
  const [filterName, setFilterName] = useState('')
  const [filterView, setFilterView] =
    useState<ReviewInboxView>('reviewRequests')
  const [filterRepositories, setFilterRepositories] = useState('')
  const [filterAuthors, setFilterAuthors] = useState('')
  const [filterDraftState, setFilterDraftState] =
    useState<DraftStateFilter>('any')

  const [repositoryKey, setRepositoryKey] = useState('')
  const [repositorySavedFilters, setRepositorySavedFilters] =
    useState<TriState>('inherit')
  const [repositoryCustomShortcut, setRepositoryCustomShortcut] =
    useState<TriState>('inherit')
  const [repositoryShortcut, setRepositoryShortcut] =
    useState<ShortcutSelection>('inherit')
  const [editingRepositoryKey, setEditingRepositoryKey] = useState<
    string | null
  >(null)

  const isBusy = operation !== null

  const resetFilterForm = (): void => {
    setEditingFilterId(null)
    setFilterName('')
    setFilterView('reviewRequests')
    setFilterRepositories('')
    setFilterAuthors('')
    setFilterDraftState('any')
  }

  const resetRepositoryForm = (): void => {
    setEditingRepositoryKey(null)
    setRepositoryKey('')
    setRepositorySavedFilters('inherit')
    setRepositoryCustomShortcut('inherit')
    setRepositoryShortcut('inherit')
  }

  const loadState = async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setOperation('load')
    setError(null)
    logger.debug('Loading workspace preferences settings', { sequence })
    try {
      const result = await getWorkspacePreferences()
      if (sequence !== requestSequence.current) {
        logger.debug('Ignored stale workspace preferences response', {
          sequence,
        })
        return
      }
      if (result.status === 'error') {
        logger.warn('Workspace preferences load returned an expected error', {
          sequence,
          code: result.error.code,
        })
        setError(operationErrorMessage(result.error))
        return
      }
      setState(result.data)
      logger.debug('Loaded workspace preferences settings', {
        sequence,
        filterCount: result.data.savedFilters.length,
        repositoryCount: result.data.repositoryPreferences.length,
      })
    } catch (caughtError) {
      logger.error('Workspace preferences load failed unexpectedly', {
        sequence,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      if (sequence === requestSequence.current) {
        setError('Workspace preferences could not be loaded. Try again.')
      }
    } finally {
      if (sequence === requestSequence.current) setOperation(null)
    }
  }

  useEffect(() => {
    void loadState()
    return () => {
      requestSequence.current += 1
    }
  }, [])

  const handleFilterSubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault()
    const repositories = splitCriteria(filterRepositories)
    const authors = splitCriteria(filterAuthors)
    try {
      normalizeSavedInboxFilterDraft({
        id: editingFilterId ?? undefined,
        name: filterName,
        view: filterView,
        criteria: { repositories, authors, draftState: filterDraftState },
      })
    } catch (caughtError) {
      logger.warn('Rejected invalid saved filter form', {
        filterId: editingFilterId ?? undefined,
        nameLength: filterName.trim().length,
        repositoryCount: repositories.length,
        authorCount: authors.length,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError(
        'Enter a unique name and valid comma-separated repositories and authors.',
      )
      return
    }
    if (
      editingFilterId === null &&
      state.savedFilters.length >= MAX_SAVED_FILTER_COUNT
    ) {
      setError(`You can store up to ${MAX_SAVED_FILTER_COUNT} saved filters.`)
      return
    }

    setOperation('filter-save')
    setError(null)
    logger.debug('Saving saved filter from settings', {
      filterId: editingFilterId ?? undefined,
      isEditing: editingFilterId !== null,
      repositoryCount: repositories.length,
      authorCount: authors.length,
    })
    try {
      const result = await upsertSavedFilter({
        filter: {
          id: editingFilterId ?? undefined,
          name: filterName,
          view: filterView,
          criteria: { repositories, authors, draftState: filterDraftState },
        },
      })
      if (result.status === 'error') {
        logger.warn('Saved filter mutation returned an expected error', {
          filterId: editingFilterId ?? undefined,
          code: result.error.code,
        })
        setError(operationErrorMessage(result.error))
        return
      }
      setState((current) => ({ ...current, savedFilters: result.data.filters }))
      resetFilterForm()
      logger.info('Saved filter updated from settings', {
        filterId: result.data.filter.id,
        filterCount: result.data.filters.length,
      })
    } catch (caughtError) {
      logger.error('Saved filter mutation failed unexpectedly', {
        filterId: editingFilterId ?? undefined,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError('The saved filter could not be processed. Try again.')
    } finally {
      setOperation(null)
    }
  }

  const handleEditFilter = (filter: SavedInboxFilter): void => {
    setEditingFilterId(filter.id)
    setFilterName(filter.name)
    setFilterView(filter.view)
    setFilterRepositories(filter.criteria.repositories.join(', '))
    setFilterAuthors(filter.criteria.authors.join(', '))
    setFilterDraftState(filter.criteria.draftState)
    setError(null)
    logger.debug('Selected saved filter for editing', {
      filterId: filter.id,
      repositoryCount: filter.criteria.repositories.length,
      authorCount: filter.criteria.authors.length,
    })
  }

  const handleDeleteFilter = async (filterId: string): Promise<void> => {
    setOperation('filter-delete')
    setError(null)
    logger.debug('Deleting saved filter from settings', { filterId })
    try {
      const result = await deleteSavedFilter({ filterId })
      if (result.status === 'error') {
        setError(operationErrorMessage(result.error))
        logger.warn('Saved filter deletion returned an expected error', {
          filterId,
          code: result.error.code,
        })
        return
      }
      setState((current) => ({ ...current, savedFilters: result.data }))
      if (editingFilterId === filterId) resetFilterForm()
      logger.info('Deleted saved filter from settings', {
        filterId,
        filterCount: result.data.length,
      })
    } catch (caughtError) {
      logger.error('Saved filter deletion failed unexpectedly', {
        filterId,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError('The saved filter could not be deleted. Try again.')
    } finally {
      setOperation(null)
    }
  }

  const saveGlobalPreferences = async (
    preferences: GlobalWorkspacePreferences,
  ): Promise<void> => {
    setOperation('global-save')
    setError(null)
    logger.debug('Saving global workspace preferences', {
      savedFiltersEnabled: preferences.featureFlags?.savedFilters,
      customShortcutEnabled:
        preferences.featureFlags?.customCommandPaletteShortcut,
      hasShortcut: preferences.commandPaletteShortcut !== undefined,
    })
    try {
      const result = await updateWorkspacePreferences({
        kind: 'global',
        preferences,
      })
      if (result.status === 'error') {
        setError(operationErrorMessage(result.error))
        logger.warn('Global preference mutation returned an expected error', {
          code: result.error.code,
        })
        return
      }
      setState((current) => ({ ...current, ...result.data }))
      logger.info('Updated global preferences from settings', {
        savedFiltersEnabled:
          result.data.globalPreferences.featureFlags?.savedFilters,
        customShortcutEnabled:
          result.data.globalPreferences.featureFlags
            ?.customCommandPaletteShortcut,
      })
    } catch (caughtError) {
      logger.error('Global preference mutation failed unexpectedly', {
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError('Global preferences could not be updated. Try again.')
    } finally {
      setOperation(null)
    }
  }

  const handleFeatureFlagChange = (
    flag: 'savedFilters' | 'customCommandPaletteShortcut',
    enabled: boolean,
  ): void => {
    void saveGlobalPreferences({
      ...state.globalPreferences,
      featureFlags: {
        savedFilters:
          flag === 'savedFilters'
            ? enabled
            : (state.globalPreferences.featureFlags?.savedFilters ??
              DEFAULT_WORKSPACE_PREFERENCES.featureFlags.savedFilters),
        customCommandPaletteShortcut:
          flag === 'customCommandPaletteShortcut'
            ? enabled
            : (state.globalPreferences.featureFlags
                ?.customCommandPaletteShortcut ??
              DEFAULT_WORKSPACE_PREFERENCES.featureFlags
                .customCommandPaletteShortcut),
      },
    })
  }

  const handleRepositorySubmit = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault()
    const savedFilters = fromTriState(repositorySavedFilters)
    const customShortcut = fromTriState(repositoryCustomShortcut)
    if (
      savedFilters === undefined &&
      customShortcut === undefined &&
      repositoryShortcut === 'inherit'
    ) {
      logger.warn('Rejected empty repository preference override')
      setError('Choose at least one repository override.')
      return
    }

    let normalizedKey: string
    try {
      normalizedKey = normalizeRepositoryKey(repositoryKey)
    } catch (caughtError) {
      logger.warn('Rejected invalid repository preference form', {
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError('Enter a repository in owner/repository format.')
      return
    }
    if (
      editingRepositoryKey === null &&
      state.repositoryPreferences.length >= MAX_REPOSITORY_PREFERENCE_COUNT
    ) {
      setError(
        `You can store up to ${MAX_REPOSITORY_PREFERENCE_COUNT} repository overrides.`,
      )
      return
    }

    const preferences: RepositoryWorkspacePreferences = {
      repositoryKey: normalizedKey,
      ...((savedFilters !== undefined || customShortcut !== undefined) && {
        featureFlags: {
          ...(savedFilters === undefined ? {} : { savedFilters }),
          ...(customShortcut === undefined
            ? {}
            : { customCommandPaletteShortcut: customShortcut }),
        },
      }),
      ...(repositoryShortcut === 'inherit'
        ? {}
        : { commandPaletteShortcut: repositoryShortcut }),
    }

    setOperation('repository-save')
    setError(null)
    logger.debug('Saving repository preference override', {
      repositoryKey: normalizedKey,
      hasFeatureFlags: preferences.featureFlags !== undefined,
      hasShortcut: preferences.commandPaletteShortcut !== undefined,
    })
    try {
      const result = await updateWorkspacePreferences({
        kind: 'repository-upsert',
        preferences,
      })
      if (result.status === 'error') {
        setError(operationErrorMessage(result.error))
        logger.warn(
          'Repository preference mutation returned an expected error',
          {
            repositoryKey: normalizedKey,
            code: result.error.code,
          },
        )
        return
      }
      setState((current) => ({ ...current, ...result.data }))
      resetRepositoryForm()
      logger.info('Updated repository preferences from settings', {
        repositoryKey: normalizedKey,
        repositoryCount: result.data.repositoryPreferences.length,
      })
    } catch (caughtError) {
      logger.error('Repository preference mutation failed unexpectedly', {
        repositoryKey: normalizedKey,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError('The repository override could not be processed. Try again.')
    } finally {
      setOperation(null)
    }
  }

  const handleEditRepository = (
    preferences: RepositoryWorkspacePreferences,
  ): void => {
    setEditingRepositoryKey(preferences.repositoryKey)
    setRepositoryKey(preferences.repositoryKey)
    setRepositorySavedFilters(
      toTriState(preferences.featureFlags?.savedFilters),
    )
    setRepositoryCustomShortcut(
      toTriState(preferences.featureFlags?.customCommandPaletteShortcut),
    )
    setRepositoryShortcut(preferences.commandPaletteShortcut ?? 'inherit')
    setError(null)
    logger.debug('Selected repository preferences for editing', {
      repositoryKey: preferences.repositoryKey,
      hasFeatureFlags: preferences.featureFlags !== undefined,
      hasShortcut: preferences.commandPaletteShortcut !== undefined,
    })
  }

  const handleDeleteRepository = async (key: string): Promise<void> => {
    setOperation('repository-delete')
    setError(null)
    logger.debug('Deleting repository preference override', {
      repositoryKey: key,
    })
    try {
      const result = await updateWorkspacePreferences({
        kind: 'repository-delete',
        repositoryKey: key,
      })
      if (result.status === 'error') {
        setError(operationErrorMessage(result.error))
        logger.warn(
          'Repository preference deletion returned an expected error',
          {
            repositoryKey: key,
            code: result.error.code,
          },
        )
        return
      }
      setState((current) => ({ ...current, ...result.data }))
      if (editingRepositoryKey === key) resetRepositoryForm()
      logger.info('Deleted repository preferences from settings', {
        repositoryKey: key,
        repositoryCount: result.data.repositoryPreferences.length,
      })
    } catch (caughtError) {
      logger.error('Repository preference deletion failed unexpectedly', {
        repositoryKey: key,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError('The repository override could not be deleted. Try again.')
    } finally {
      setOperation(null)
    }
  }

  const globalSavedFilters =
    state.globalPreferences.featureFlags?.savedFilters ??
    DEFAULT_WORKSPACE_PREFERENCES.featureFlags.savedFilters
  const globalCustomShortcut =
    state.globalPreferences.featureFlags?.customCommandPaletteShortcut ??
    DEFAULT_WORKSPACE_PREFERENCES.featureFlags.customCommandPaletteShortcut
  const globalShortcut =
    state.globalPreferences.commandPaletteShortcut ??
    DEFAULT_WORKSPACE_PREFERENCES.commandPaletteShortcut

  return (
    <section
      className="workspace-preferences-settings"
      aria-labelledby="workspace-preferences-heading"
      aria-busy={isBusy}
    >
      <header>
        <h2 id="workspace-preferences-heading">Workspace preferences</h2>
        <p>
          Saved inbox views and repository-specific behavior synced by the
          browser.
        </p>
      </header>

      {operation === 'load' ? (
        <p role="status">Loading workspace preferences...</p>
      ) : null}
      {error ? (
        <div className="workspace-preferences-settings__error" role="alert">
          <span>{error}</span>
          {operation === null && state === EMPTY_STATE ? (
            <button type="button" onClick={() => void loadState()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="workspace-preferences-settings__section">
        <div className="workspace-preferences-settings__section-heading">
          <div>
            <h3>Saved filters</h3>
            <p>Apply reusable criteria to one review inbox view.</p>
          </div>
          <span>
            {state.savedFilters.length} / {MAX_SAVED_FILTER_COUNT}
          </span>
        </div>
        <form
          className="workspace-preferences-settings__form"
          onSubmit={handleFilterSubmit}
        >
          <label htmlFor="saved-filter-name">Name</label>
          <input
            id="saved-filter-name"
            value={filterName}
            maxLength={MAX_SAVED_FILTER_NAME_LENGTH}
            disabled={isBusy}
            onChange={(event) => setFilterName(event.target.value)}
          />
          <label htmlFor="saved-filter-view">Inbox view</label>
          <select
            id="saved-filter-view"
            value={filterView}
            disabled={isBusy}
            onChange={(event) =>
              setFilterView(event.target.value as ReviewInboxView)
            }
          >
            {Object.entries(VIEW_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <label htmlFor="saved-filter-repositories">Repositories</label>
          <input
            id="saved-filter-repositories"
            value={filterRepositories}
            disabled={isBusy}
            placeholder="owner/repository, owner/another"
            onChange={(event) => setFilterRepositories(event.target.value)}
            aria-describedby="saved-filter-criteria-help"
          />
          <label htmlFor="saved-filter-authors">Authors</label>
          <input
            id="saved-filter-authors"
            value={filterAuthors}
            disabled={isBusy}
            placeholder="octocat, monalisa"
            onChange={(event) => setFilterAuthors(event.target.value)}
            aria-describedby="saved-filter-criteria-help"
          />
          <p
            id="saved-filter-criteria-help"
            className="workspace-preferences-settings__help"
          >
            Comma-separated, up to {MAX_SAVED_FILTER_CRITERION_COUNT} values per
            field.
          </p>
          <label htmlFor="saved-filter-draft-state">Draft state</label>
          <select
            id="saved-filter-draft-state"
            value={filterDraftState}
            disabled={isBusy}
            onChange={(event) =>
              setFilterDraftState(event.target.value as DraftStateFilter)
            }
          >
            <option value="any">Any</option>
            <option value="draft">Draft only</option>
            <option value="ready">Ready for review</option>
          </select>
          <div className="workspace-preferences-settings__form-actions">
            <button
              className="workspace-preferences-settings__primary"
              type="submit"
              disabled={
                isBusy ||
                (editingFilterId === null &&
                  state.savedFilters.length >= MAX_SAVED_FILTER_COUNT)
              }
            >
              {editingFilterId ? (
                <Save aria-hidden="true" size={16} />
              ) : (
                <Plus aria-hidden="true" size={16} />
              )}
              {editingFilterId ? 'Save filter' : 'Add filter'}
            </button>
            {editingFilterId ? (
              <button type="button" disabled={isBusy} onClick={resetFilterForm}>
                <X aria-hidden="true" size={16} />
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>
        {state.savedFilters.length === 0 && operation !== 'load' ? (
          <p className="workspace-preferences-settings__empty">
            No saved filters yet.
          </p>
        ) : null}
        <ul
          className="workspace-preferences-settings__list"
          aria-label="Saved inbox filters"
        >
          {state.savedFilters.map((filter) => (
            <li key={filter.id}>
              <div>
                <strong>{filter.name}</strong>
                <p>
                  {VIEW_LABELS[filter.view]} ·{' '}
                  {filter.criteria.repositories.length} repositories ·{' '}
                  {filter.criteria.authors.length} authors ·{' '}
                  {filter.criteria.draftState}
                </p>
              </div>
              <div className="workspace-preferences-settings__actions">
                <button
                  type="button"
                  aria-label={`Edit ${filter.name}`}
                  title={`Edit ${filter.name}`}
                  disabled={isBusy}
                  onClick={() => handleEditFilter(filter)}
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${filter.name}`}
                  title={`Delete ${filter.name}`}
                  disabled={isBusy}
                  onClick={() => void handleDeleteFilter(filter.id)}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="workspace-preferences-settings__section">
        <div className="workspace-preferences-settings__section-heading">
          <div>
            <h3>Global preferences</h3>
            <p>Defaults used when a repository has no override.</p>
          </div>
        </div>
        <label className="workspace-preferences-settings__toggle">
          <span>
            <strong>Saved filters</strong>
            <small>Show saved filters in the review inbox.</small>
          </span>
          <input
            type="checkbox"
            checked={globalSavedFilters}
            disabled={isBusy}
            onChange={(event) =>
              handleFeatureFlagChange('savedFilters', event.target.checked)
            }
          />
        </label>
        <label className="workspace-preferences-settings__toggle">
          <span>
            <strong>Custom command palette shortcut</strong>
            <small>Allow the configured shortcut instead of the default.</small>
          </span>
          <input
            type="checkbox"
            checked={globalCustomShortcut}
            disabled={isBusy}
            onChange={(event) =>
              handleFeatureFlagChange(
                'customCommandPaletteShortcut',
                event.target.checked,
              )
            }
          />
        </label>
        <div className="workspace-preferences-settings__inline-field">
          <label htmlFor="global-command-shortcut">
            Command palette shortcut
          </label>
          <select
            id="global-command-shortcut"
            value={globalShortcut}
            disabled={isBusy || !globalCustomShortcut}
            onChange={(event) =>
              void saveGlobalPreferences({
                ...state.globalPreferences,
                featureFlags: {
                  savedFilters: globalSavedFilters,
                  customCommandPaletteShortcut: globalCustomShortcut,
                },
                commandPaletteShortcut: event.target
                  .value as CommandPaletteShortcutId,
              })
            }
          >
            {SHORTCUT_OPTIONS.map((shortcut) => (
              <option key={shortcut.id} value={shortcut.id}>
                {shortcut.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="workspace-preferences-settings__section">
        <div className="workspace-preferences-settings__section-heading">
          <div>
            <h3>Repository overrides</h3>
            <p>Override global behavior for one canonical repository.</p>
          </div>
          <span>
            {state.repositoryPreferences.length} /{' '}
            {MAX_REPOSITORY_PREFERENCE_COUNT}
          </span>
        </div>
        <form
          className="workspace-preferences-settings__form"
          onSubmit={handleRepositorySubmit}
        >
          <label htmlFor="repository-override-key">Repository</label>
          <input
            id="repository-override-key"
            value={repositoryKey}
            disabled={isBusy || editingRepositoryKey !== null}
            placeholder="owner/repository"
            onChange={(event) => setRepositoryKey(event.target.value)}
          />
          <label htmlFor="repository-saved-filters">Saved filters</label>
          <select
            id="repository-saved-filters"
            value={repositorySavedFilters}
            disabled={isBusy}
            onChange={(event) =>
              setRepositorySavedFilters(event.target.value as TriState)
            }
          >
            <option value="inherit">Inherit</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <label htmlFor="repository-custom-shortcut">Custom shortcut</label>
          <select
            id="repository-custom-shortcut"
            value={repositoryCustomShortcut}
            disabled={isBusy}
            onChange={(event) =>
              setRepositoryCustomShortcut(event.target.value as TriState)
            }
          >
            <option value="inherit">Inherit</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <label htmlFor="repository-command-shortcut">Shortcut</label>
          <select
            id="repository-command-shortcut"
            value={repositoryShortcut}
            disabled={isBusy}
            onChange={(event) =>
              setRepositoryShortcut(event.target.value as ShortcutSelection)
            }
          >
            <option value="inherit">Inherit</option>
            {SHORTCUT_OPTIONS.map((shortcut) => (
              <option key={shortcut.id} value={shortcut.id}>
                {shortcut.label}
              </option>
            ))}
          </select>
          <div className="workspace-preferences-settings__form-actions">
            <button
              className="workspace-preferences-settings__primary"
              type="submit"
              disabled={
                isBusy ||
                (editingRepositoryKey === null &&
                  state.repositoryPreferences.length >=
                    MAX_REPOSITORY_PREFERENCE_COUNT)
              }
            >
              {editingRepositoryKey ? (
                <Save aria-hidden="true" size={16} />
              ) : (
                <Plus aria-hidden="true" size={16} />
              )}
              {editingRepositoryKey ? 'Save override' : 'Add override'}
            </button>
            {editingRepositoryKey ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={resetRepositoryForm}
              >
                <X aria-hidden="true" size={16} />
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>
        {state.repositoryPreferences.length === 0 && operation !== 'load' ? (
          <p className="workspace-preferences-settings__empty">
            No repository overrides.
          </p>
        ) : null}
        <ul
          className="workspace-preferences-settings__list"
          aria-label="Repository preference overrides"
        >
          {state.repositoryPreferences.map((preferences) => (
            <li key={preferences.repositoryKey}>
              <div>
                <strong>{preferences.repositoryKey}</strong>
                <p>
                  {Object.keys(preferences.featureFlags ?? {}).length} feature
                  flags ·{' '}
                  {preferences.commandPaletteShortcut
                    ? 'custom shortcut'
                    : 'inherited shortcut'}
                </p>
              </div>
              <div className="workspace-preferences-settings__actions">
                <button
                  type="button"
                  aria-label={`Edit ${preferences.repositoryKey}`}
                  title={`Edit ${preferences.repositoryKey}`}
                  disabled={isBusy}
                  onClick={() => handleEditRepository(preferences)}
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${preferences.repositoryKey}`}
                  title={`Delete ${preferences.repositoryKey}`}
                  disabled={isBusy}
                  onClick={() =>
                    void handleDeleteRepository(preferences.repositoryKey)
                  }
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
