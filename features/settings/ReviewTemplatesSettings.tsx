import { Pencil, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  MAX_REVIEW_TEMPLATE_BODY_LENGTH,
  MAX_REVIEW_TEMPLATE_COUNT,
  MAX_REVIEW_TEMPLATE_TITLE_LENGTH,
  type LocalReviewErrorCode,
  type ReviewTemplate,
  type ReviewTemplateDraft,
} from '@/modules/local-review'
import { logger as rootLogger } from '@/shared/logging'
import {
  createCorrelationId,
  isReceiverUnavailableError,
  parseDeleteReviewTemplateResponse,
  parseListReviewTemplatesResponse,
  parseUpsertReviewTemplateResponse,
  sendMessage,
} from '@/shared/messaging/protocol'
import './ReviewTemplatesSettings.css'

const logger = rootLogger.child({ scope: "settings.reviewTemplates" })

type TemplatesOperation = 'load' | 'save' | 'delete'

export interface ReviewTemplatesTransport {
  listTemplates: (correlationId: string) => Promise<{
    status: 'success' | 'error'
    correlationId: string
    data?: { templates: ReviewTemplate[] }
    error?: { code: LocalReviewErrorCode; message: string }
  }>
  upsertTemplate: (
    template: ReviewTemplateDraft,
    correlationId: string,
  ) => Promise<{
    status: 'success' | 'error'
    correlationId: string
    data?: { template: ReviewTemplate; templates: ReviewTemplate[] }
    error?: { code: LocalReviewErrorCode; message: string }
  }>
  deleteTemplate: (
    templateId: string,
    correlationId: string,
  ) => Promise<{
    status: 'success' | 'error'
    correlationId: string
    data?: { templates: ReviewTemplate[] }
    error?: { code: LocalReviewErrorCode; message: string }
  }>
}

interface ReviewTemplatesSettingsProps {
  transport?: ReviewTemplatesTransport
  nextCorrelationId?: () => string
}

const defaultTransport: ReviewTemplatesTransport = {
  listTemplates: async (correlationId) =>
    parseListReviewTemplatesResponse(
      await sendMessage('listReviewTemplates', { correlationId }),
    ),
  upsertTemplate: async (template, correlationId) =>
    parseUpsertReviewTemplateResponse(
      await sendMessage('upsertReviewTemplate', { correlationId, template }),
    ),
  deleteTemplate: async (templateId, correlationId) =>
    parseDeleteReviewTemplateResponse(
      await sendMessage('deleteReviewTemplate', {
        correlationId,
        templateId,
      }),
    ),
}

const operationErrorMessage = (code: LocalReviewErrorCode): string => {
  if (code === 'quota-exceeded') {
    return 'Local storage is full. Remove an unused template and try again.'
  }
  if (code === 'invalid-input') {
    return 'The template could not be saved. Check the title and body.'
  }
  return 'Local review storage is unavailable. Try again.'
}

const unexpectedErrorMessage = (error: unknown): string => {
  return isReceiverUnavailableError(error)
    ? 'MergeLens background is unavailable. Reload the page and try again.'
    : 'Review templates could not be processed. Try again.'
}

const validateDraft = (title: string, body: string): string | null => {
  const normalizedTitle = title.trim()
  if (normalizedTitle.length === 0) {
    return 'Enter a template title.'
  }
  if (normalizedTitle.length > MAX_REVIEW_TEMPLATE_TITLE_LENGTH) {
    return `Title cannot exceed ${MAX_REVIEW_TEMPLATE_TITLE_LENGTH} characters.`
  }
  if (body.trim().length === 0) {
    return 'Enter template content.'
  }
  if (body.length > MAX_REVIEW_TEMPLATE_BODY_LENGTH) {
    return `Template content cannot exceed ${MAX_REVIEW_TEMPLATE_BODY_LENGTH.toLocaleString()} characters.`
  }
  return null
}

