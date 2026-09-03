import { Bell, BellOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  BrowserNotificationPermissionGateway,
  BrowserReviewNotificationScheduler,
  REVIEW_NOTIFICATION_INTERVALS,
  WxtReviewNotificationStateRepository,
  type ReviewNotificationPreferences,
} from '@/modules/review-notifications'
import { logger as rootLogger } from '@/shared/logging'
import './ReviewNotificationsSettings.css'

const logger = rootLogger.child({ scope: "settings.reviewNotifications" })

export interface ReviewNotificationsSettingsServices {
  getPreferences(): Promise<ReviewNotificationPreferences>
  savePreferences(
    preferences: ReviewNotificationPreferences,
  ): Promise<ReviewNotificationPreferences>
  isPermissionGranted(): Promise<boolean>
  requestPermission(): Promise<boolean>
  getScheduledInterval(): Promise<number | null>
}

const repository = new WxtReviewNotificationStateRepository()
const permission = new BrowserNotificationPermissionGateway()
const scheduler = new BrowserReviewNotificationScheduler()
const defaultServices: ReviewNotificationsSettingsServices = {
  getPreferences: () => repository.getPreferences(),
  savePreferences: (preferences) => repository.savePreferences(preferences),
  isPermissionGranted: () => permission.isGranted(),
  requestPermission: () => permission.request(),
  getScheduledInterval: () => scheduler.getIntervalMinutes(),
}
interface ReviewNotificationsSettingsProps {
  services?: ReviewNotificationsSettingsServices
}

export const ReviewNotificationsSettings = ({
  services = defaultServices,
}: ReviewNotificationsSettingsProps) => {
  const [preferences, setPreferences] = useState<ReviewNotificationPreferences>(
    {
      enabled: false,
      intervalMinutes: 15,
    },
  )
  const [permissionGranted, setPermissionGranted] = useState(false)
  const [scheduledInterval, setScheduledInterval] = useState<number | null>(
    null,
  )
  const [isBusy, setIsBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)

  useEffect(() => {
    const request = ++sequence.current
    logger.info('Loading review notification settings', { request })
    void Promise.all([
      services.getPreferences(),
      services.isPermissionGranted(),
      services.getScheduledInterval(),
    ])
      .then(([nextPreferences, granted, interval]) => {
        if (request !== sequence.current) return
        setPreferences(nextPreferences)
        setPermissionGranted(granted)
        setScheduledInterval(interval)
        logger.debug('Review notification settings loaded', {
          request,
          enabled: nextPreferences.enabled,
          intervalMinutes: nextPreferences.intervalMinutes,
          permissionGranted: granted,
          isScheduled: interval !== null,
        })
      })
      .catch((caught: unknown) => {
        logger.error('Failed to load review notification settings', {
          request,
          errorName: caught instanceof Error ? caught.name : 'UnknownError',
        })
        if (request === sequence.current) {
          setError('Review notification settings are unavailable.')
        }
      })
      .finally(() => {
        if (request === sequence.current) setIsBusy(false)
      })
    return () => {
      sequence.current += 1
    }
  }, [services])

  const save = async (next: ReviewNotificationPreferences) => {
    const request = ++sequence.current
    setIsBusy(true)
    setError(null)
    logger.debug('Saving review notification settings', {
      request,
      enabled: next.enabled,
      intervalMinutes: next.intervalMinutes,
    })
    try {
      const saved = await services.savePreferences(next)
      if (request !== sequence.current) return
      setPreferences(saved)
      setScheduledInterval(saved.enabled ? saved.intervalMinutes : null)
      logger.info('Review notification settings updated', {
        request,
        enabled: saved.enabled,
        intervalMinutes: saved.intervalMinutes,
      })
    } catch (caught) {
      logger.error('Failed to save review notification settings', {
        request,
        errorName: caught instanceof Error ? caught.name : 'UnknownError',
      })
      if (request === sequence.current) {
        setError('Unable to save review notification settings.')
      }
    } finally {
      if (request === sequence.current) setIsBusy(false)
    }
  }

  const handleEnabledChange = async (enabled: boolean) => {
    if (!enabled) {
      await save({ ...preferences, enabled: false })
      return
    }
    setIsBusy(true)
    setError(null)
    try {
      const granted = permissionGranted || (await services.requestPermission())
      setPermissionGranted(granted)
      if (!granted) {
        logger.warn('Review notification permission was denied')
        setError('Notification permission was not granted.')
        setIsBusy(false)
        return
      }
      await save({ ...preferences, enabled: true })
    } catch (caught) {
      logger.error('Review notification permission request failed', {
        errorName: caught instanceof Error ? caught.name : 'UnknownError',
      })
      setError('Unable to request notification permission.')
      setIsBusy(false)
    }
  }

  return (
    <section
      className="review-notifications-settings"
      aria-labelledby="review-notifications-heading"
    >
      <header>
        <div className="review-notifications-settings__heading">
          {preferences.enabled ? (
            <Bell aria-hidden="true" size={18} />
          ) : (
            <BellOff aria-hidden="true" size={18} />
          )}
          <div>
            <h2 id="review-notifications-heading">Review notifications</h2>
            <p>Notify when a pull request newly requests your review.</p>
          </div>
        </div>
        <label className="review-notifications-settings__toggle">
          <input
            type="checkbox"
            checked={preferences.enabled}
            disabled={isBusy}
            onChange={(event) => void handleEnabledChange(event.target.checked)}
          />
          <span>{preferences.enabled ? 'Enabled' : 'Disabled'}</span>
        </label>
      </header>

      <div className="review-notifications-settings__field">
        <label htmlFor="review-notification-interval">Check every</label>
        <select
          id="review-notification-interval"
          value={preferences.intervalMinutes}
          disabled={isBusy}
          onChange={(event) =>
            void save({
              ...preferences,
              intervalMinutes: Number(
                event.target.value,
              ) as ReviewNotificationPreferences['intervalMinutes'],
            })
          }
        >
          {REVIEW_NOTIFICATION_INTERVALS.map((minutes) => (
            <option value={minutes} key={minutes}>
              {minutes} minutes
            </option>
          ))}
        </select>
      </div>

      <p className="review-notifications-settings__status" role="status">
        {isBusy
          ? 'Updating notification settings...'
          : scheduledInterval === null
            ? 'Background polling is not scheduled.'
            : `Background polling is scheduled every ${scheduledInterval} minutes.`}
      </p>
      {error ? (
        <p className="review-notifications-settings__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
