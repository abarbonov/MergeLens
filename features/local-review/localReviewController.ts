import {
  MAX_PULL_REQUEST_NOTE_LENGTH,
  createPullRequestKey,
  type CanonicalPullRequestIdentity,
  type PullRequestIdentity,
} from '@/modules/local-review'
import { logger as rootLogger } from '@/shared/logging'
import {
  createCorrelationId,
  isReceiverUnavailableError,
  parseGetLocalReviewWorkspaceResponse,
  parseSavePullRequestNoteResponse,
  sendMessage,
} from '@/shared/messaging/protocol'
import type {
  InsertTemplateResult,
  LocalReviewController,
  LocalReviewControllerError,
  LocalReviewControllerOptions,
  LocalReviewState,
  LocalReviewTransport,
} from './types'

const logger = rootLogger.child({ scope: "localReview.controller" })
const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 600

interface SaveSnapshot {
  context: CanonicalPullRequestIdentity
  body: string
  generation: number
  revision: number
}

const defaultTransport: LocalReviewTransport = {
  loadWorkspace: async (context, correlationId) => {
    return parseGetLocalReviewWorkspaceResponse(
      await sendMessage('getLocalReviewWorkspace', { context, correlationId }),
    )
  },
  saveNote: async (context, body, correlationId) => {
    return parseSavePullRequestNoteResponse(
      await sendMessage('savePullRequestNote', {
        context,
        correlationId,
        body,
      }),
    )
  },
  writeClipboard: async (text) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }
    await navigator.clipboard.writeText(text)
  },
}

const createInitialState = (
  context: CanonicalPullRequestIdentity,
  generation: number,
): LocalReviewState => ({
  context,
  generation,
  revision: 0,
  loadStatus: 'loading',
  saveStatus: 'idle',
  clipboardStatus: 'idle',
  draft: '',
  templates: [],
  loadError: null,
  saveError: null,
  clipboardError: null,
  validationMessage: null,
})

const unexpectedError = (error: unknown): LocalReviewControllerError => {
  if (isReceiverUnavailableError(error)) {
    return {
      code: 'receiver-unavailable',
      message: 'MergeLens background service is unavailable',
    }
  }

  return {
    code: 'invalid-response',
    message: 'Local review data could not be processed',
  }
}

