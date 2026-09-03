import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { logger } from '@/shared/logging'

const isDebugLoggingEnabled = process.env.LOG_LEVEL?.toLowerCase() === 'debug'
afterEach(() => {
  cleanup()

  if (isDebugLoggingEnabled) {
    logger.debug('Test DOM cleaned up')
  }
})
