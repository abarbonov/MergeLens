import type { CheckSummary } from './CheckSummary'
import type { PullRequestEstimationResult } from '@/modules/pull-request-estimation'

export interface PullRequestSummary {
  title: string
  url: string
  state: 'open' | 'closed' | 'merged'
  isDraft: boolean
  authorLogin: string | null
}

export interface PullRequestToolbarData {
  pullRequest: PullRequestSummary
  checks: CheckSummary[]
  diffUrl: string
  files?: PullRequestFileSummary[]
  filesTruncated?: boolean
  estimation?: PullRequestEstimationResult
}

export interface PullRequestFileSummary {
  path: string
  additions: number
  deletions: number
  changes: number
  isGenerated: boolean
}
