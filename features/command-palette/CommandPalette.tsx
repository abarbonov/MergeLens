import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { logger as rootLogger } from '@/shared/logging'
import { createCommandRegistry } from './commandRegistry'
import { builtInCommands } from './commands/builtInCommands'
import type { CommandContext, CommandId, CommandShortcut } from './types'
import { DEFAULT_COMMAND_SHORTCUT } from './shortcuts'
import './CommandPalette.css'

const logger = rootLogger.child({ scope: "commandPalette.ui" })
const registry = createCommandRegistry(builtInCommands)

export interface CommandPaletteProps {
  isOpen: boolean
  context: CommandContext
  onClose: () => void
  onExecute: (commandId: CommandId) => Promise<void>
  returnFocus: HTMLElement | null
  shortcut?: CommandShortcut
}

export const CommandPalette = ({
  isOpen,
  context,
  onClose,
  onExecute,
  returnFocus,
  shortcut = DEFAULT_COMMAND_SHORTCUT,
}: CommandPaletteProps) => {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const listId = useId()
  const commands = useMemo(
    () => registry.search(query, context),
    [context, query],
  )
  const selectedCommand = commands[selectedIndex]

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      queueMicrotask(() => inputRef.current?.focus())
      logger.debug('Palette opened', { resultCount: commands.length })
      return
    }

    if (returnFocus && returnFocus.isConnected) {
      returnFocus.focus()
      logger.debug('Restored palette opener focus')
    }
  }, [isOpen, returnFocus])

  useEffect(() => {
    setSelectedIndex((index) =>
      Math.min(index, Math.max(commands.length - 1, 0)),
    )
    logger.debug('Palette results changed', { resultCount: commands.length })
  }, [commands.length])

  if (!isOpen) {
    return null
  }

  const executeCommand = (commandId?: CommandId): void => {
    const command = commandId
      ? commands.find(({ id }) => id === commandId)
      : selectedCommand
    if (!command) {
      logger.warn('Ignored execution with empty palette results')
      return
    }

    logger.info('Executing selected palette command', { commandId: command.id })
    void onExecute(command.id)
  }

  return (
    <div
      className="command-palette__backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="command-palette__header">
          <h2 id={titleId}>Command palette</h2>
          <kbd>{shortcut.label}</kbd>
          <button
            type="button"
            className="command-palette__close"
            onClick={onClose}
            aria-label="Close command palette"
          >
            Escape
          </button>
        </div>
        <input
          ref={inputRef}
          className="command-palette__input"
          type="search"
          placeholder="Search commands"
          aria-label="Search commands"
          aria-controls={listId}
          aria-activedescendant={
            selectedCommand ? `${listId}-${selectedCommand.id}` : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onClose()
            } else if (event.key === 'ArrowDown' && commands.length > 0) {
              event.preventDefault()
              setSelectedIndex((index) => (index + 1) % commands.length)
            } else if (event.key === 'ArrowUp' && commands.length > 0) {
              event.preventDefault()
              setSelectedIndex(
                (index) => (index - 1 + commands.length) % commands.length,
              )
            } else if (event.key === 'Enter') {
              event.preventDefault()
              executeCommand()
            }
          }}
        />
        <div
          className="command-palette__results"
          id={listId}
          role="listbox"
          aria-label="Available commands"
        >
          {commands.length === 0 ? (
            <p className="command-palette__empty" role="status">
              No commands found
            </p>
          ) : (
            commands.map((command, index) => (
              <button
                id={`${listId}-${command.id}`}
                className={`command-palette__command${index === selectedIndex ? ' command-palette__command--selected' : ''}`}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                key={command.id}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => executeCommand(command.id)}
              >
                <span>{command.title}</span>
                {command.shortcut ? <kbd>{command.shortcut.key}</kbd> : null}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
