import {
  consoleLogExporter,
  createLogger,
  isLogLevel,
  type LogLevel,
} from '@abarbonov/structured-logger'

const readConfiguredLogLevel = () => {
  const buildEnv = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>
    }
  ).env
  const processEnv = typeof process === 'undefined' ? undefined : process.env
  const configuredLevel =
    buildEnv?.WXT_MERGELENS_LOG_LEVEL ??
    processEnv?.WXT_MERGELENS_LOG_LEVEL ??
    buildEnv?.LOG_LEVEL ??
    processEnv?.LOG_LEVEL

  const normalizedLevel = configuredLevel?.toLowerCase()
  return isLogLevel(normalizedLevel)
    ? normalizedLevel
    : ('info' satisfies LogLevel)
}

export const logger = createLogger({
  level: readConfiguredLogLevel(),
  name: 'MergeLens',
  exporters: [consoleLogExporter({ format: 'pretty' })],
  redact: {
    presets: ['credentials', 'secrets'],
  },
})