export const createLocalReviewController = (
  initialContext: PullRequestIdentity,
  options: LocalReviewControllerOptions = {},
): LocalReviewController => {
  const transport = options.transport ?? defaultTransport
  const nextCorrelationId = options.createCorrelationId ?? createCorrelationId
  const debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS
  const listeners = new Set<() => void>()
  const saveTails = new Map<string, Promise<void>>()
  let state = createInitialState(createPullRequestKey(initialContext), 1)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let requestSequence = 0
  let isDisposed = false

  const emit = (nextState: LocalReviewState): void => {
    state = nextState
    listeners.forEach((listener) => listener())
  }

  const isCurrent = (
    context: CanonicalPullRequestIdentity,
    generation: number,
  ): boolean => {
    return (
      state.context.prKey === context.prKey && state.generation === generation
    )
  }

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  const loadWorkspace = async (
    context: CanonicalPullRequestIdentity,
    generation: number,
  ): Promise<void> => {
    const correlationId = nextCorrelationId()
    const sequence = ++requestSequence
    logger.info('Loading local review workspace', {
      correlationId,
      sequence,
      generation,
      prKey: context.prKey,
    })

    try {
      const response = await transport.loadWorkspace(context, correlationId)
      if (!isCurrent(context, generation) || isDisposed) {
        logger.debug('Ignored stale local review workspace response', {
          correlationId,
          sequence,
          generation,
          prKey: context.prKey,
        })
        return
      }

      if (response.correlationId !== correlationId) {
        logger.warn('Rejected mismatched local review workspace response', {
          correlationId,
          responseCorrelationId: response.correlationId,
          sequence,
          generation,
          prKey: context.prKey,
        })
        emit({
          ...state,
          loadStatus: 'error',
          loadError: {
            code: 'invalid-response',
            message: 'Local review response did not match the request',
          },
        })
        return
      }

      if (response.status === 'error') {
        logger.warn('Local review workspace returned a recoverable error', {
          correlationId,
          sequence,
          generation,
          prKey: context.prKey,
          code: response.error.code,
        })
        emit({ ...state, loadStatus: 'error', loadError: response.error })
        return
      }

      logger.info('Local review workspace loaded', {
        correlationId,
        sequence,
        generation,
        prKey: context.prKey,
        hasNote: Boolean(response.data.note),
        templateCount: response.data.templates.length,
        bodyLength: response.data.note?.body.length ?? 0,
      })
      emit({
        ...state,
        loadStatus: 'ready',
        loadError: null,
        draft: response.data.note?.body ?? '',
        templates: response.data.templates,
        revision: 0,
        saveStatus: 'idle',
      })
    } catch (caughtError) {
      if (!isCurrent(context, generation) || isDisposed) {
        logger.debug('Ignored stale failed workspace request', {
          correlationId,
          sequence,
          generation,
          prKey: context.prKey,
        })
        return
      }

      const error = unexpectedError(caughtError)
      const log =
        error.code === 'receiver-unavailable' ? logger.warn : logger.error
      log('Local review workspace request failed', {
        correlationId,
        sequence,
        generation,
        prKey: context.prKey,
        code: error.code,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      emit({ ...state, loadStatus: 'error', loadError: error })
    }
  }

  const performSave = async (snapshot: SaveSnapshot): Promise<void> => {
    const correlationId = nextCorrelationId()
    const sequence = ++requestSequence
    if (isCurrent(snapshot.context, snapshot.generation)) {
      emit({ ...state, saveStatus: 'saving', saveError: null })
    }
    logger.info('Saving local review draft', {
      correlationId,
      sequence,
      generation: snapshot.generation,
      revision: snapshot.revision,
      prKey: snapshot.context.prKey,
      bodyLength: snapshot.body.length,
    })

    try {
      const response = await transport.saveNote(
        snapshot.context,
        snapshot.body,
        correlationId,
      )
      if (response.correlationId !== correlationId) {
        if (
          isCurrent(snapshot.context, snapshot.generation) &&
          state.revision === snapshot.revision &&
          !isDisposed
        ) {
          logger.warn('Rejected mismatched local review save response', {
            correlationId,
            responseCorrelationId: response.correlationId,
            sequence,
            generation: snapshot.generation,
            revision: snapshot.revision,
            prKey: snapshot.context.prKey,
          })
          emit({
            ...state,
            saveStatus: 'error',
            saveError: {
              code: 'invalid-response',
              message: 'Local review save response did not match the request',
            },
          })
        }
        return
      }
      const canApply =
        isCurrent(snapshot.context, snapshot.generation) &&
        state.revision === snapshot.revision &&
        !isDisposed

      if (!canApply) {
        logger.debug('Ignored stale local review save response', {
          correlationId,
          sequence,
          generation: snapshot.generation,
          revision: snapshot.revision,
          prKey: snapshot.context.prKey,
          status: response.status,
        })
        return
      }

      if (response.status === 'error') {
        logger.warn('Local review save returned a recoverable error', {
          correlationId,
          sequence,
          generation: snapshot.generation,
          revision: snapshot.revision,
          prKey: snapshot.context.prKey,
          code: response.error.code,
        })
        emit({ ...state, saveStatus: 'error', saveError: response.error })
        return
      }

      logger.info('Local review draft saved', {
        correlationId,
        sequence,
        generation: snapshot.generation,
        revision: snapshot.revision,
        prKey: snapshot.context.prKey,
        isPresent: Boolean(response.data.note),
      })
      emit({ ...state, saveStatus: 'saved', saveError: null })
    } catch (caughtError) {
      if (
        !isCurrent(snapshot.context, snapshot.generation) ||
        state.revision !== snapshot.revision ||
        isDisposed
      ) {
        logger.debug('Ignored stale failed local review save', {
          correlationId,
          sequence,
          generation: snapshot.generation,
          revision: snapshot.revision,
          prKey: snapshot.context.prKey,
        })
        return
      }

      const error = unexpectedError(caughtError)
      const log =
        error.code === 'receiver-unavailable' ? logger.warn : logger.error
      log('Local review save failed', {
        correlationId,
        sequence,
        generation: snapshot.generation,
        revision: snapshot.revision,
        prKey: snapshot.context.prKey,
        code: error.code,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      emit({ ...state, saveStatus: 'error', saveError: error })
    }
  }

  const queueSave = (snapshot: SaveSnapshot): Promise<void> => {
    const previous = saveTails.get(snapshot.context.prKey) ?? Promise.resolve()
    const queued = previous.then(() => performSave(snapshot))
    saveTails.set(snapshot.context.prKey, queued)
    void queued.finally(() => {
      if (saveTails.get(snapshot.context.prKey) === queued) {
        saveTails.delete(snapshot.context.prKey)
      }
    })
    return queued
  }

  const currentSnapshot = (): SaveSnapshot => ({
    context: state.context,
    body: state.draft,
    generation: state.generation,
    revision: state.revision,
  })

  const scheduleSave = (): void => {
    clearDebounce()
    const snapshot = currentSnapshot()
    logger.debug('Scheduled local review autosave', {
      generation: snapshot.generation,
      revision: snapshot.revision,
      prKey: snapshot.context.prKey,
      bodyLength: snapshot.body.length,
      debounceMs,
    })
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void queueSave(snapshot)
    }, debounceMs)
  }

  const setDraft = (draft: string): void => {
    if (draft.length > MAX_PULL_REQUEST_NOTE_LENGTH) {
      const message = `Note cannot exceed ${MAX_PULL_REQUEST_NOTE_LENGTH} characters`
      logger.warn('Rejected oversized local review draft', {
        prKey: state.context.prKey,
        bodyLength: draft.length,
        maxLength: MAX_PULL_REQUEST_NOTE_LENGTH,
      })
      emit({
        ...state,
        validationMessage: message,
        saveStatus: 'error',
        saveError: { code: 'invalid-input', message },
      })
      return
    }

    const revision = state.revision + 1
    emit({
      ...state,
      draft,
      revision,
      saveStatus: 'dirty',
      saveError: null,
      validationMessage: null,
      clipboardStatus: 'idle',
      clipboardError: null,
    })
    logger.debug('Local review draft changed', {
      generation: state.generation,
      revision,
      prKey: state.context.prKey,
      bodyLength: draft.length,
    })
    scheduleSave()
  }

  const insertTemplate = (
    templateId: string,
    selectionStart: number,
    selectionEnd: number,
  ): InsertTemplateResult => {
    const template = state.templates.find(
      (candidate) => candidate.id === templateId,
    )
    if (!template) {
      logger.warn('Ignored unavailable local review template insertion', {
        prKey: state.context.prKey,
        templateId,
        templateCount: state.templates.length,
      })
      return { inserted: false, cursorPosition: selectionStart }
    }

    const insertionPoint = Math.max(
      0,
      Math.min(selectionStart, state.draft.length),
    )
    const preservedSelectionLength = Math.max(0, selectionEnd - selectionStart)
    const draft =
      state.draft.slice(0, insertionPoint) +
      template.body +
      state.draft.slice(insertionPoint)
    if (draft.length > MAX_PULL_REQUEST_NOTE_LENGTH) {
      const message = 'Template would make the note too long'
      logger.warn('Rejected oversized local review template insertion', {
        prKey: state.context.prKey,
        templateId,
        bodyLength: draft.length,
        maxLength: MAX_PULL_REQUEST_NOTE_LENGTH,
      })
      emit({ ...state, validationMessage: message })
      return { inserted: false, cursorPosition: insertionPoint }
    }

    logger.info('Inserted local review template into draft', {
      prKey: state.context.prKey,
      templateId,
      insertionPoint,
      templateBodyLength: template.body.length,
      preservedSelectionLength,
      bodyLength: draft.length,
    })
    setDraft(draft)
    return {
      inserted: true,
      cursorPosition: insertionPoint + template.body.length,
    }
  }

  const reconcileContext = (contextInput: PullRequestIdentity): void => {
    const context = createPullRequestKey(contextInput)
    if (context.prKey === state.context.prKey) {
      logger.debug('Preserved local review draft for matching PR context', {
        prKey: context.prKey,
        generation: state.generation,
        revision: state.revision,
      })
      return
    }

    clearDebounce()
    if (state.loadStatus === 'ready' && state.saveStatus === 'dirty') {
      const snapshot = currentSnapshot()
      logger.info('Flushing queued draft during PR context change', {
        prKey: snapshot.context.prKey,
        generation: snapshot.generation,
        revision: snapshot.revision,
        bodyLength: snapshot.body.length,
      })
      void queueSave(snapshot)
    }

    const generation = state.generation + 1
    logger.info('Reconciled local review PR context', {
      previousPrKey: state.context.prKey,
      nextPrKey: context.prKey,
      generation,
    })
    emit(createInitialState(context, generation))
    void loadWorkspace(context, generation)
  }

  const retry = (): void => {
    if (state.loadStatus === 'error') {
      logger.info('Retrying local review workspace load', {
        prKey: state.context.prKey,
        generation: state.generation,
      })
      emit({ ...state, loadStatus: 'loading', loadError: null })
      void loadWorkspace(state.context, state.generation)
      return
    }

    if (state.saveStatus === 'error' && state.validationMessage === null) {
      logger.info('Retrying local review draft save', {
        prKey: state.context.prKey,
        generation: state.generation,
        revision: state.revision,
      })
      void queueSave(currentSnapshot())
    }
  }

  const copyDraft = async (): Promise<void> => {
    const body = state.draft
    const context = state.context
    const generation = state.generation
    logger.debug('Copying local review draft', {
      prKey: context.prKey,
      generation,
      bodyLength: body.length,
    })
    try {
      await transport.writeClipboard(body)
      if (
        !isDisposed &&
        isCurrent(context, generation) &&
        body === state.draft
      ) {
        logger.info('Local review draft copied', {
          prKey: context.prKey,
          generation,
          bodyLength: body.length,
        })
        emit({ ...state, clipboardStatus: 'success', clipboardError: null })
      }
    } catch (error) {
      logger.warn('Local review clipboard write failed', {
        prKey: context.prKey,
        generation,
        bodyLength: body.length,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      if (
        !isDisposed &&
        isCurrent(context, generation) &&
        body === state.draft
      ) {
        emit({
          ...state,
          clipboardStatus: 'error',
          clipboardError: 'Could not copy the note. Try again.',
        })
      }
    }
  }

  const flush = async (): Promise<void> => {
    clearDebounce()
    const pending = [...saveTails.values()]
    if (state.loadStatus === 'ready' && state.saveStatus === 'dirty') {
      pending.push(queueSave(currentSnapshot()))
    }
    await Promise.all(pending)
  }

  const dispose = async (): Promise<void> => {
    listeners.clear()
    await flush()
    isDisposed = true
    logger.debug('Local review controller disposed', {
      prKey: state.context.prKey,
      generation: state.generation,
      revision: state.revision,
    })
  }

  void loadWorkspace(state.context, state.generation)

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    reconcileContext,
    setDraft,
    insertTemplate,
    retry,
    copyDraft,
    flush,
    dispose,
  }
}
