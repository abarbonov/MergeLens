import { createRoot, type Root } from 'react-dom/client'
import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { createLocalReviewController } from '@/features/local-review/localReviewController'
import type { LocalReviewController } from '@/features/local-review/types'
import type { PullRequestPageContext } from '@/shared/github/context/PageContext'
import {
  findPullRequestToolbarAnchor,
  resolvePullRequestToolbarAnchorSelector,
} from '@/shared/github/dom/selectors'
import { logger as rootLogger } from '@/shared/logging'
import {
  createCorrelationId,
  isReceiverUnavailableError,
  sendMessage,
} from '@/shared/messaging/protocol'
import type { ToolbarResponse } from '@/shared/messaging/schemas'
import { PRToolbar } from './PRToolbar'
import type { PRToolbarState } from './types'
import './PRToolbar.css'

const logger = rootLogger.child({ scope: "prToolbar.mount" })

const appendToolbar = (anchor: Element, ui: Element): void => {
  if (anchor.id === 'diff-comparison-viewer-container') {
    const header = anchor.querySelector(
      '[data-component="SplitPageLayout.Header"]',
    )
    if (header) {
      header.insertAdjacentElement('afterend', ui)
      return
    }

    anchor.prepend(ui)
    return
  }

  anchor.parentElement?.insertBefore(ui, anchor.nextElementSibling)
}

interface ToolbarUi {
  autoMount: () => void
  remove: () => void
  render: (state: PRToolbarState) => void
}

interface ToolbarUiCallbacks {
  getLocalReviewController: () => LocalReviewController | null
  isLocalReviewOpen: () => boolean
  onOpenSettings: () => void
  onRetry: () => void
  onToggleLocalReview: () => void
}

type ToolbarUiFactory = (
  ctx: ContentScriptContext,
  callbacks: ToolbarUiCallbacks,
) => Promise<ToolbarUi>

interface ToolbarMountOptions {
  createUi?: ToolbarUiFactory
  createReviewController?: typeof createLocalReviewController
  sendToolbarMessage?: typeof sendMessage
  sendQuickLinksMessage?: typeof sendMessage
  findAnchor?: typeof findPullRequestToolbarAnchor
  openSettings?: () => void | Promise<void>
}

const createToolbarUi: ToolbarUiFactory = async (ctx, callbacks) => {
  let currentState: PRToolbarState = { status: 'unsupported-context' }
  let hostObserver: MutationObserver | null = null
  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'mergelens-pr-toolbar',
    position: 'inline',
    anchor: resolvePullRequestToolbarAnchorSelector,
    append: appendToolbar,
    isolateEvents: ['click', 'keydown'],
    onMount: (container) => {
      const root = createRoot(container)
      root.render(
        <PRToolbar
          state={currentState}
          localReviewController={
            callbacks.getLocalReviewController() ?? undefined
          }
          isLocalReviewOpen={callbacks.isLocalReviewOpen()}
          onOpenSettings={callbacks.onOpenSettings}
          onRetry={callbacks.onRetry}
          onToggleLocalReview={callbacks.onToggleLocalReview}
        />,
      )
      return root
    },
    onRemove: (root) => root?.unmount(),
  })

  const render = (state: PRToolbarState) => {
    currentState = state
    ui.mounted?.render(
      <PRToolbar
        state={currentState}
        localReviewController={
          callbacks.getLocalReviewController() ?? undefined
        }
        isLocalReviewOpen={callbacks.isLocalReviewOpen()}
        onOpenSettings={callbacks.onOpenSettings}
        onRetry={callbacks.onRetry}
        onToggleLocalReview={callbacks.onToggleLocalReview}
      />,
    )
  }

  return {
    autoMount: () => {
      ui.autoMount()
      hostObserver ??= new MutationObserver(() => {
        if (ui.shadowHost.isConnected) {
          return
        }

        logger.debug(
          '[FIX:pr-toolbar-lifecycle] Detected detached Shadow host',
          {
            toolbarStatus: currentState.status,
          },
        )
        const selector = resolvePullRequestToolbarAnchorSelector()
        const anchor = selector ? document.querySelector(selector) : null
        if (!anchor) {
          logger.warn(
            '[FIX:pr-toolbar-lifecycle] Shadow host has no available anchor',
          )
          return
        }

        appendToolbar(anchor, ui.shadowHost)
        logger.info(
          '[FIX:pr-toolbar-lifecycle] Restored detached Shadow host',
          {
            selector,
          },
        )
      })
      hostObserver.observe(document.body, { childList: true, subtree: true })
      render(currentState)
    },
    remove: () => {
      hostObserver?.disconnect()
      hostObserver = null
      ui.remove()
    },
    render,
  }
}

