import { beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/shared/logging', () => ({
  logger: {
    ...logger,
    child: () => logger,
  },
}))
import {
  EMPTY_REVIEW_NOTIFICATION_SNAPSHOT,
  type ReviewNotificationCandidate,
  type ReviewNotificationPreferences,
  type ReviewNotificationRoute,
  type ReviewNotificationSnapshot,
} from '@/modules/review-notifications/domain/ReviewNotification'
import type { ReviewNotificationStateRepository } from '@/modules/review-notifications/ports/ReviewNotificationStateRepository'
import { createOpenReviewNotificationTarget } from '@/modules/review-notifications/application/openReviewNotificationTarget'
import { createPollReviewNotifications } from '@/modules/review-notifications/application/pollReviewNotifications'
import { createReconcileReviewNotificationSchedule } from '@/modules/review-notifications/application/reconcileReviewNotificationSchedule'

const candidate: ReviewNotificationCandidate = {
  id: 'candidate-2',
  title: 'Sensitive title',
  url: 'https://github.com/acme/private/pull/2',
  repositoryFullName: 'acme/private',
  pullNumber: 2,
  updatedAt: '2026-08-18T11:00:00.000Z',
}

const createRepository = (
  preferences: ReviewNotificationPreferences = {
    enabled: true,
    intervalMinutes: 15,
  },
  initialSnapshot: ReviewNotificationSnapshot = EMPTY_REVIEW_NOTIFICATION_SNAPSHOT,
) => {
  let snapshot = initialSnapshot
  let routes: ReviewNotificationRoute[] = []
  const repository: ReviewNotificationStateRepository = {
    getPreferences: vi.fn(async () => preferences),
    savePreferences: vi.fn(async (next) => next),
    getSnapshot: vi.fn(async () => snapshot),
    saveSnapshot: vi.fn(async (next) => {
      snapshot = next
    }),
    listRoutes: vi.fn(async () => routes),
    saveRoutes: vi.fn(async (next) => {
      routes = next
    }),
    subscribePreferences: vi.fn(() => vi.fn()),
  }
  return repository
}