export const ReviewTemplatesSettings = ({
  transport = defaultTransport,
  nextCorrelationId = createCorrelationId,
}: ReviewTemplatesSettingsProps) => {
  const [templates, setTemplates] = useState<ReviewTemplate[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [operation, setOperation] = useState<TemplatesOperation | null>('load')
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const resetForm = (): void => {
    setEditingId(null)
    setTitle('')
    setBody('')
  }

  const loadTemplates = async (): Promise<void> => {
    const correlationId = nextCorrelationId()
    const sequence = ++requestSequence.current
    setOperation('load')
    setError(null)
    logger.info('Loading review templates for settings', {
      correlationId,
      sequence,
    })

    try {
      const response = await transport.listTemplates(correlationId)
      if (sequence !== requestSequence.current) {
        logger.debug('Ignored stale review template list response', {
          correlationId,
          sequence,
        })
        return
      }
      if (response.correlationId !== correlationId) {
        throw new Error('Review template list correlation mismatch')
      }
      if (response.status === 'error' && response.error) {
        logger.warn('Review template list returned an expected error', {
          correlationId,
          sequence,
          code: response.error.code,
        })
        setError(operationErrorMessage(response.error.code))
        return
      }
      if (response.status !== 'success' || !response.data) {
        throw new Error('Review template list response is incomplete')
      }

      setTemplates(response.data.templates)
      logger.info('Review templates loaded for settings', {
        correlationId,
        sequence,
        templateCount: response.data.templates.length,
      })
    } catch (caughtError) {
      const log = isReceiverUnavailableError(caughtError)
        ? logger.warn
        : logger.error
      log('Review template list request failed', {
        correlationId,
        sequence,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      if (sequence === requestSequence.current) {
        setError(unexpectedErrorMessage(caughtError))
      }
    } finally {
      if (sequence === requestSequence.current) {
        setOperation(null)
      }
    }
  }

  useEffect(() => {
    void loadTemplates()
    return () => {
      requestSequence.current += 1
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationMessage = validateDraft(title, body)
    if (validationMessage) {
      logger.warn('Rejected invalid review template form', {
        templateId: editingId ?? undefined,
        titleLength: title.trim().length,
        bodyLength: body.length,
      })
      setError(validationMessage)
      return
    }
    if (editingId === null && templates.length >= MAX_REVIEW_TEMPLATE_COUNT) {
      logger.warn('Rejected review template creation at count limit', {
        templateCount: templates.length,
        maxCount: MAX_REVIEW_TEMPLATE_COUNT,
      })
      setError(`You can store up to ${MAX_REVIEW_TEMPLATE_COUNT} templates.`)
      return
    }

    const correlationId = nextCorrelationId()
    const template = {
      id: editingId ?? undefined,
      title: title.trim(),
      body,
    }
    setOperation('save')
    setError(null)
    logger.info('Saving review template from settings', {
      correlationId,
      templateId: editingId ?? undefined,
      titleLength: template.title.length,
      bodyLength: template.body.length,
      isEditing: editingId !== null,
    })

    try {
      const response = await transport.upsertTemplate(template, correlationId)
      if (response.correlationId !== correlationId) {
        throw new Error('Review template upsert correlation mismatch')
      }
      if (response.status === 'error' && response.error) {
        logger.warn('Review template upsert returned an expected error', {
          correlationId,
          templateId: editingId ?? undefined,
          code: response.error.code,
        })
        setError(operationErrorMessage(response.error.code))
        return
      }
      if (response.status !== 'success' || !response.data) {
        throw new Error('Review template upsert response is incomplete')
      }

      setTemplates(response.data.templates)
      resetForm()
      logger.info('Review template saved from settings', {
        correlationId,
        templateId: response.data.template.id,
        templateCount: response.data.templates.length,
      })
    } catch (caughtError) {
      const log = isReceiverUnavailableError(caughtError)
        ? logger.warn
        : logger.error
      log('Review template upsert request failed', {
        correlationId,
        templateId: editingId ?? undefined,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError(unexpectedErrorMessage(caughtError))
    } finally {
      setOperation(null)
    }
  }

  const handleEdit = (template: ReviewTemplate): void => {
    setEditingId(template.id)
    setTitle(template.title)
    setBody(template.body)
    setPendingDeleteId(null)
    setError(null)
    logger.debug('Selected review template for editing', {
      templateId: template.id,
      titleLength: template.title.length,
      bodyLength: template.body.length,
    })
  }

  const handleDelete = async (): Promise<void> => {
    if (!pendingDeleteId) {
      logger.debug('Ignored review template deletion without selection')
      return
    }

    const templateId = pendingDeleteId
    const correlationId = nextCorrelationId()
    setOperation('delete')
    setError(null)
    logger.info('Deleting review template from settings', {
      correlationId,
      templateId,
    })

    try {
      const response = await transport.deleteTemplate(templateId, correlationId)
      if (response.correlationId !== correlationId) {
        throw new Error('Review template deletion correlation mismatch')
      }
      if (response.status === 'error' && response.error) {
        logger.warn('Review template deletion returned an expected error', {
          correlationId,
          templateId,
          code: response.error.code,
        })
        setError(operationErrorMessage(response.error.code))
        return
      }
      if (response.status !== 'success' || !response.data) {
        throw new Error('Review template deletion response is incomplete')
      }

      setTemplates(response.data.templates)
      if (editingId === templateId) {
        resetForm()
      }
      setPendingDeleteId(null)
      logger.info('Review template deleted from settings', {
        correlationId,
        templateId,
        templateCount: response.data.templates.length,
      })
    } catch (caughtError) {
      const log = isReceiverUnavailableError(caughtError)
        ? logger.warn
        : logger.error
      log('Review template deletion request failed', {
        correlationId,
        templateId,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      setError(unexpectedErrorMessage(caughtError))
    } finally {
      setOperation(null)
    }
  }

  const isBusy = operation !== null
  const pendingDeleteTemplate = templates.find(
    (template) => template.id === pendingDeleteId,
  )

  return (
    <section
      className="review-templates-settings"
      aria-labelledby="review-templates-heading"
      aria-busy={isBusy}
    >
      <header>
        <div>
          <h2 id="review-templates-heading">Review templates</h2>
          <p>Reusable feedback stored only in this browser profile.</p>
        </div>
        <span className="review-templates-settings__count">
          {templates.length} / {MAX_REVIEW_TEMPLATE_COUNT}
        </span>
      </header>

      <form className="review-templates-settings__form" onSubmit={handleSubmit}>
        <div className="review-templates-settings__field">
          <label htmlFor="review-template-title">Title</label>
          <input
            id="review-template-title"
            value={title}
            maxLength={MAX_REVIEW_TEMPLATE_TITLE_LENGTH}
            disabled={isBusy}
            onChange={(event) => {
              setTitle(event.target.value)
              setError(null)
            }}
          />
          <span>
            {title.length} / {MAX_REVIEW_TEMPLATE_TITLE_LENGTH}
          </span>
        </div>
        <div className="review-templates-settings__field">
          <label htmlFor="review-template-body">Template content</label>
          <textarea
            id="review-template-body"
            value={body}
            maxLength={MAX_REVIEW_TEMPLATE_BODY_LENGTH}
            rows={6}
            disabled={isBusy}
            onChange={(event) => {
              setBody(event.target.value)
              setError(null)
            }}
          />
          <span>
            {body.length.toLocaleString()} /{' '}
            {MAX_REVIEW_TEMPLATE_BODY_LENGTH.toLocaleString()}
          </span>
        </div>
        <div className="review-templates-settings__form-actions">
          <button
            className="review-templates-settings__primary"
            type="submit"
            disabled={
              isBusy ||
              (editingId === null &&
                templates.length >= MAX_REVIEW_TEMPLATE_COUNT)
            }
          >
            {editingId ? (
              <Save aria-hidden="true" size={16} />
            ) : (
              <Plus aria-hidden="true" size={16} />
            )}
            {editingId ? 'Save template' : 'Add template'}
          </button>
          {editingId ? (
            <button type="button" disabled={isBusy} onClick={resetForm}>
              <X aria-hidden="true" size={16} />
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>

      {operation === 'load' ? (
        <p className="review-templates-settings__status" role="status">
          Loading review templates
        </p>
      ) : null}
      {operation === 'save' ? (
        <p className="review-templates-settings__status" role="status">
          Saving template
        </p>
      ) : null}
      {operation === 'delete' ? (
        <p className="review-templates-settings__status" role="status">
          Deleting template
        </p>
      ) : null}
      {error ? (
        <div className="review-templates-settings__error" role="alert">
          <span>{error}</span>
          {templates.length === 0 && !isBusy ? (
            <button type="button" onClick={() => void loadTemplates()}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {templates.length === 0 && !isBusy && !error ? (
        <p className="review-templates-settings__empty" role="status">
          No review templates yet.
        </p>
      ) : null}

      <ul
        className="review-templates-settings__list"
        aria-label="Saved review templates"
      >
        {templates.map((template) => (
          <li key={template.id}>
            <div className="review-templates-settings__summary">
              <strong>{template.title}</strong>
              <p>{template.body.slice(0, 180)}</p>
            </div>
            <div className="review-templates-settings__actions">
              <button
                type="button"
                aria-label={`Edit ${template.title}`}
                title={`Edit ${template.title}`}
                disabled={isBusy}
                onClick={() => handleEdit(template)}
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${template.title}`}
                title={`Delete ${template.title}`}
                disabled={isBusy}
                onClick={() => {
                  setPendingDeleteId(template.id)
                  logger.debug(
                    'Requested review template deletion confirmation',
                    {
                      templateId: template.id,
                    },
                  )
                }}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pendingDeleteTemplate ? (
        <div
          className="review-templates-settings__confirmation-backdrop"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !isBusy) {
              setPendingDeleteId(null)
            }
          }}
        >
          <div
            className="review-templates-settings__confirmation"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="review-template-delete-title"
            aria-describedby="review-template-delete-description"
          >
            <strong id="review-template-delete-title">Delete template?</strong>
            <p id="review-template-delete-description">
              {pendingDeleteTemplate.title} will be removed from this browser
              profile.
            </p>
            <div>
              <button
                type="button"
                autoFocus
                disabled={isBusy}
                onClick={() => setPendingDeleteId(null)}
              >
                Cancel
              </button>
              <button
                className="review-templates-settings__danger"
                type="button"
                disabled={isBusy}
                onClick={() => void handleDelete()}
              >
                <Trash2 aria-hidden="true" size={15} />
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
