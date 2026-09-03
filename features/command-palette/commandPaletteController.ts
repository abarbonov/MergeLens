import type { ContentScriptContext } from 'wxt/utils/content-script-context'
import { logger as rootLogger } from '@/shared/logging'
import {
  isReceiverUnavailableError,
  sendMessage,
} from '@/shared/messaging/protocol'
import { createCommandRegistry } from './commandRegistry'
import { builtInCommands } from './commands/builtInCommands'
import { createCommandContext } from './commands/context'
import type {
  CommandContext,
  CommandDependencies,
  CommandShortcut,
} from './types'
import type { CommandId } from './types'
import { createKeyboardController } from './keyboardController'
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  type EffectiveWorkspacePreferencesSnapshot,
} from '@/modules/workspace-preferences'
import { DEFAULT_COMMAND_SHORTCUT, getCommandShortcut } from './shortcuts'

const logger = rootLogger.child({ scope: "commandPalette.controller" })
const activeControllers = new WeakMap<Window, CommandPaletteController>()

export interface PaletteControllerUi {
  mount: () => void
  remove: () => void
  render: (props: {
    isOpen: boolean
    context: CommandContext
    onClose: () => void
    onExecute: (commandId: CommandId) => Promise<void>
    returnFocus: HTMLElement | null
    shortcut: CommandShortcut
  }) => void
}

export interface CommandPaletteControllerOptions {
  navigate?: (url: string) => void
  openLocalReviewWorkspace?: () => Promise<void>
  openSettings?: () => Promise<void>
  refreshPullRequestToolbar?: () => Promise<void>
  registerOpenRequest?: (open: () => void) => () => void
  resolveWorkspacePreferences?: (
    context: CommandContext,
  ) => Promise<EffectiveWorkspacePreferencesSnapshot>
  subscribeWorkspacePreferences?: (refresh: () => void) => () => void
}

export interface CommandPaletteController {
  open: () => void
  close: () => void
  remove: () => void
}

