import type { PullRequestPageContext } from './PageContext'
import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "github.context.parsePageContext" })
const GITHUB_HOSTNAME = 'github.com'

export const parsePageContext = (
  input: string | URL,
): PullRequestPageContext | null => {
  let url: URL

  try {
    url = input instanceof URL ? input : new URL(input)
  } catch {
    logger.warn('Rejected malformed URL')
    return null
  }

  if (url.protocol !== 'https:' || url.hostname !== GITHUB_HOSTNAME) {
    logger.warn('Rejected unsupported origin', {
      protocol: url.protocol,
      hostname: url.hostname,
    })
    return null
  }

  const [owner, repository, resource, pullNumberSegment] = url.pathname
    .split('/')
    .filter(Boolean)
  const pullNumber = Number(pullNumberSegment)

  if (
    !owner ||
    !repository ||
    resource !== 'pull' ||
    !Number.isSafeInteger(pullNumber) ||
    pullNumber <= 0
  ) {
    logger.debug('URL does not identify a pull request', {
      pathname: url.pathname,
    })
    return null
  }

  const context: PullRequestPageContext = {
    kind: 'pull-request',
    owner,
    repository,
    pullNumber,
    url: url.toString(),
  }

  logger.debug('Parsed pull request context', {
    owner,
    repository,
    pullNumber,
  })
  return context
}
