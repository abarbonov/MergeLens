import { z } from 'zod'
import { storage } from 'wxt/utils/storage'
import { logger as rootLogger } from '@/shared/logging'
import type { ConfiguredQuickLink } from '../domain/QuickLinks'

const logger = rootLogger.child({ scope: "quickLinks.configuredStorage" })
const configuredLinkSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(80),
  url: z.url().refine((value) => new URL(value).protocol === 'https:', {
    message: 'Configured links must use HTTPS',
  }),
})
const configuredLinksSchema = z.array(configuredLinkSchema).max(20)
const configuredLinksItem = storage.defineItem<ConfiguredQuickLink[]>(
  'sync:configuredQuickLinks',
  { fallback: [] },
)

const normalizeLinks = (input: unknown): ConfiguredQuickLink[] => {
  const links = configuredLinksSchema.parse(input)
  return [...links].sort(
    (left, right) =>
      left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  )
}

export const readConfiguredQuickLinks = async (): Promise<
  ConfiguredQuickLink[]
> => {
  const stored = await configuredLinksItem.getValue()
  const result = configuredLinksSchema.safeParse(stored)
  if (!result.success) {
    logger.warn('Ignored invalid configured quick links storage value', {
      issueCount: result.error.issues.length,
    })
    return []
  }
  const links = normalizeLinks(result.data)
  logger.debug('Loaded configured quick links', { linkCount: links.length })
  return links
}

export const saveConfiguredQuickLink = async (
  input: ConfiguredQuickLink,
): Promise<ConfiguredQuickLink[]> => {
  const link = configuredLinkSchema.parse(input)
  const current = await readConfiguredQuickLinks()
  const next = normalizeLinks([
    ...current.filter(({ id }) => id !== link.id),
    link,
  ])
  await configuredLinksItem.setValue(next)
  logger.info('Saved configured quick link', {
    linkId: link.id,
    linkCount: next.length,
  })
  return next
}

export const removeConfiguredQuickLink = async (
  linkId: string,
): Promise<ConfiguredQuickLink[]> => {
  const normalizedId = z.string().min(1).parse(linkId)
  const next = (await readConfiguredQuickLinks()).filter(
    ({ id }) => id !== normalizedId,
  )
  await configuredLinksItem.setValue(next)
  logger.info('Removed configured quick link', {
    linkId: normalizedId,
    linkCount: next.length,
  })
  return next
}
