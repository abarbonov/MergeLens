import {
  createGetReviewInbox,
  createGetPullRequestToolbarData,
  OctokitReviewInboxReader,
  OctokitPullRequestReader,
} from '@/modules/pull-requests'
import {
  createGetPullRequestQuickLinks,
  OctokitQuickLinksReader,
} from '@/modules/quick-links'
import {
  createDeleteReviewTemplate,
  createGetLocalReviewWorkspace,
  createListReviewTemplates,
  createSavePullRequestNote,
  createUpsertReviewTemplate,
  DexieLocalReviewRepository,
} from '@/modules/local-review'
import { readConfiguredQuickLinks } from '@/modules/quick-links/settings'
import { registerReviewNotificationBackground } from '@/modules/review-notifications'
import { logger as rootLogger } from '@/shared/logging'
import { onMessage } from '@/shared/messaging/protocol'

const logger = rootLogger.child({ scope: "background" })

export default defineBackground(() => {
  registerReviewNotificationBackground()
  const getPullRequestToolbarData = createGetPullRequestToolbarData(
    new OctokitPullRequestReader(),
  )
  const getReviewInbox = createGetReviewInbox(new OctokitReviewInboxReader())
  const getPullRequestQuickLinks = createGetPullRequestQuickLinks(
    new OctokitQuickLinksReader(undefined, undefined, readConfiguredQuickLinks),
  )
  const localReviewRepository = new DexieLocalReviewRepository()
  const getLocalReviewWorkspace = createGetLocalReviewWorkspace(
    localReviewRepository,
  )
  const savePullRequestNote = createSavePullRequestNote(localReviewRepository)
  const listReviewTemplates = createListReviewTemplates(localReviewRepository)
  const upsertReviewTemplate = createUpsertReviewTemplate(localReviewRepository)
  const deleteReviewTemplate = createDeleteReviewTemplate(localReviewRepository)

  onMessage('getPullRequestToolbarData', ({ data }) => {
    return getPullRequestToolbarData(data)
  })

  onMessage('getReviewInbox', ({ data }) => {
    return getReviewInbox(data)
  })

  onMessage('getPullRequestQuickLinks', ({ data }) => {
    return getPullRequestQuickLinks(data)
  })

  onMessage('getLocalReviewWorkspace', ({ data }) => {
    return getLocalReviewWorkspace(data)
  })

  onMessage('savePullRequestNote', ({ data }) => {
    return savePullRequestNote(data)
  })

  onMessage('listReviewTemplates', ({ data }) => {
    return listReviewTemplates(data)
  })

  onMessage('upsertReviewTemplate', ({ data }) => {
    return upsertReviewTemplate(data)
  })

  onMessage('deleteReviewTemplate', ({ data }) => {
    return deleteReviewTemplate(data)
  })

  onMessage('openOptionsPage', async () => {
    logger.info('Opening MergeLens options page')
    await browser.runtime.openOptionsPage()
    return { status: 'success' }
  })

  logger.info('MergeLens background listeners registered', {
    extensionId: browser.runtime.id,
  })
})
