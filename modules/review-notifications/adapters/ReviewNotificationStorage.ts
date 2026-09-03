import { z } from 'zod'
import { storage, type WxtStorageItem } from 'wxt/utils/storage'
import { logger as rootLogger } from '@/shared/logging'
import {
  DEFAULT_REVIEW_NOTIFICATION_PREFERENCES,
  EMPTY_REVIEW_NOTIFICATION_SNAPSHOT,
  MAX_NOTIFICATION_ROUTES,
  MAX_REVIEW_NOTIFICATION_CANDIDATES,
  REVIEW_NOTIFICATION_INTERVALS,
  REVIEW_NOTIFICATION_STORAGE_VERSION,
  normalizeReviewNotificationPreferences,
  type ReviewNotificationPreferences,
  type ReviewNotificationRoute,
  type ReviewNotificationSnapshot,
} from '../domain/ReviewNotification'
import type { ReviewNotificationStateRepository } from '../ports/ReviewNotificationStateRepository'

const logger = rootLogger.child({ scope: "reviewNotifications.storage" })
const MAX_STORAGE_BYTES = 7_500
const PREFERENCES_KEY = 'sync:reviewNotifications.preferences'
const STATE_KEY = 'local:reviewNotifications.state'

const preferencesSchema = z
  .object({
    enabled: z.boolean(),
    intervalMinutes: z.union(
      REVIEW_NOTIFICATION_INTERVALS.map((value) => z.literal(value)),
    ),
  })
  .strict()
