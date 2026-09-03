import { logger as rootLogger } from '@/shared/logging'
import type { ReconcileReviewNotificationScheduleDependencies } from './contracts'

const logger = rootLogger.child({ scope: "reviewNotifications.reconcileSchedule" })

export type ReviewNotificationScheduleOutcome =
  | { status: 'scheduled'; intervalMinutes: number; changed: boolean }
  | {
      status: 'cleared'
      reason: 'disabled' | 'permission-required'
      changed: boolean
    }

export const createReconcileReviewNotificationSchedule =
  (dependencies: ReconcileReviewNotificationScheduleDependencies) =>
  async (): Promise<ReviewNotificationScheduleOutcome> => {
    const preferences = await dependencies.repository.getPreferences()
    const currentInterval = await dependencies.scheduler.getIntervalMinutes()
    logger.debug('Reconciling review notification schedule', {
      enabled: preferences.enabled,
      intervalMinutes: preferences.intervalMinutes,
      currentInterval: currentInterval ?? undefined,
    })

    if (!preferences.enabled) {
      if (currentInterval !== null) await dependencies.scheduler.clear()
      logger.info('Review notification schedule disabled', {
        changed: currentInterval !== null,
      })
      return {
        status: 'cleared',
        reason: 'disabled',
        changed: currentInterval !== null,
      }
    }
    if (!(await dependencies.permission.isGranted())) {
      if (currentInterval !== null) await dependencies.scheduler.clear()
      logger.warn('Review notification schedule requires permission', {
        changed: currentInterval !== null,
      })
      return {
        status: 'cleared',
        reason: 'permission-required',
        changed: currentInterval !== null,
      }
    }

    const changed = currentInterval !== preferences.intervalMinutes
    if (changed)
      await dependencies.scheduler.schedule(preferences.intervalMinutes)
    logger.info('Review notification schedule reconciled', {
      intervalMinutes: preferences.intervalMinutes,
      changed,
    })
    return {
      status: 'scheduled',
      intervalMinutes: preferences.intervalMinutes,
      changed,
    }
  }
