import { DatabaseBackup, Download, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import type {
  ApplyPortableLocalDataImportInput,
  ApplyPortableLocalDataImportResult,
  ExportPortableLocalDataResult,
  PortableDataConflictCategory,
  PortableDataConflictDecision,
  PortableDataConflictDecisions,
  PortableLocalDataCounts,
  PortableLocalDataError,
  PortableLocalDataImportPreview,
  PreviewPortableLocalDataImportResult,
} from '@/modules/portable-local-data'
import { logger as rootLogger } from '@/shared/logging'
import './PortableLocalDataSettings.css'

const logger = rootLogger.child({ scope: "settings.portableLocalData" })

const CATEGORIES: readonly PortableDataConflictCategory[] = [
  'notes',
  'reviewTemplates',
  'savedFilters',
  'globalWorkspacePreferences',
  'repositoryWorkspacePreferences',
  'reviewNotificationPreferences',
]

const CATEGORY_LABELS: Record<PortableDataConflictCategory, string> = {
  notes: 'Pull request notes',
  reviewTemplates: 'Review templates',
  savedFilters: 'Saved filters',
  globalWorkspacePreferences: 'Global workspace preferences',
  repositoryWorkspacePreferences: 'Repository preferences',
  reviewNotificationPreferences: 'Review notification preferences',
}

type Operation = 'export' | 'preview' | 'import'

interface Notice {
  tone: 'success' | 'warning'
  message: string
}

export interface PortableLocalDataSettingsServices {
  exportData(): Promise<ExportPortableLocalDataResult>
  previewImport(input: string): Promise<PreviewPortableLocalDataImportResult>
  applyImport(
    input: ApplyPortableLocalDataImportInput,
  ): Promise<ApplyPortableLocalDataImportResult>
}

interface PortableLocalDataSettingsProps {
  services: PortableLocalDataSettingsServices
}

const totalCount = (counts: PortableLocalDataCounts): number =>
  Object.values(counts).reduce((total, count) => total + count, 0)

const conflictCount = (
  preview: PortableLocalDataImportPreview,
  category: PortableDataConflictCategory,
): number =>
  preview.conflicts.filter((conflict) => conflict.category === category).length

const getConflictCategories = (
  preview: PortableLocalDataImportPreview,
): PortableDataConflictCategory[] =>
  CATEGORIES.filter((category) => conflictCount(preview, category) > 0)

const getErrorMessage = (error: PortableLocalDataError): string => {
  switch (error.code) {
    case 'unsupported-version':
      return 'This file was created by an unsupported MergeLens data version.'
    case 'invalid-data':
      return 'This file is not valid MergeLens portable local data.'
    case 'quota-exceeded':
      return 'Extension storage is full. Remove unused local data and try again.'
    case 'serialization-failed':
      return 'Local data could not be prepared for download.'
    case 'storage-unavailable':
      return 'Extension storage is unavailable. Try again.'
  }
}

const downloadJson = (serializedData: string, exportedAt: string): void => {
  const date = exportedAt.slice(0, 10)
  const url = URL.createObjectURL(
    new Blob([serializedData], { type: 'application/json;charset=utf-8' }),
  )
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `mergelens-local-data-${date}.json`
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export const PortableLocalDataSettings = ({
  services,
}: PortableLocalDataSettingsProps) => {
  const [operation, setOperation] = useState<Operation | null>(null)
  const [preview, setPreview] = useState<PortableLocalDataImportPreview | null>(
    null,
  )
  const [decisions, setDecisions] = useState<PortableDataConflictDecisions>({})
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const requestSequence = useRef(0)

  const isBusy = operation !== null
  const conflictCategories = preview ? getConflictCategories(preview) : []
  const hasAllDecisions = conflictCategories.every(
    (category) => decisions[category] !== undefined,
  )

  useEffect(
    () => () => {
      requestSequence.current += 1
    },
    [],
  )

  const resetFeedback = (): void => {
    setError(null)
    setNotice(null)
  }

  const handleExport = async (): Promise<void> => {
    const request = ++requestSequence.current
    setOperation('export')
    resetFeedback()
    logger.debug('Starting portable local data export from settings', {
      request,
    })
    try {
      const result = await services.exportData()
      if (request !== requestSequence.current) return
      if (result.status === 'error') {
        logger.warn('Portable local data export returned an expected error', {
          request,
          code: result.error.code,
          failedCategory: result.error.failedCategory,
        })
        setError(getErrorMessage(result.error))
        return
      }

      downloadJson(result.serializedData, result.data.exportedAt)
      setNotice({
        tone: 'success',
        message: `Exported ${totalCount(result.counts)} records.`,
      })
      logger.info('Portable local data download created', {
        request,
        byteLength: result.byteLength,
        recordCount: totalCount(result.counts),
      })
    } catch (caughtError) {
      logger.error('Portable local data export failed unexpectedly', {
        request,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      if (request === requestSequence.current) {
        setError('Local data could not be exported. Try again.')
      }
    } finally {
      if (request === requestSequence.current) setOperation(null)
    }
  }

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    const request = ++requestSequence.current
    setOperation('preview')
    setPreview(null)
    setDecisions({})
    setIsConfirmed(false)
    resetFeedback()
    logger.debug('Reading portable local data import file', {
      request,
      byteLength: file.size,
      mediaType: file.type || 'unknown',
    })
    try {
      const serializedData = await file.text()
      if (request !== requestSequence.current) return
      const result = await services.previewImport(serializedData)
      if (request !== requestSequence.current) return
      if (result.status === 'error') {
        logger.warn('Portable local data import file was rejected', {
          request,
          code: result.error.code,
          issueCount: result.error.issueCount,
        })
        setError(getErrorMessage(result.error))
        return
      }

      setPreview(result.preview)
      logger.info('Portable local data import preview displayed', {
        request,
        additionCount: totalCount(result.preview.additions),
        conflictCount: result.preview.conflicts.length,
        noteCount: result.preview.data.data.notes.length,
        templateCount: result.preview.data.data.reviewTemplates.length,
        savedFilterCount: result.preview.data.data.savedFilters.length,
      })
    } catch (caughtError) {
      logger.error('Portable local data import preview failed unexpectedly', {
        request,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      if (request === requestSequence.current) {
        setError('The selected file could not be read. Try another JSON file.')
      }
    } finally {
      if (request === requestSequence.current) setOperation(null)
    }
  }

  const handleDecisionChange = (
    category: PortableDataConflictCategory,
    decision: PortableDataConflictDecision,
  ): void => {
    setDecisions((current) => ({ ...current, [category]: decision }))
    setIsConfirmed(false)
    logger.debug('Portable local data conflict decision changed', {
      category,
      decision,
    })
  }

  const handleImport = async (): Promise<void> => {
    if (!preview || !hasAllDecisions || !isConfirmed) {
      logger.warn('Blocked unconfirmed portable local data import', {
        hasPreview: preview !== null,
        hasAllDecisions,
        isConfirmed,
      })
      setError(
        'Review conflict choices and confirm the merge before importing.',
      )
      return
    }

    const request = ++requestSequence.current
    setOperation('import')
    resetFeedback()
    logger.info('Applying portable local data import from settings', {
      request,
      conflictCount: preview.conflicts.length,
      conflictDecisions: decisions,
    })
    try {
      const result = await services.applyImport({
        preview,
        conflictDecisions: decisions,
      })
      if (request !== requestSequence.current) return
      if (result.status === 'error') {
        logger.error('Portable local data import returned an error', {
          request,
          code: result.error.code,
          failedCategory: result.error.failedCategory,
        })
        setError(getErrorMessage(result.error))
        return
      }

      const importedCount = totalCount(result.imported)
      const skippedCount = totalCount(result.skipped)
      if (result.status === 'partial') {
        logger.warn('Portable local data import partially completed', {
          request,
          importedCount,
          skippedCount,
          code: result.error.code,
          failedCategory: result.error.failedCategory,
        })
        setNotice({
          tone: 'warning',
          message:
            `Imported ${importedCount} records before storage failed. ` +
            `${skippedCount} conflicts were kept unchanged.`,
        })
      } else {
        logger.info('Portable local data import completed from settings', {
          request,
          importedCount,
          skippedCount,
        })
        setNotice({
          tone: 'success',
          message:
            `Imported ${importedCount} records. ` +
            `${skippedCount} conflicts were kept unchanged.`,
        })
      }
      setPreview(null)
      setDecisions({})
      setIsConfirmed(false)
    } catch (caughtError) {
      logger.error('Portable local data import failed unexpectedly', {
        request,
        errorName:
          caughtError instanceof Error ? caughtError.name : 'UnknownError',
      })
      if (request === requestSequence.current) {
        setError('Local data could not be imported. Try again.')
      }
    } finally {
      if (request === requestSequence.current) setOperation(null)
    }
  }

  return (
    <section
      className="portable-local-data-settings"
      aria-labelledby="portable-local-data-heading"
    >
      <header>
        <div className="portable-local-data-settings__heading">
          <DatabaseBackup aria-hidden="true" size={18} />
          <div>
            <h2 id="portable-local-data-heading">Portable local data</h2>
            <p>
              Export or merge local MergeLens data using a validated JSON file.
            </p>
          </div>
        </div>
      </header>

      <div className="portable-local-data-settings__actions">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleExport()}
        >
          <Download aria-hidden="true" size={16} />
          Export JSON
        </button>
        <label
          className={`portable-local-data-settings__file-button${
            isBusy ? ' portable-local-data-settings__file-button--disabled' : ''
          }`}
        >
          <Upload aria-hidden="true" size={16} />
          Import JSON
          <input
            type="file"
            accept="application/json,.json"
            disabled={isBusy}
            onChange={(event) => void handleFileChange(event)}
          />
        </label>
      </div>

      <p className="portable-local-data-settings__merge-note">
        Import is merge-only. Records missing from the file remain unchanged.
      </p>

      {operation ? (
        <p className="portable-local-data-settings__status" role="status">
          {operation === 'export'
            ? 'Preparing JSON export...'
            : operation === 'preview'
              ? 'Validating import file...'
              : 'Importing local data...'}
        </p>
      ) : null}
      {error ? (
        <p
          className="portable-local-data-settings__message portable-local-data-settings__message--error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className={`portable-local-data-settings__message portable-local-data-settings__message--${notice.tone}`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}

      {preview ? (
        <div className="portable-local-data-settings__preview">
          <div className="portable-local-data-settings__preview-heading">
            <div>
              <h3>Import preview</h3>
              <p>
                Review additions and choose how existing records are handled.
              </p>
            </div>
            <span>{preview.conflicts.length} conflicts</span>
          </div>

          <ul
            className="portable-local-data-settings__summary"
            aria-label="Import category summary"
          >
            {CATEGORIES.map((category) => (
              <li key={category}>
                <span>{CATEGORY_LABELS[category]}</span>
                <span>
                  {preview.additions[category]} new,{' '}
                  {conflictCount(preview, category)} conflicts
                </span>
              </li>
            ))}
          </ul>

          {conflictCategories.length > 0 ? (
            <div className="portable-local-data-settings__conflicts">
              <h3>Conflict choices</h3>
              {conflictCategories.map((category) => (
                <fieldset key={category}>
                  <legend>
                    {CATEGORY_LABELS[category]} (
                    {conflictCount(preview, category)})
                  </legend>
                  <div className="portable-local-data-settings__choice-group">
                    <label>
                      <input
                        type="radio"
                        name={`portable-data-${category}`}
                        value="use-imported"
                        checked={decisions[category] === 'use-imported'}
                        disabled={isBusy}
                        onChange={() =>
                          handleDecisionChange(category, 'use-imported')
                        }
                      />
                      Use imported
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`portable-data-${category}`}
                        value="keep-existing"
                        checked={decisions[category] === 'keep-existing'}
                        disabled={isBusy}
                        onChange={() =>
                          handleDecisionChange(category, 'keep-existing')
                        }
                      />
                      Keep existing
                    </label>
                  </div>
                </fieldset>
              ))}
            </div>
          ) : null}

          <label className="portable-local-data-settings__confirmation">
            <input
              type="checkbox"
              checked={isConfirmed}
              disabled={isBusy || !hasAllDecisions}
              onChange={(event) => setIsConfirmed(event.target.checked)}
            />
            <span>
              I confirm this data should be merged into extension storage.
            </span>
          </label>
          <div className="portable-local-data-settings__preview-actions">
            <button
              type="button"
              className="portable-local-data-settings__primary"
              disabled={isBusy || !hasAllDecisions || !isConfirmed}
              onClick={() => void handleImport()}
            >
              <Upload aria-hidden="true" size={16} />
              Import data
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setPreview(null)
                setDecisions({})
                setIsConfirmed(false)
                resetFeedback()
                logger.debug('Portable local data import preview cancelled')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