export const createCommandPaletteController = (
  ctx: ContentScriptContext,
  ui: PaletteControllerUi,
  targetWindow: Window = window,
  options: CommandPaletteControllerOptions = {},
): CommandPaletteController => {
  const existingController = activeControllers.get(targetWindow)
  if (existingController) {
    logger.warn('Ignored duplicate command palette initialization')
    return existingController
  }

  const registry = createCommandRegistry(builtInCommands)
  const initialContext = createCommandContext(
    new URL(targetWindow.location.href),
  )
  let isOpen = false
  let opener: HTMLElement | null = null

  if (!initialContext) {
    logger.error(
      '[FIX:command-palette-ts] Initial page context is not a supported GitHub URL',
    )
    throw new Error('Command palette requires a GitHub page context')
  }

  let context: CommandContext = initialContext
  let shortcut = DEFAULT_COMMAND_SHORTCUT
  let refreshVersion = 0
  let isRemoved = false

  const dependencies: CommandDependencies = {
    navigate:
      options.navigate ??
      ((url) => {
        targetWindow.location.assign(url)
      }),
    openSettings:
      options.openSettings ??
      (async () => {
        await sendMessage('openOptionsPage')
      }),
    openLocalReviewWorkspace:
      options.openLocalReviewWorkspace ??
      (async () => {
        logger.warn('Local review workspace callback is unavailable')
      }),
    refreshPullRequestToolbar:
      options.refreshPullRequestToolbar ??
      (async () => {
        logger.warn('Toolbar refresh callback is unavailable')
      }),
  }

  const close = (): void => {
    if (!isOpen) {
      return
    }

    isOpen = false
    ui.render({
      isOpen,
      context,
      onClose: close,
      onExecute,
      returnFocus: opener,
      shortcut,
    })
    logger.info('Command palette closed')
  }

  const open = (): void => {
    if (isOpen) {
      return
    }

    opener =
      targetWindow.document.activeElement instanceof HTMLElement
        ? targetWindow.document.activeElement
        : null
    isOpen = true
    ui.render({
      isOpen,
      context,
      onClose: close,
      onExecute,
      returnFocus: opener,
      shortcut,
    })
    logger.info('Command palette opened', {
      availableCount: registry.getAvailable(context).length,
    })
  }

  const onExecute = async (commandId: CommandId): Promise<void> => {
    try {
      await registry.execute(commandId, context, dependencies)
      close()
    } catch (error) {
      if (isReceiverUnavailableError(error)) {
        logger.warn('Palette command receiver unavailable', { commandId })
      } else {
        logger.error('Palette command execution failed', {
          commandId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    }
  }

  const keyboard = createKeyboardController(
    targetWindow,
    {
      open,
      close,
      isOpen: () => isOpen,
    },
    shortcut,
  )

  const applyWorkspacePreferences = (
    snapshot: EffectiveWorkspacePreferencesSnapshot,
  ): void => {
    const shortcutId = snapshot.preferences.featureFlags
      .customCommandPaletteShortcut
      ? snapshot.preferences.commandPaletteShortcut
      : DEFAULT_WORKSPACE_PREFERENCES.commandPaletteShortcut
    const nextShortcut = getCommandShortcut(shortcutId)
    if (!nextShortcut) {
      logger.warn('Using default after unsupported workspace shortcut', {
        source: snapshot.source,
      })
      shortcut = DEFAULT_COMMAND_SHORTCUT
    } else {
      shortcut = nextShortcut
    }

    keyboard.updateShortcut(shortcut)
    ui.render({
      isOpen,
      context,
      onClose: close,
      onExecute,
      returnFocus: opener,
      shortcut,
    })
    logger.info('Applied workspace shortcut preference', {
      source: snapshot.source,
      customShortcutEnabled:
        snapshot.preferences.featureFlags.customCommandPaletteShortcut,
    })
  }

  const refreshWorkspacePreferences = async (): Promise<void> => {
    const currentVersion = ++refreshVersion
    if (!options.resolveWorkspacePreferences) {
      logger.debug(
        'Workspace preference resolver unavailable; using defaults',
        {
          hasRepositoryContext: Boolean(context.repositoryContext),
        },
      )
      return
    }

    try {
      const snapshot = await options.resolveWorkspacePreferences(context)
      if (isRemoved || currentVersion !== refreshVersion) {
        logger.warn('Ignored stale workspace preference refresh', {
          refreshVersion: currentVersion,
          currentVersion: refreshVersion,
          isRemoved,
        })
        return
      }
      applyWorkspacePreferences(snapshot)
      logger.debug('Applied workspace preference snapshot to command palette', {
        hasRepositoryContext: Boolean(context.repositoryContext),
        source: snapshot.source,
        refreshVersion: currentVersion,
      })
    } catch (error) {
      if (isRemoved || currentVersion !== refreshVersion) return
      shortcut = DEFAULT_COMMAND_SHORTCUT
      keyboard.updateShortcut(shortcut)
      ui.render({
        isOpen,
        context,
        onClose: close,
        onExecute,
        returnFocus: opener,
        shortcut,
      })
      logger.warn(
        'Using default command palette preferences after resolver failure',
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      )
    }
  }

  const updateContext = (nextUrl: URL): void => {
    const nextContext = createCommandContext(nextUrl)
    if (!nextContext) {
      logger.warn('Ignored unsupported palette navigation')
      close()
      return
    }

    context = nextContext
    void refreshWorkspacePreferences()
    if (isOpen) {
      ui.render({
        isOpen,
        context,
        onClose: close,
        onExecute,
        returnFocus: opener,
        shortcut,
      })
    }
    logger.debug('Updated palette page context', {
      hasPullRequest: context.pageContext?.kind === 'pull-request',
      hasRepository: Boolean(context.repositoryContext),
    })
  }

  ctx.addEventListener(targetWindow, 'wxt:locationchange', ({ newUrl }) => {
    updateContext(newUrl)
  })
  keyboard.start()
  void refreshWorkspacePreferences()
  let removePreferencesSubscription = () => {}
  if (options.subscribeWorkspacePreferences) {
    try {
      removePreferencesSubscription = options.subscribeWorkspacePreferences(
        () => {
          logger.info('Accepted workspace preference refresh notification')
          void refreshWorkspacePreferences()
        },
      )
    } catch (error: unknown) {
      logger.warn(
        '[FIX:command-palette-runtime] Workspace preference subscription unavailable; continuing with current shortcut',
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      )
    }
  }
  const removeOpenMessageListener =
    options.registerOpenRequest?.(open) ?? (() => {})
  ui.mount()
  ui.render({
    isOpen,
    context,
    onClose: close,
    onExecute,
    returnFocus: opener,
    shortcut,
  })

  const remove = (): void => {
    isRemoved = true
    refreshVersion += 1
    removePreferencesSubscription()
    removeOpenMessageListener()
    keyboard.stop()
    ui.remove()
    activeControllers.delete(targetWindow)
    logger.info('Command palette controller removed')
  }

  const controller = { open, close, remove }
  activeControllers.set(targetWindow, controller)
  ctx.onInvalidated(remove)
  return controller
}