const toToolbarState = (response: ToolbarResponse): PRToolbarState => {
  if (response.status === 'success') {
    return { status: 'success', data: response.data }
  }

  return { status: 'error', error: response.error }
}

const getContextKey = (context: PullRequestPageContext): string => {
  return `${context.owner}/${context.repository}#${context.pullNumber}`
}

export const mountPrToolbar = async (
  ctx: ContentScriptContext,
  options: ToolbarMountOptions = {},
) => {
  const createUi = options.createUi ?? createToolbarUi
  const findAnchor = options.findAnchor ?? findPullRequestToolbarAnchor
  const sendToolbarMessage = options.sendToolbarMessage ?? sendMessage
  const createReviewController =
    options.createReviewController ?? createLocalReviewController
  const sendQuickLinksMessage =
    options.sendQuickLinksMessage ??
    (options.sendToolbarMessage ? null : sendMessage)
  const openSettings =
    options.openSettings ?? (() => sendMessage('openOptionsPage'))
  let currentContext: PullRequestPageContext | null = null
  let currentContextKey: string | null = null
  let currentState: PRToolbarState = { status: 'unsupported-context' }
  let localReviewController: LocalReviewController | null = null
  let isLocalReviewOpen = false
  let ui: ToolbarUi | null = null
  let uiPromise: Promise<ToolbarUi> | null = null
  let uiSequence = 0
  let requestSequence = 0

  const render = () => ui?.render(currentState)

  const loadToolbarData = async (context: PullRequestPageContext) => {
    const requestId = ++requestSequence
    const contextKey = getContextKey(context)
    const correlationId = createCorrelationId()
    currentState = { status: 'loading' }
    render()
    logger.info('Loading toolbar data for page context', { contextKey })
    logger.debug('Sending toolbar data request', { requestId, correlationId })

    try {
      const response = await sendToolbarMessage('getPullRequestToolbarData', {
        context,
        correlationId,
      })

      if (requestId !== requestSequence || currentContextKey !== contextKey) {
        logger.debug('Ignored stale toolbar response', {
          requestId,
          correlationId,
        })
        return
      }

      currentState = toToolbarState(response)
      render()
      if (currentState.status === 'success' && sendQuickLinksMessage) {
        currentState = { ...currentState, quickLinksStatus: 'loading' }
        render()
        try {
          const quickLinksResponse = await sendQuickLinksMessage(
            'getPullRequestQuickLinks',
            { context, correlationId: createCorrelationId() },
          )
          if (
            requestId !== requestSequence ||
            currentContextKey !== contextKey
          ) {
            logger.debug('Ignored stale quick links response', {
              requestId,
              contextKey,
            })
            return
          }
          if (quickLinksResponse.status === 'success') {
            currentState = {
              status: 'success',
              data: {
                ...currentState.data,
                quickLinks: quickLinksResponse.data,
              },
              quickLinksStatus: 'success',
            }
            render()
          } else {
            logger.warn('Quick links request returned an expected error', {
              code: quickLinksResponse.error.code,
            })
            currentState = {
              ...currentState,
              quickLinksStatus: 'error',
              quickLinksError: quickLinksResponse.error,
            }
            render()
          }
        } catch (quickLinksError) {
          if (
            requestId !== requestSequence ||
            currentContextKey !== contextKey
          ) {
            logger.debug('Ignored stale quick links request failure', {
              requestId,
              contextKey,
            })
            return
          }

          logger.warn(
            'Quick links request failed while preserving toolbar data',
            {
              errorName:
                quickLinksError instanceof Error
                  ? quickLinksError.name
                  : 'UnknownError',
            },
          )
          currentState = {
            ...currentState,
            quickLinksStatus: 'error',
            quickLinksError: {
              code: isReceiverUnavailableError(quickLinksError)
                ? 'receiver-unavailable'
                : 'unknown-error',
              message: 'Unable to load quick links',
            },
          }
          render()
        }
      }
    } catch (error) {
      if (requestId !== requestSequence || currentContextKey !== contextKey) {
        logger.debug('Ignored stale toolbar request failure', {
          requestId,
          correlationId,
        })
        return
      }

      const isUnavailable = isReceiverUnavailableError(error)
      const code = isUnavailable ? 'receiver-unavailable' : 'unknown-error'
      const log = isUnavailable ? logger.warn : logger.error
      log('Toolbar data request failed', { requestId, correlationId, code })
      currentState = {
        status: 'error',
        error: {
          code,
          message: isUnavailable
            ? 'MergeLens background is unavailable'
            : 'Unable to load PR toolbar data',
        },
      }
      render()
    }
  }

  const disposeLocalReview = (): void => {
    const controller = localReviewController
    localReviewController = null
    if (!controller) {
      return
    }

    void controller.dispose().catch((error: unknown) => {
      logger.error('Failed to dispose local review controller', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
    })
  }

  const remove = () => {
    requestSequence += 1
    uiSequence += 1
    currentContext = null
    currentContextKey = null
    if (isLocalReviewOpen) {
      logger.info('Closed local review workspace during toolbar removal')
    }
    isLocalReviewOpen = false
    disposeLocalReview()
    uiPromise = null
    if (!ui) {
      return
    }

    ui.remove()
    ui = null
    currentState = { status: 'unsupported-context' }
    logger.info('Removed PR toolbar UI')
  }

  const ensureUi = async () => {
    if (ui) {
      return
    }

    const anchor = findAnchor()
    logger.debug('Resolved initial PR toolbar anchor', {
      isAvailable: Boolean(anchor),
    })
    if (!anchor) {
      logger.warn('PR toolbar will wait for a dynamic GitHub anchor')
    }

    const creationSequence = uiSequence
    uiPromise ??= createUi(ctx, {
      getLocalReviewController: () => localReviewController,
      isLocalReviewOpen: () => isLocalReviewOpen,
      onOpenSettings: () => {
        try {
          void Promise.resolve(openSettings()).catch((error: unknown) => {
            logger.error('Failed to open MergeLens settings', {
              errorName: error instanceof Error ? error.name : 'UnknownError',
            })
          })
        } catch (error) {
          logger.error('Failed to open MergeLens settings', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          })
        }
      },
      onRetry: () => {
        if (currentContext) {
          void loadToolbarData(currentContext)
        }
      },
      onToggleLocalReview: () => {
        if (!localReviewController || !currentContextKey) {
          logger.warn('Ignored local review toggle without PR context')
          return
        }

        isLocalReviewOpen = !isLocalReviewOpen
        render()
        logger.info(
          isLocalReviewOpen
            ? 'Opened local review workspace from toolbar'
            : 'Closed local review workspace from toolbar',
          { contextKey: currentContextKey },
        )
      },
    })
    const creationPromise = uiPromise
    const createdUi = await creationPromise
    if (creationSequence !== uiSequence || !currentContextKey) {
      createdUi.remove()
      if (uiPromise === creationPromise) {
        uiPromise = null
      }
      return
    }

    if (!ui) {
      ui = createdUi
      ui.autoMount()
    }
    render()
    logger.info('Started PR toolbar UI mounting')
  }

  const reconcile = async (nextContext: PullRequestPageContext | null) => {
    if (!nextContext) {
      remove()
      return
    }

    const nextContextKey = getContextKey(nextContext)
    if (currentContextKey === nextContextKey && ui) {
      logger.debug('Ignored duplicate toolbar reconciliation', {
        contextKey: nextContextKey,
      })
      return
    }

    const previousContextKey = currentContextKey
    currentContext = nextContext
    currentContextKey = nextContextKey
    logger.info('Reconciling PR toolbar context', {
      contextKey: nextContextKey,
    })
    if (!localReviewController) {
      localReviewController = createReviewController(nextContext)
      logger.info('Created local review controller', {
        contextKey: nextContextKey,
      })
    } else {
      localReviewController.reconcileContext(nextContext)
      if (previousContextKey !== nextContextKey && isLocalReviewOpen) {
        isLocalReviewOpen = false
        render()
        logger.info('Closed local review workspace for new PR context', {
          previousContextKey,
          contextKey: nextContextKey,
        })
      }
    }
    await ensureUi()
    if (currentContextKey !== nextContextKey || !ui) {
      logger.debug('Skipped superseded toolbar reconciliation', {
        contextKey: nextContextKey,
      })
      return
    }
    await loadToolbarData(nextContext)
  }

  ctx.onInvalidated(remove)
  const refresh = async (): Promise<void> => {
    if (!currentContext) {
      logger.warn('Ignored toolbar refresh without PR context')
      return
    }

    logger.info('Refreshing PR toolbar from external action', {
      contextKey: currentContextKey,
    })
    await loadToolbarData(currentContext)
  }

  const openLocalReviewWorkspace = async (): Promise<void> => {
    if (!currentContext || !localReviewController) {
      logger.warn('Ignored local review open request without PR context')
      return
    }

    await ensureUi()
    if (!ui || !currentContextKey) {
      logger.warn('Local review workspace UI is unavailable')
      return
    }
    if (isLocalReviewOpen) {
      logger.debug('Ignored duplicate local review open request', {
        contextKey: currentContextKey,
      })
      return
    }

    isLocalReviewOpen = true
    render()
    logger.info('Opened local review workspace from external action', {
      contextKey: currentContextKey,
    })
  }

  return { reconcile, refresh, openLocalReviewWorkspace, remove }
}
