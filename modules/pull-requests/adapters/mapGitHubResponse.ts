import { z } from 'zod'
import type { CheckStatus } from '../domain/CheckSummary'
import type {
  PullRequestFileSummary,
  PullRequestToolbarData,
} from '../domain/PullRequestSummary'

const pullRequestResponseSchema = z.object({
  html_url: z.url(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  draft: z.boolean().nullable(),
  user: z.object({ login: z.string() }).nullable(),
  head: z.object({ sha: z.string().min(1) }),
})

const checkRunsResponseSchema = z.object({
  check_runs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      name: z.string().min(1),
      status: z.enum([
        'queued',
        'in_progress',
        'completed',
        'pending',
        'waiting',
        'requested',
      ]),
      conclusion: z
        .enum([
          'success',
          'failure',
          'neutral',
          'cancelled',
          'skipped',
          'timed_out',
          'action_required',
          'stale',
          'startup_failure',
        ])
        .nullable(),
      details_url: z.url().nullable(),
    }),
  ),
})

const pullRequestFilesResponseSchema = z.array(
  z.object({
    filename: z.string().min(1),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    changes: z.number().int().nonnegative(),
    status: z.string().optional(),
    generated: z.boolean().optional(),
  }),
)

const generatedFilePatterns = [
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
]
const matchesGeneratedPattern = (path: string): boolean =>
  generatedFilePatterns.some((pattern) =>
    pattern.startsWith('*.')
      ? path.toLowerCase().endsWith(pattern.slice(1))
      : path.toLowerCase().endsWith(pattern.toLowerCase()),
  )

export const mapPullRequestFiles = (
  input: unknown,
): PullRequestFileSummary[] => {
  const files = pullRequestFilesResponseSchema.parse(input)
  return files.map((file) => ({
    path: file.filename,
    additions: file.additions,
    deletions: file.deletions,
    changes: file.changes,
    isGenerated:
      file.generated === true || matchesGeneratedPattern(file.filename),
  }))
}

const mapCheckStatus = (
  status:
    | 'queued'
    | 'in_progress'
    | 'completed'
    | 'pending'
    | 'waiting'
    | 'requested',
  conclusion:
    | 'success'
    | 'failure'
    | 'neutral'
    | 'cancelled'
    | 'skipped'
    | 'timed_out'
    | 'action_required'
    | 'stale'
    | 'startup_failure'
    | null,
): CheckStatus => {
  if (
    status === 'queued' ||
    status === 'pending' ||
    status === 'waiting' ||
    status === 'requested'
  ) {
    return 'queued'
  }

  if (status === 'in_progress') {
    return 'in-progress'
  }

  const conclusions: Partial<
    Record<NonNullable<typeof conclusion>, CheckStatus>
  > = {
    action_required: 'action-required',
    cancelled: 'cancelled',
    failure: 'failure',
    neutral: 'neutral',
    skipped: 'skipped',
    success: 'success',
    timed_out: 'timed-out',
  }

  return conclusion ? (conclusions[conclusion] ?? 'unknown') : 'unknown'
}

export const getPullRequestHeadSha = (input: unknown): string => {
  return pullRequestResponseSchema.parse(input).head.sha
}

export const mapGitHubResponse = (
  pullRequestInput: unknown,
  checkRunsInput: unknown,
  filesInput?: unknown,
  filesTruncated = false,
): PullRequestToolbarData => {
  const pullRequest = pullRequestResponseSchema.parse(pullRequestInput)
  const checkRuns = checkRunsResponseSchema.parse(checkRunsInput)

  const files =
    filesInput === undefined ? undefined : mapPullRequestFiles(filesInput)
  return {
    pullRequest: {
      title: pullRequest.title,
      url: pullRequest.html_url,
      state: pullRequest.merged ? 'merged' : pullRequest.state,
      isDraft: pullRequest.draft ?? false,
      authorLogin: pullRequest.user?.login ?? null,
    },
    checks: checkRuns.check_runs.map((checkRun) => ({
      id: String(checkRun.id),
      name: checkRun.name,
      status: mapCheckStatus(checkRun.status, checkRun.conclusion),
      detailsUrl: checkRun.details_url,
    })),
    diffUrl: `${pullRequest.html_url}.diff`,
    ...(files === undefined ? {} : { files, filesTruncated }),
  }
}
