import { useEffect, useState, type FormEvent } from 'react'
import {
  clearLocalGitHubToken,
  hasLocalGitHubToken,
  saveLocalGitHubToken,
} from '@/shared/github/auth/localToken'
import { logger as rootLogger } from '@/shared/logging'
import './TokenSettings.css'

const logger = rootLogger.child({ scope: 'settings.token' })

type TokenStatus = 'loading' | 'configured' | 'missing' | 'error'

export const TokenSettings = () => {
  const [token, setToken] = useState('')
  const [status, setStatus] = useState<TokenStatus>('loading')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let isActive = true

    logger.debug('Loading local token status')
    void hasLocalGitHubToken()
      .then((isConfigured) => {
        if (isActive) {
          setStatus(isConfigured ? 'configured' : 'missing')
        }
      })
      .catch((error: unknown) => {
        logger.error('Failed to load local token status', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
        if (isActive) {
          setStatus('error')
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedToken = token.trim()

    if (!normalizedToken) {
      setStatus('error')
      return
    }

    setIsSaving(true)
    logger.info('Saving token from options page')

    try {
      await saveLocalGitHubToken(normalizedToken)
      setToken('')
      setStatus('configured')
    } catch (error) {
      logger.error('Failed to save token from options page', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      setStatus('error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setIsSaving(true)
    logger.info('Clearing token from options page')

    try {
      await clearLocalGitHubToken()
      setToken('')
      setStatus('missing')
    } catch (error) {
      logger.error('Failed to clear token from options page', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      setStatus('error')
    } finally {
      setIsSaving(false)
    }
  }

  const statusText = {
    configured: 'Token configured',
    error: 'Token settings unavailable',
    loading: 'Checking token status',
    missing: 'No token configured',
  }[status]

  return (
    <main className="token-settings">
      <header className="token-settings__header">
        <span className="token-settings__product">MergeLens</span>
        <h1>GitHub access</h1>
      </header>

      <form className="token-settings__form" onSubmit={handleSubmit}>
        <label htmlFor="github-token">Personal access token</label>
        <input
          id="github-token"
          name="github-token"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          disabled={isSaving}
        />

        <div className="token-settings__status" role="status">
          <span
            className={`token-settings__indicator token-settings__indicator--${status}`}
          />
          {statusText}
        </div>

        <div className="token-settings__actions">
          <button
            type="submit"
            disabled={isSaving || token.trim().length === 0}
          >
            Save token
          </button>
          <button
            className="token-settings__clear"
            type="button"
            onClick={handleClear}
            disabled={isSaving || status !== 'configured'}
          >
            Clear token
          </button>
        </div>
      </form>
    </main>
  )
}
