import {
  createCommandPaletteController,
  mountCommandPaletteUi,
} from '@/features/command-palette'
import { observePageContext } from '@/shared/github/dom/navigation'
import { mountPrToolbar } from '@/features/pr-toolbar/mountPrToolbar'
import { logger as rootLogger } from '@/shared/logging'
import { onMessage } from '@/shared/messaging/protocol'
import {
  getEffectiveWorkspacePreferences,
  subscribeWorkspacePreferences,
} from '@/modules/workspace-preferences'

const logger = rootLogger.child({ scope: "content" })

export default defineContentScript({
  matches: ['https://github.com/*'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    const paletteUi = await mountCommandPaletteUi(ctx)
    let toolbar: Awaited<ReturnType<typeof mountPrToolbar>> | null = null
    createCommandPaletteController(ctx, paletteUi, window, {
      openLocalReviewWorkspace: async () => {
        if (!toolbar) {
          logger.warn(
            '[FIX:command-palette-runtime] Local review action unavailable before toolbar initialization',
          )
          return
        }
        await toolbar.openLocalReviewWorkspace()
      },
      refreshPullRequestToolbar: async () => {
        if (!toolbar) {
          logger.warn(
            '[FIX:command-palette-runtime] Toolbar refresh unavailable before toolbar initialization',
          )
          return
        }
        await toolbar.refresh()
      },
      registerOpenRequest: (open) =>
        onMessage('openCommandPalette', () => {
          logger.info(
            '[FIX:command-palette-popup] Opening palette from extension popup',
          )
          open()
          return { status: 'success' }
        }),
      resolveWorkspacePreferences: async (commandContext) => {
        const repositoryKey = commandContext.repositoryContext
          ? `${commandContext.repositoryContext.owner}/${commandContext.repositoryContext.repository}`
          : null
        return getEffectiveWorkspacePreferences(repositoryKey)
      },
      subscribeWorkspacePreferences: (refresh) =>
        subscribeWorkspacePreferences((category) => {
          if (category !== 'saved-filters') refresh()
        }),
    })

    try {
      toolbar = await mountPrToolbar(ctx)
      logger.info(
        '[FIX:command-palette-runtime] PR toolbar initialized after command palette',
      )
    } catch (error: unknown) {
      logger.error(
        '[FIX:command-palette-runtime] PR toolbar initialization failed; command palette remains available',
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      )
    }

    observePageContext(ctx, window, (context) => {
      if (!toolbar) {
        logger.warn(
          '[FIX:command-palette-runtime] Ignored toolbar reconciliation before initialization',
        )
        return
      }
      void toolbar.reconcile(context)
    })
    logger.info('Initialized GitHub content surfaces')
  },
})