const snapshotSchema = z
  .object({
    initialized: z.boolean(),
    activeCandidateIds: z
      .array(z.string().trim().min(1).max(128))
      .max(MAX_REVIEW_NOTIFICATION_CANDIDATES),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
const githubPullRequestUrlSchema = z.url().refine((value) => {
  const url = new URL(value)
  return (
    url.protocol === 'https:' &&
    url.hostname === 'github.com' &&
    /\/pull\/\d+(?:\/|$)/.test(url.pathname)
  )
})
const routeSchema = z
  .object({
    notificationId: z.string().trim().min(1).max(180),
    url: githubPullRequestUrlSchema,
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict()
const stateSchema = z
  .object({
    snapshot: snapshotSchema,
    routes: z.array(routeSchema).max(MAX_NOTIFICATION_ROUTES),
  })
  .strict()
const storedPreferencesSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_NOTIFICATION_STORAGE_VERSION),
    value: preferencesSchema,
  })
  .strict()
const storedStateSchema = z
  .object({
    schemaVersion: z.literal(REVIEW_NOTIFICATION_STORAGE_VERSION),
    value: stateSchema,
  })
  .strict()

const record = <T>(value: T) => ({
  schemaVersion: REVIEW_NOTIFICATION_STORAGE_VERSION,
  value,
})

interface StorageItems {
  preferences: WxtStorageItem<unknown, Record<string, unknown>>
  state: WxtStorageItem<unknown, Record<string, unknown>>
}

let items: StorageItems | undefined
const getItems = (): StorageItems => {
  if (items) return items
  items = {
    preferences: storage.defineItem<unknown>(PREFERENCES_KEY, {
      fallback: record(DEFAULT_REVIEW_NOTIFICATION_PREFERENCES),
      version: REVIEW_NOTIFICATION_STORAGE_VERSION,
    }),
    state: storage.defineItem<unknown>(STATE_KEY, {
      fallback: record({
        snapshot: EMPTY_REVIEW_NOTIFICATION_SNAPSHOT,
        routes: [],
      }),
      version: REVIEW_NOTIFICATION_STORAGE_VERSION,
    }),
  }
  return items
}

const assertFitsQuota = (value: unknown, category: 'preferences' | 'state') => {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
  if (bytes <= MAX_STORAGE_BYTES) return
  logger.warn('Rejected oversized review notification record', {
    category,
    bytes,
    byteLimit: MAX_STORAGE_BYTES,
  })
  throw new Error('Review notification storage quota exceeded')
}

const uniqueIds = (ids: readonly string[]): string[] =>
  [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    .sort()
    .slice(0, MAX_REVIEW_NOTIFICATION_CANDIDATES)

const normalizeSnapshot = (
  snapshot: ReviewNotificationSnapshot,
): ReviewNotificationSnapshot =>
  snapshotSchema.parse({
    initialized: snapshot.initialized,
    activeCandidateIds: uniqueIds(snapshot.activeCandidateIds),
    updatedAt: snapshot.updatedAt,
  })

const normalizeRoutes = (
  routes: readonly ReviewNotificationRoute[],
): ReviewNotificationRoute[] => {
  const unique = new Map<string, ReviewNotificationRoute>()
  for (const route of routes) unique.set(route.notificationId, route)
  return [...unique.values()]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_NOTIFICATION_ROUTES)
    .map((route) => routeSchema.parse(route))
}

export class WxtReviewNotificationStateRepository implements ReviewNotificationStateRepository {
  async getPreferences(): Promise<ReviewNotificationPreferences> {
    logger.debug('Reading review notification preferences', {
      schemaVersion: REVIEW_NOTIFICATION_STORAGE_VERSION,
    })
    const result = storedPreferencesSchema.safeParse(
      await getItems().preferences.getValue(),
    )
    if (!result.success) {
      logger.warn('Using default review notification preferences', {
        issueCount: result.error.issues.length,
      })
      return DEFAULT_REVIEW_NOTIFICATION_PREFERENCES
    }
    return normalizeReviewNotificationPreferences(result.data.value)
  }

  async savePreferences(
    preferences: ReviewNotificationPreferences,
  ): Promise<ReviewNotificationPreferences> {
    const normalized = normalizeReviewNotificationPreferences(preferences)
    const nextRecord = record(normalized)
    assertFitsQuota(nextRecord, 'preferences')
    logger.debug('Writing review notification preferences', {
      enabled: normalized.enabled,
      intervalMinutes: normalized.intervalMinutes,
      schemaVersion: REVIEW_NOTIFICATION_STORAGE_VERSION,
    })
    await getItems().preferences.setValue(nextRecord)
    if (!normalized.enabled) await this.saveRoutes([])
    logger.info('Review notification preferences saved', {
      enabled: normalized.enabled,
      intervalMinutes: normalized.intervalMinutes,
    })
    return normalized
  }

  private async getState() {
    const result = storedStateSchema.safeParse(
      await getItems().state.getValue(),
    )
    if (!result.success) {
      logger.warn('Using empty review notification state', {
        issueCount: result.error.issues.length,
      })
      return { snapshot: EMPTY_REVIEW_NOTIFICATION_SNAPSHOT, routes: [] }
    }
    return result.data.value
  }

  async getSnapshot(): Promise<ReviewNotificationSnapshot> {
    const state = await this.getState()
    logger.debug('Read review notification snapshot', {
      initialized: state.snapshot.initialized,
      candidateCount: state.snapshot.activeCandidateIds.length,
    })
    return normalizeSnapshot(state.snapshot)
  }

  async saveSnapshot(snapshot: ReviewNotificationSnapshot): Promise<void> {
    const current = await this.getState()
    const value = {
      snapshot: normalizeSnapshot(snapshot),
      routes: normalizeRoutes(current.routes),
    }
    const nextRecord = record(value)
    assertFitsQuota(nextRecord, 'state')
    await getItems().state.setValue(nextRecord)
    logger.info('Review notification snapshot saved', {
      initialized: value.snapshot.initialized,
      candidateCount: value.snapshot.activeCandidateIds.length,
    })
  }

  async listRoutes(): Promise<ReviewNotificationRoute[]> {
    const routes = normalizeRoutes((await this.getState()).routes)
    logger.debug('Read review notification routes', {
      routeCount: routes.length,
    })
    return routes
  }

  async saveRoutes(routes: ReviewNotificationRoute[]): Promise<void> {
    const current = await this.getState()
    const value = {
      snapshot: normalizeSnapshot(current.snapshot),
      routes: normalizeRoutes(routes),
    }
    const nextRecord = record(value)
    assertFitsQuota(nextRecord, 'state')
    await getItems().state.setValue(nextRecord)
    logger.info('Review notification routes saved', {
      routeCount: value.routes.length,
    })
  }

  subscribePreferences(listener: () => void): () => void {
    logger.debug('Subscribed to review notification preference changes')
    const unsubscribe = getItems().preferences.watch(() => listener())
    return () => {
      unsubscribe()
      logger.debug('Unsubscribed from review notification preference changes')
    }
  }
}

export const reviewNotificationStorageKeys = {
  preferences: PREFERENCES_KEY,
  state: STATE_KEY,
} as const
