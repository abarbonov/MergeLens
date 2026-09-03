import { logger as rootLogger } from '@/shared/logging'
import type {
  PullRequestEstimationBand,
  PullRequestEstimationHeuristics,
  PullRequestEstimationInput,
  PullRequestEstimationResult,
  PullRequestEstimationWeights,
} from '../domain/PullRequestEstimation'
import { DEFAULT_PULL_REQUEST_ESTIMATION_HEURISTICS } from '../domain/PullRequestEstimation'
import type {
  EstimatePullRequestInput,
  PullRequestEstimationHeuristicsOverrides,
} from './contracts'

const logger = rootLogger.child({ scope: "pullRequestEstimation.estimate" })

const clamp = (value: number, minimum = 0, maximum = 1): number =>
  Math.min(maximum, Math.max(minimum, value))

const finitePositive = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback

const normalizeHeuristics = (
  overrides: PullRequestEstimationHeuristicsOverrides | undefined,
): PullRequestEstimationHeuristics => {
  const defaults = DEFAULT_PULL_REQUEST_ESTIMATION_HEURISTICS
  const candidateWeights: Partial<PullRequestEstimationWeights> =
    overrides?.weights ?? {}
  const candidateThresholds: Partial<
    PullRequestEstimationHeuristics['thresholds']
  > = overrides?.thresholds ?? {}
  const weights: PullRequestEstimationWeights = {
    changes: finitePositive(candidateWeights.changes, defaults.weights.changes),
    files: finitePositive(candidateWeights.files, defaults.weights.files),
    generatedFiles: finitePositive(
      candidateWeights.generatedFiles,
      defaults.weights.generatedFiles,
    ),
    checks: finitePositive(candidateWeights.checks, defaults.weights.checks),
  }
  const weightTotal = Object.values(weights).reduce(
    (sum, value) => sum + value,
    0,
  )
  Object.keys(weights).forEach((key) => {
    weights[key as keyof PullRequestEstimationWeights] /= weightTotal
  })

  const medium =
    typeof candidateThresholds.medium === 'number' &&
    Number.isFinite(candidateThresholds.medium)
      ? clamp(candidateThresholds.medium, 1, 98)
      : defaults.thresholds.medium
  const high =
    typeof candidateThresholds.high === 'number' &&
    Number.isFinite(candidateThresholds.high)
      ? clamp(candidateThresholds.high, medium + 1, 99)
      : Math.max(defaults.thresholds.high, medium + 1)
  const critical =
    typeof candidateThresholds.critical === 'number' &&
    Number.isFinite(candidateThresholds.critical)
      ? clamp(candidateThresholds.critical, high + 1, 100)
      : Math.max(defaults.thresholds.critical, high + 1)
  const invalid =
    overrides !== undefined &&
    (overrides.weights !== undefined || overrides.thresholds !== undefined) &&
    (Object.values(candidateWeights).some(
      (value) =>
        typeof value !== 'number' || !Number.isFinite(value) || value <= 0,
    ) ||
      medium >= high ||
      high >= critical)
  if (invalid)
    logger.warn('Invalid estimation heuristics; safe values were applied')

  return {
    version:
      typeof overrides?.version === 'string' && overrides.version.trim()
        ? overrides.version.trim()
        : defaults.version,
    weights,
    thresholds: { medium, high, critical },
    maxChangeCount: finitePositive(
      overrides?.maxChangeCount,
      defaults.maxChangeCount,
    ),
    maxFileCount: finitePositive(
      overrides?.maxFileCount,
      defaults.maxFileCount,
    ),
    generatedFilePatterns: Array.isArray(overrides?.generatedFilePatterns)
      ? overrides.generatedFilePatterns
          .filter(
            (pattern): pattern is string =>
              typeof pattern === 'string' && pattern.trim().length > 0,
          )
          .slice(0, 50)
      : defaults.generatedFilePatterns,
  }
}