describe('review notification application use cases', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips source access while disabled or permission is missing', async () => {
    const source = { listReviewRequests: vi.fn() }
    const presenter = { present: vi.fn(), clear: vi.fn() }
    const disabledPoll = createPollReviewNotifications({
      source,
      repository: createRepository({ enabled: false, intervalMinutes: 15 }),
      permission: { isGranted: vi.fn(async () => true), request: vi.fn() },
      presenter,
      clock: { now: () => '2026-08-18T12:00:00.000Z' },
    })
    await expect(disabledPoll()).resolves.toEqual({ status: 'disabled' })

    const permissionPoll = createPollReviewNotifications({
      source,
      repository: createRepository(),
      permission: { isGranted: vi.fn(async () => false), request: vi.fn() },
      presenter,
      clock: { now: () => '2026-08-18T12:00:00.000Z' },
    })
    await expect(permissionPoll()).resolves.toEqual({
      status: 'permission-required',
    })
    expect(source.listReviewRequests).not.toHaveBeenCalled()
  })

  it('retains the baseline for every stable source error', async () => {
    for (const code of [
      'missing-token',
      'unauthorized',
      'rate-limited',
      'network-error',
      'invalid-response',
    ] as const) {
      const repository = createRepository()
      const poll = createPollReviewNotifications({
        source: {
          listReviewRequests: vi.fn(async () => ({
            status: 'error' as const,
            error: { code },
          })),
        },
        repository,
        permission: { isGranted: vi.fn(async () => true), request: vi.fn() },
        presenter: { present: vi.fn(), clear: vi.fn() },
        clock: { now: () => '2026-08-18T12:00:00.000Z' },
      })

      await expect(poll()).resolves.toEqual({ status: 'source-error', code })
      expect(repository.saveSnapshot).not.toHaveBeenCalled()
    }
  })

  it('creates a silent baseline, then persists routes before delivery', async () => {
    const repository = createRepository()
    const presenter = { present: vi.fn(async () => undefined), clear: vi.fn() }
    const source = {
      listReviewRequests: vi.fn(async () => ({
        status: 'success' as const,
        candidates: [candidate],
      })),
    }
    const poll = createPollReviewNotifications({
      source,
      repository,
      permission: { isGranted: vi.fn(async () => true), request: vi.fn() },
      presenter,
      clock: { now: () => '2026-08-18T12:00:00.000Z' },
    })

    await expect(poll()).resolves.toMatchObject({
      status: 'success',
      baselineCreated: true,
      deliveryCount: 0,
    })
    source.listReviewRequests.mockResolvedValueOnce({
      status: 'success',
      candidates: [{ ...candidate, id: 'candidate-3', pullNumber: 3 }],
    })
    await expect(poll()).resolves.toMatchObject({
      status: 'success',
      baselineCreated: false,
      deliveryCount: 1,
    })

    expect(repository.saveRoutes).toHaveBeenCalled()
    expect(presenter.present).toHaveBeenCalledOnce()
    expect(
      vi.mocked(repository.saveRoutes).mock.invocationCallOrder.at(-1),
    ).toBeLessThan(presenter.present.mock.invocationCallOrder[0] ?? 0)
    const diagnosticMetadata = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
    ])
    for (const sensitiveValue of [
      candidate.title,
      candidate.repositoryFullName,
      candidate.url,
    ]) {
      expect(diagnosticMetadata).not.toContain(sensitiveValue)
    }
  })

  it('coalesces overlapping polls', async () => {
    let release: (() => void) | undefined
    const source = {
      listReviewRequests: vi.fn(
        () =>
          new Promise<{
            status: 'success'
            candidates: ReviewNotificationCandidate[]
          }>((resolve) => {
            release = () => resolve({ status: 'success', candidates: [] })
          }),
      ),
    }
    const poll = createPollReviewNotifications({
      source,
      repository: createRepository(),
      permission: { isGranted: vi.fn(async () => true), request: vi.fn() },
      presenter: { present: vi.fn(), clear: vi.fn() },
      clock: { now: () => '2026-08-18T12:00:00.000Z' },
    })

    const first = poll()
    await vi.waitFor(() =>
      expect(source.listReviewRequests).toHaveBeenCalledOnce(),
    )
    await expect(poll()).resolves.toEqual({ status: 'already-running' })
    release?.()
    await expect(first).resolves.toMatchObject({ status: 'success' })
    expect(source.listReviewRequests).toHaveBeenCalledOnce()
  })

  it('reconciles alarms and consumes persistent click routes', async () => {
    const repository = createRepository()
    const scheduler = {
      getIntervalMinutes: vi.fn(async () => 5),
      schedule: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
    }
    const reconcile = createReconcileReviewNotificationSchedule({
      repository,
      permission: { isGranted: vi.fn(async () => true), request: vi.fn() },
      scheduler,
    })
    await expect(reconcile()).resolves.toEqual({
      status: 'scheduled',
      intervalMinutes: 15,
      changed: true,
    })
    expect(scheduler.schedule).toHaveBeenCalledWith(15)

    const route = {
      notificationId: 'mergelens-review:candidate-2',
      url: candidate.url,
      createdAt: '2026-08-18T12:00:00.000Z',
    }
    await repository.saveRoutes([route])
    const tabOpener = { open: vi.fn(async () => undefined) }
    const presenter = { present: vi.fn(), clear: vi.fn(async () => undefined) }
    const open = createOpenReviewNotificationTarget({
      repository,
      presenter,
      tabOpener,
    })

    await expect(open('foreign-id')).resolves.toBe('ignored')
    await expect(open(route.notificationId)).resolves.toBe('opened')
    expect(tabOpener.open).toHaveBeenCalledWith(candidate.url)
    await expect(repository.listRoutes()).resolves.toEqual([])
  })
})
