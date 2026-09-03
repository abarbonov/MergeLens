import { logger as rootLogger } from '@/shared/logging'
import {
  REVIEW_NOTIFICATION_ALARM_NAME,
  REVIEW_NOTIFICATION_ID_PREFIX,
} from '../domain/ReviewNotification'
import { createOpenReviewNotificationTarget } from '../application/openReviewNotificationTarget'
import { createPollReviewNotifications } from '../application/pollReviewNotifications'
import { createReconcileReviewNotificationSchedule } from '../application/reconcileReviewNotificationSchedule'
import { BrowserNotificationPermissionGateway } from './BrowserNotificationPermissionGateway'
import {
  BrowserReviewNotificationPresenter,
  BrowserReviewNotificationTabOpener,
} from './BrowserReviewNotificationPresenter'
import { BrowserReviewNotificationScheduler } from './BrowserReviewNotificationScheduler'
import { OctokitReviewNotificationSource } from './OctokitReviewNotificationSource'
import { WxtReviewNotificationStateRepository } from './ReviewNotificationStorage'

const logger = rootLogger.child({ scope: "reviewNotifications.background" })

export interface ReviewNotificationBackgroundDependencies {
  repository?: WxtReviewNotificationStateRepository
  source?: OctokitReviewNotificationSource
  scheduler?: BrowserReviewNotificationScheduler
  presenter?: BrowserReviewNotificationPresenter
  permission?: BrowserNotificationPermissionGateway
  tabOpener?: BrowserReviewNotificationTabOpener
}

export const registerReviewNotificationBackground = (
  overrides: ReviewNotificationBackgroundDependencies = {},
): (() => void) => {
  const repository =
    overrides.repository ?? new WxtReviewNotificationStateRepository()
  const source = overrides.source ?? new OctokitReviewNotificationSource()
  const scheduler =
    overrides.scheduler ?? new BrowserReviewNotificationScheduler()
  const presenter =
    overrides.presenter ?? new BrowserReviewNotificationPresenter()
  const permission =
    overrides.permission ?? new BrowserNotificationPermissionGateway()
  const tabOpener =
    overrides.tabOpener ?? new BrowserReviewNotificationTabOpener()
  const clock = { now: () => new Date().toISOString() }
  const poll = createPollReviewNotifications({
    source,
    repository,
    permission,
    presenter,
    clock,
  })
  const reconcile = createReconcileReviewNotificationSchedule({
    repository,
    permission,
    scheduler,
  })
  const openTarget = createOpenReviewNotificationTarget({
    repository,
    presenter,
    tabOpener,
  })

  const contain = (operation: string, task: Promise<unknown>) => {
    void task.catch((error: unknown) => {
      logger.error('Review notification background operation failed', {
        operation,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    })
  }
  const onAlarm = (alarm: Browser.alarms.Alarm) => {
    if (alarm.name !== REVIEW_NOTIFICATION_ALARM_NAME) {
      logger.debug('Ignored foreign browser alarm')
      return
    }
    contain('poll', poll('alarm'))
  }
  const onStartup = () => contain('startup-reconcile', reconcile())
  const onInstalled = () => contain('installed-reconcile', reconcile())
  const onNotificationClicked = (notificationId: string) => {
    contain('open-target', openTarget(notificationId))
  }
  const onNotificationClosed = (notificationId: string) => {
    if (!notificationId.startsWith(REVIEW_NOTIFICATION_ID_PREFIX)) return
    contain(
      'close-route',
      repository
        .listRoutes()
        .then((routes) =>
          repository.saveRoutes(
            routes.filter((route) => route.notificationId !== notificationId),
          ),
        ),
    )
  }
  let notificationListenersRegistered = false
  const getNotificationsApi = () =>
    (
      browser as typeof browser & {
        notifications?: typeof browser.notifications
      }
    ).notifications
  const registerNotificationListeners = () => {
    const notifications = getNotificationsApi()
    if (!notifications || notificationListenersRegistered) return false
    notifications.onClicked.addListener(onNotificationClicked)
    notifications.onClosed.addListener(onNotificationClosed)
    notificationListenersRegistered = true
    logger.info('Review notification click listeners registered')
    return true
  }
  const removeNotificationListeners = () => {
    if (!notificationListenersRegistered) return
    const notifications = getNotificationsApi()
    notifications?.onClicked.removeListener(onNotificationClicked)
    notifications?.onClosed.removeListener(onNotificationClosed)
    notificationListenersRegistered = false
    logger.info('Review notification click listeners removed')
  }
  const permissionChanged = (permissions: Browser.permissions.Permissions) => {
    if (!permissions.permissions?.includes('notifications')) return
    contain('permission-reconcile', reconcile())
  }
  const permissionAdded = (permissions: Browser.permissions.Permissions) => {
    if (!permissions.permissions?.includes('notifications')) return
    registerNotificationListeners()
    permissionChanged(permissions)
  }
  const permissionRemoved = (permissions: Browser.permissions.Permissions) => {
    if (!permissions.permissions?.includes('notifications')) return
    removeNotificationListeners()
    contain(
      'permission-revoked',
      repository.saveRoutes([]).then(() => reconcile()),
    )
  }

  browser.alarms.onAlarm.addListener(onAlarm)
  browser.runtime.onStartup.addListener(onStartup)
  browser.runtime.onInstalled.addListener(onInstalled)
  browser.permissions.onAdded.addListener(permissionAdded)
  browser.permissions.onRemoved.addListener(permissionRemoved)
  const registeredNotificationListeners = registerNotificationListeners()
  const unsubscribePreferences = repository.subscribePreferences(() => {
    contain('preferences-reconcile', reconcile())
  })
  logger.info('Review notification background listeners registered', {
    listenerCount: registeredNotificationListeners ? 8 : 6,
  })
  contain('initial-reconcile', reconcile())

  return () => {
    browser.alarms.onAlarm.removeListener(onAlarm)
    browser.runtime.onStartup.removeListener(onStartup)
    browser.runtime.onInstalled.removeListener(onInstalled)
    removeNotificationListeners()
    browser.permissions.onAdded.removeListener(permissionAdded)
    browser.permissions.onRemoved.removeListener(permissionRemoved)
    unsubscribePreferences()
    logger.info('Review notification background listeners removed')
  }
}
