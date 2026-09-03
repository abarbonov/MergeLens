import { Copy, FilePlus2, RefreshCw } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import { MAX_PULL_REQUEST_NOTE_LENGTH } from '@/modules/local-review'
import { logger as rootLogger } from '@/shared/logging'
import type {
  LocalReviewControllerError,
  LocalReviewPanelProps,
  LocalReviewSaveStatus,
} from './types'
import './LocalReviewPanel.css'

const logger = rootLogger.child({ scope: "localReview.ui" })

const SAVE_LABELS: Record<LocalReviewSaveStatus, string> = {
  idle: 'Ready',
  dirty: 'Unsaved changes',
  saving: 'Saving',
  saved: 'Saved',
  error: 'Save failed',
}

const errorTitle = (error: LocalReviewControllerError): string => {
  if (error.code === 'receiver-unavailable') {
    return 'MergeLens is reconnecting'
  }
  if (error.code === 'quota-exceeded') {
    return 'Local storage is full'
  }
  if (error.code === 'invalid-input') {
    return 'Note could not be saved'
  }
  return 'Local review is unavailable'
}

const stopEditorShortcut = (
  event: KeyboardEvent<HTMLTextAreaElement>,
): void => {
  event.stopPropagation()
}

export const LocalReviewPanel = ({ controller }: LocalReviewPanelProps) => {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  )
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  useEffect(() => {
    logger.debug('Local review panel state changed', {
      prKey: state.context.prKey,
      generation: state.generation,
      revision: state.revision,
      loadStatus: state.loadStatus,
      saveStatus: state.saveStatus,
      clipboardStatus: state.clipboardStatus,
      templateCount: state.templates.length,
      bodyLength: state.draft.length,
    })
  }, [state])

  useEffect(() => {
    setSelectedTemplateId((current) =>
      state.templates.some((template) => template.id === current)
        ? current
        : '',
    )
  }, [state.templates])

  const insertSelectedTemplate = (): void => {
    const editor = editorRef.current
    if (!editor || selectedTemplateId.length === 0) {
      return
    }

    const result = controller.insertTemplate(
      selectedTemplateId,
      editor.selectionStart,
      editor.selectionEnd,
    )
    if (!result.inserted) {
      return
    }

    requestAnimationFrame(() => {
      editor.focus()
      editor.setSelectionRange(result.cursorPosition, result.cursorPosition)
    })
  }

  if (state.loadStatus === 'loading') {
    return (
      <section className="local-review" aria-label="Local review workspace">
        <div className="local-review__loading" role="status" aria-live="polite">
          <span className="local-review__spinner" aria-hidden="true" />
          <span>Loading your private review workspace</span>
        </div>
      </section>
    )
  }

  if (state.loadStatus === 'error' && state.loadError) {
    return (
      <section className="local-review" aria-label="Local review workspace">
        <div className="local-review__error" role="alert">
          <div>
            <strong>{errorTitle(state.loadError)}</strong>
            <span>{state.loadError.message}</span>
          </div>
          <button
            className="local-review__button"
            type="button"
            onClick={controller.retry}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Retry
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="local-review" aria-label="Local review workspace">
      <header className="local-review__header">
        <div>
          <h2>Private review notes</h2>
          <p>Stored only in this browser profile</p>
        </div>
        <span
          className={`local-review__save-status local-review__save-status--${state.saveStatus}`}
          role="status"
          aria-live="polite"
        >
          {SAVE_LABELS[state.saveStatus]}
        </span>
      </header>

      <div className="local-review__editor-group">
        <div className="local-review__label-row">
          <label htmlFor="mergelens-local-review-note">Pull request note</label>
          <span>
            {state.draft.length.toLocaleString()} /{' '}
            {MAX_PULL_REQUEST_NOTE_LENGTH.toLocaleString()}
          </span>
        </div>
        <textarea
          ref={editorRef}
          id="mergelens-local-review-note"
          className="local-review__editor"
          value={state.draft}
          maxLength={MAX_PULL_REQUEST_NOTE_LENGTH}
          rows={7}
          aria-invalid={Boolean(state.validationMessage)}
          aria-describedby={
            state.validationMessage
              ? 'mergelens-local-review-validation'
              : undefined
          }
          placeholder="Keep review observations, follow-ups, and draft feedback here"
          onChange={(event) => controller.setDraft(event.target.value)}
          onCompositionStart={(event) => event.stopPropagation()}
          onCompositionEnd={(event) => event.stopPropagation()}
          onKeyDown={stopEditorShortcut}
          onKeyUp={stopEditorShortcut}
        />
      </div>

      {state.validationMessage ? (
        <p
          id="mergelens-local-review-validation"
          className="local-review__validation"
          role="alert"
        >
          {state.validationMessage}
        </p>
      ) : null}

      {state.saveStatus === 'error' &&
      state.saveError &&
      !state.validationMessage ? (
        <div className="local-review__inline-error" role="alert">
          <span>
            {errorTitle(state.saveError)}. {state.saveError.message}
          </span>
          <button
            className="local-review__text-button"
            type="button"
            onClick={controller.retry}
          >
            Retry save
          </button>
        </div>
      ) : null}

      <div className="local-review__tools">
        <div className="local-review__template-tool">
          <label htmlFor="mergelens-local-review-template">
            Review template
          </label>
          <div className="local-review__template-controls">
            <select
              id="mergelens-local-review-template"
              value={selectedTemplateId}
              disabled={state.templates.length === 0}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
            >
              <option value="">
                {state.templates.length === 0
                  ? 'No templates available'
                  : 'Choose a template'}
              </option>
              {state.templates.map((template) => (
                <option value={template.id} key={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
            <button
              className="local-review__button"
              type="button"
              disabled={selectedTemplateId.length === 0}
              onClick={insertSelectedTemplate}
            >
              <FilePlus2 size={15} aria-hidden="true" />
              Insert
            </button>
          </div>
        </div>

        <button
          className="local-review__button local-review__copy"
          type="button"
          disabled={state.draft.length === 0}
          onClick={() => void controller.copyDraft()}
        >
          <Copy size={15} aria-hidden="true" />
          Copy note
        </button>
      </div>

      <div className="local-review__feedback" aria-live="polite">
        {state.clipboardStatus === 'success'
          ? 'Note copied to clipboard'
          : null}
        {state.clipboardStatus === 'error' ? state.clipboardError : null}
        {state.draft.length === 0 && state.templates.length === 0
          ? 'Start a note or create reusable templates in MergeLens settings.'
          : null}
      </div>
    </section>
  )
}