const classifyBand = (
  score: number,
  thresholds: PullRequestEstimationHeuristics['thresholds'],
): PullRequestEstimationBand => {
  if (score >= thresholds.critical) return 'critical'
  if (score >= thresholds.high) return 'high'
  if (score >= thresholds.medium) return 'medium'
  return 'low'
}

const normalizeInput = (input: PullRequestEstimationInput) => {
  const files = Array.isArray(input.files) ? input.files : []
  const checks = Array.isArray(input.checks) ? input.checks : []
  const safeNumber = (value: number) =>
    Number.isFinite(value) && value >= 0 ? value : 0
  const additions = files.reduce(
    (sum, file) => sum + safeNumber(file.additions),
    0,
  )
  const deletions = files.reduce(
    (sum, file) => sum + safeNumber(file.deletions),
    0,
  )
  const generatedFiles = files.filter(
    (file) => file.isGenerated === true,
  ).length
  const checkRisk = {
    total: checks.length,
    failing: checks.filter((check) =>
      ['failure', 'cancelled', 'timed-out', 'action-required'].includes(
        check.status,
      ),
    ).length,
    inProgress: checks.filter((check) =>
      ['queued', 'in-progress'].includes(check.status),
    ).length,
    unknown: checks.filter((check) => check.status === 'unknown').length,
  }
  return { files, checks, additions, deletions, generatedFiles, checkRisk }
}

export const estimatePullRequest = (
  input: EstimatePullRequestInput,
): PullRequestEstimationResult => {
  const heuristics = normalizeHeuristics(input.heuristics)
  const normalized = normalizeInput(input)
  const truncation = input.truncated ?? { files: false, checks: false }
  const changeCount = normalized.additions + normalized.deletions
  const totalFiles = normalized.files.length
  const changes = clamp(changeCount / heuristics.maxChangeCount)
  const files = clamp(totalFiles / heuristics.maxFileCount)
  const generatedFiles =
    totalFiles === 0 ? 0 : normalized.generatedFiles / totalFiles
  const checks =
    normalized.checkRisk.total === 0
      ? 0
      : clamp(
          (normalized.checkRisk.failing +
            normalized.checkRisk.inProgress * 0.5 +
            normalized.checkRisk.unknown * 0.25) /
            normalized.checkRisk.total,
        )
  const breakdown = {
    changes: Math.round(changes * heuristics.weights.changes * 100),
    files: Math.round(files * heuristics.weights.files * 100),
    generatedFiles: Math.round(
      generatedFiles * heuristics.weights.generatedFiles * 100,
    ),
    checks: Math.round(checks * heuristics.weights.checks * 100),
  }
  const score = clamp(
    Object.values(breakdown).reduce((sum, value) => sum + value, 0),
    0,
    100,
  )
  const uncertain =
    truncation.files ||
    truncation.checks ||
    (totalFiles === 0 && normalized.checkRisk.total === 0)
  logger.debug('Normalized pull request estimation inputs', {
    fileCount: totalFiles,
    generatedFileCount: normalized.generatedFiles,
    additionCount: normalized.additions,
    deletionCount: normalized.deletions,
    checkCount: normalized.checkRisk.total,
    heuristicsVersion: heuristics.version,
  })
  if (uncertain)
    logger.warn('Pull request estimate has truncated or empty input')
  const band = classifyBand(score, heuristics.thresholds)
  logger.info('Pull request estimation completed', {
    score,
    band,
    fileCount: totalFiles,
    checkCount: normalized.checkRisk.total,
  })
  return {
    score,
    band,
    breakdown,
    counts: {
      files: totalFiles,
      generatedFiles: normalized.generatedFiles,
      additions: normalized.additions,
      deletions: normalized.deletions,
      checks: normalized.checkRisk,
    },
    uncertain,
    truncation,
    heuristicsVersion: heuristics.version,
  }
}

export const createEstimatePullRequest = () => estimatePullRequest
