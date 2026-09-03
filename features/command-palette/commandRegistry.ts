import { logger as rootLogger } from '@/shared/logging'
import type {
  Command,
  CommandContext,
  CommandDependencies,
  CommandExecutionResult,
  CommandId,
} from './types'

const logger = rootLogger.child({ scope: "commandPalette.registry" })

const normalizeSearchValue = (value: string): string =>
  value.trim().toLocaleLowerCase()

export interface CommandRegistry {
  getAvailable: (context: CommandContext) => readonly Command[]
  search: (query: string, context: CommandContext) => readonly Command[]
  execute: (
    commandId: CommandId,
    context: CommandContext,
    dependencies: CommandDependencies,
  ) => Promise<CommandExecutionResult>
}

export const createCommandRegistry = (
  commands: readonly Command[],
): CommandRegistry => {
  const commandsById = new Map<CommandId, Command>()

  for (const command of commands) {
    if (commandsById.has(command.id)) {
      logger.warn('Rejected duplicate command registration', {
        commandId: command.id,
      })
      throw new Error(`Duplicate command ID: ${command.id}`)
    }

    commandsById.set(command.id, command)
    logger.debug('Registered command', { commandId: command.id })
  }

  const getAvailable = (context: CommandContext): readonly Command[] => {
    const availableCommands = commands.filter((command) =>
      command.isAvailable(context),
    )
    logger.debug('Resolved available commands', {
      count: availableCommands.length,
    })
    return availableCommands
  }

  const search = (
    query: string,
    context: CommandContext,
  ): readonly Command[] => {
    const normalizedQuery = normalizeSearchValue(query)
    const availableCommands = getAvailable(context)
    logger.debug('Filtering commands', {
      queryLength: normalizedQuery.length,
      availableCount: availableCommands.length,
    })

    if (!normalizedQuery) {
      return availableCommands
    }

    return availableCommands.filter((command) => {
      const searchableValues = [command.title, ...command.keywords]
      return searchableValues.some((value) =>
        normalizeSearchValue(value).includes(normalizedQuery),
      )
    })
  }

  const execute = async (
    commandId: CommandId,
    context: CommandContext,
    dependencies: CommandDependencies,
  ): Promise<CommandExecutionResult> => {
    const command = commandsById.get(commandId)
    if (!command) {
      logger.warn('Rejected unknown command execution', { commandId })
      throw new Error(`Unknown command: ${commandId}`)
    }

    if (!command.isAvailable(context)) {
      logger.warn('Rejected unavailable command execution', { commandId })
      throw new Error(`Command is unavailable: ${commandId}`)
    }

    const correlationId = crypto.randomUUID()
    logger.debug('Executing command', { commandId, correlationId })

    try {
      const result = await command.execute(context, dependencies)
      logger.info('Command execution completed', { commandId, correlationId })
      return result
    } catch (error) {
      logger.error('Command execution failed', {
        commandId,
        correlationId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      throw error
    }
  }

  return { getAvailable, search, execute }
}
