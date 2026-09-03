import { logger as rootLogger } from '@/shared/logging'
import {
  MAX_NOTIFICATION_ROUTES,
  createReviewNotificationDiff,
  type ReviewNotificationPollOutcome,
  type ReviewNotificationRoute,
} from '../domain/ReviewNotification'
import type {
  PollReviewNotificationsDependencies,
  ReviewNotificationTrigger,
} from './contracts'

const logger = rootLogger.child({ scope: "reviewNotifications.poll" })

export const createPollReviewNotifications = (
  dependencies: PollReviewNotificationsDependencies,
) => {
  let inFlight: Promise<ReviewNotificationPollOutcome> | null = null

  const execute = async (
    trigger: ReviewNotificationTrigger,
  ): Promise<ReviewNotificationPollOutcome> => {
    const preferences = await dependencies.repository.getPreferences()
    logger.debug('Starting review notification poll', {
      trigger,
      enabled: preferences.enabled,
      intervalMinutes: preferences.intervalMinutes,
    })
    if (!preferences.enabled) return { status: 'disabled' }
    if (!(await dependencies.permission.isGranted())) {
      logger.warn('Skipped review notification poll without permission', {
        trigger,
      })
      return { status: 'permission-required' }
    }

    const sourceResult = await dependencies.source.listReviewRequests()
    if (sourceResult.status === 'error') {
      logger.warn('Review notification poll retained prior baseline', {
        trigger,
        code: sourceResult.error.code,
      })
      return { status: 'source-error', code: sourceResult.error.code }
    }

    const previous = await dependencies.repository.getSnapshot()
    const diff = createReviewNotificationDiff(
      previous,
      sourceResult.candidates,
      dependencies.clock.now(),
    )
    logger.debug('Calculated review notification candidate diff', {
      trigger,
      priorCandidateCount: previous.activeCandidateIds.length,
      candidateCount: diff.snapshot.activeCandidateIds.length,
      newCandidateCount: diff.newCandidateCount,
      deliveryCount: diff.deliveries.length,
      baselineInitialized: previous.initialized,
    })

    const currentRoutes = await dependencies.repository.listRoutes()
    const newRoutes: ReviewNotificationRoute[] = diff.deliveries.flatMap(
      (delivery) =>
        delivery.url === null
          ? []
          : [
              {
                notificationId: delivery.notificationId,
                url: delivery.url,
                createdAt: diff.snapshot.updatedAt ?? dependencies.clock.now(),
              },
            ],
    )
    const routesById = new Map(
      [...newRoutes, ...currentRoutes].map((route) => [
        route.notificationId,
        route,
      ]),
    )
    await dependencies.repository.saveRoutes(
      [...routesById.values()].slice(0, MAX_NOTIFICATION_ROUTES),
    )
    await dependencies.repository.saveSnapshot(diff.snapshot)

    for (const delivery of diff.deliveries) {
      await dependencies.presenter.present(delivery)
    }

    const baselineCreated = !previous.initialized
    logger.info('Review notification poll completed', {
      trigger,
      baselineCreated,
      candidateCount: diff.snapshot.activeCandidateIds.length,
      newCandidateCount: diff.newCandidateCount,
      deliveryCount: diff.deliveries.length,
    })
    return {
      status: 'success',
      baselineCreated,
      candidateCount: diff.snapshot.activeCandidateIds.length,
      newCandidateCount: diff.newCandidateCount,
      deliveryCount: diff.deliveries.length,
    }
  }

  return async (
    trigger: ReviewNotificationTrigger = 'alarm',
  ): Promise<ReviewNotificationPollOutcome> => {
    if (inFlight) {
      logger.warn('Skipped overlapping review notification poll', { trigger })
      return { status: 'already-running' }
    }
    inFlight = execute(trigger).finally(() => {
      inFlight = null
    })
    return inFlight
  }
}
