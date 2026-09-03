import { logger as rootLogger } from '@/shared/logging'

const logger = rootLogger.child({ scope: "github.dom.selectors" })

export const PR_TOOLBAR_ANCHOR_SELECTORS = [
  '#diff-comparison-viewer-container',
  '[data-testid="issue-metadata-sticky"]',
  '.gh-header-actions',
  '.gh-header-meta',
  '[data-component="SplitPageLayout.Header"]',
  '[data-component="PageHeader"]:has(h1)',
] as const

export const resolvePullRequestToolbarAnchorSelector = (
  root: ParentNode = document,
): string | null => {
  return (
    PR_TOOLBAR_ANCHOR_SELECTORS.find((selector) =>
      root.querySelector(selector),
    ) ?? null
  )
}

export const findPullRequestToolbarAnchor = (
  root: ParentNode = document,
): Element | null => {
  const selector = resolvePullRequestToolbarAnchorSelector(root)
  if (selector) {
    logger.debug('Resolved PR toolbar anchor', { selector })
    return root.querySelector(selector)
  }

  logger.warn('PR toolbar anchor is unavailable')
  return null
}
