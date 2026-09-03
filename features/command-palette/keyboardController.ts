import { logger as rootLogger } from '@/shared/logging'
import type { CommandShortcut } from './types'
import {
  DEFAULT_COMMAND_SHORTCUT,
  isSupportedCommandShortcut,
} from './shortcuts'

const logger = rootLogger.child({ scope: "commandPalette.keyboard" })

export interface KeyboardControllerCallbacks {
  open: () => void
  close: () => void
  isOpen: () => boolean
}

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.isContentEditable ||
    target.matches('input, textarea, select, [contenteditable="true"]')
  )
}
export const isPaletteShortcut = (
  event: KeyboardEvent,
  shortcut: CommandShortcut = DEFAULT_COMMAND_SHORTCUT,
): boolean => {
  const requiresShift = shortcut.modifiers.length === 2
  const hasOnePrimaryModifier = event.metaKey !== event.ctrlKey
  const matches =
    event.key.toLowerCase() === shortcut.key &&
    hasOnePrimaryModifier &&
    !event.altKey &&
    event.shiftKey === requiresShift
  logger.debug('Evaluated command palette shortcut', { matches })
  return matches
}

export const createKeyboardController = (
  target: Window,
  callbacks: KeyboardControllerCallbacks,
  initialShortcut: CommandShortcut = DEFAULT_COMMAND_SHORTCUT,
) => {
  let started = false
  let shortcut = isSupportedCommandShortcut(initialShortcut)
    ? initialShortcut
    : DEFAULT_COMMAND_SHORTCUT

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && callbacks.isOpen()) {
      logger.info('Closing palette from Escape')
      event.preventDefault()
      callbacks.close()
      return
    }

    if (!isPaletteShortcut(event, shortcut)) {
      return
    }

    if (isEditableTarget(event.target)) {
      logger.warn('Ignored palette shortcut from editable target')
      return
    }

    event.preventDefault()
    event.stopPropagation()
    logger.info('Opening palette from keyboard shortcut')
    callbacks.open()
  }

  return {
    updateShortcut: (nextShortcut: CommandShortcut): boolean => {
      if (!isSupportedCommandShortcut(nextShortcut)) {
        logger.warn('Rejected unsupported command palette shortcut')
        return false
      }
      if (shortcut === nextShortcut) return true

      shortcut = nextShortcut
      logger.info('Applied command palette keyboard shortcut')
      logger.debug('Kept keyboard listener while replacing shortcut state', {
        listenerStarted: started,
      })
      return true
    },
    start: (): void => {
      if (started) {
        logger.warn('Ignored duplicate keyboard controller start')
        return
      }

      target.addEventListener('keydown', handleKeyDown, true)
      started = true
      logger.debug('Keyboard controller started')
    },
    stop: (): void => {
      if (!started) {
        return
      }

      target.removeEventListener('keydown', handleKeyDown, true)
      started = false
      logger.debug('Keyboard controller stopped')
    },
  }
}
