import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  readConfiguredQuickLinks,
  removeConfiguredQuickLink,
  saveConfiguredQuickLink,
} from '@/modules/quick-links/settings'
import type { ConfiguredQuickLink } from '@/modules/quick-links'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "settings.quickLinks" })

export const QuickLinksSettings = () => {
  const [links, setLinks] = useState<ConfiguredQuickLink[]>([])
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(true)

  useEffect(() => {
    let active = true
    void readConfiguredQuickLinks()
      .then((items) => {
        logger.debug(
          '[FIX:quick-links-settings-layout] Loaded settings content',
          {
            linkCount: items.length,
          },
        )
        if (active) {
          setLinks(items)
        }
      })
      .catch((loadError: unknown) => {
        logger.error('Failed to load configured quick links', {
          errorName:
            loadError instanceof Error ? loadError.name : 'UnknownError',
        })
        if (active) setError('Quick links are unavailable.')
      })
      .finally(() => active && setIsBusy(false))
    return () => {
      active = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsBusy(true)
    try {
      const parsedUrl = new URL(url.trim())
      if (parsedUrl.protocol !== 'https:') throw new Error('HTTPS is required')
      const next = await saveConfiguredQuickLink({
        id: editingId ?? crypto.randomUUID(),
        label: label.trim(),
        url: parsedUrl.toString(),
      })
      setLinks(next)
      setLabel('')
      setUrl('')
      setEditingId(null)
    } catch {
      logger.warn('Rejected invalid configured quick link input')
      setError('Enter a label and a valid HTTPS URL.')
    } finally {
      setIsBusy(false)
    }
  }

  const handleEdit = (link: ConfiguredQuickLink) => {
    logger.debug('Editing configured quick link', { linkId: link.id })
    setEditingId(link.id)
    setLabel(link.label)
    setUrl(link.url)
    setError(null)
  }

  const handleRemove = async (id: string) => {
    setIsBusy(true)
    try {
      setLinks(await removeConfiguredQuickLink(id))
    } catch (removeError) {
      logger.error('Failed to remove configured quick link', {
        errorName:
          removeError instanceof Error ? removeError.name : 'UnknownError',
      })
      setError('Unable to remove this quick link.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section
      className="quick-links-settings"
      aria-labelledby="quick-links-heading"
    >
      <header>
        <h2 id="quick-links-heading">Project quick links</h2>
        <p>Links sync inside this browser ecosystem.</p>
      </header>
      <form onSubmit={handleSubmit}>
        <label htmlFor="quick-link-label">Label</label>
        <input
          id="quick-link-label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={80}
          disabled={isBusy}
        />
        <label htmlFor="quick-link-url">HTTPS URL</label>
        <input
          id="quick-link-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          type="url"
          placeholder="https://preview.example.com"
          disabled={isBusy}
        />
        <button type="submit" disabled={isBusy || !label.trim() || !url.trim()}>
          <Plus aria-hidden="true" size={16} />{' '}
          {editingId ? 'Save link' : 'Add link'}
        </button>
      </form>
      {error ? (
        <p className="quick-links-settings__error" role="alert">
          {error}
        </p>
      ) : null}
      {links.length === 0 && !isBusy ? (
        <p role="status">No project links configured.</p>
      ) : null}
      <ul>
        {links.map((link) => (
          <li key={link.id}>
            <a href={link.url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" size={14} /> {link.label}
            </a>
            <div className="quick-links-settings__actions">
              <button
                type="button"
                aria-label={`Edit ${link.label}`}
                title={`Edit ${link.label}`}
                onClick={() => handleEdit(link)}
                disabled={isBusy}
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${link.label}`}
                title={`Remove ${link.label}`}
                onClick={() => void handleRemove(link.id)}
                disabled={isBusy}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
