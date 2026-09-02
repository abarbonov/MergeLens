import { describe, expect, it } from 'vitest'
import {
  resolveEffectiveWorkspacePreferences,
  normalizeGlobalWorkspacePreferences,
} from '@/modules/workspace-preferences'

describe('pull request estimation preferences', () => {
  it('merges repository estimation overrides field by field', () => {
    const result = resolveEffectiveWorkspacePreferences(
      {
        pullRequestEstimation: {
          weights: { changes: 2 },
          generatedFilePatterns: ['*.gen'],
        },
      },
      {
        repositoryKey: 'Octo/Example',
        pullRequestEstimation: { weights: { checks: 3 } },
      },
    )

    expect(result.pullRequestEstimation?.weights).toMatchObject({
      changes: 2,
      checks: 3,
    })
    expect(result.pullRequestEstimation?.generatedFilePatterns).toEqual([
      '*.gen',
    ])
  })

  it('normalizes and bounds generated-file patterns', () => {
    const result = normalizeGlobalWorkspacePreferences({
      pullRequestEstimation: { generatedFilePatterns: [' *.LOCK ', '*.lock'] },
    })
    expect(result.pullRequestEstimation?.generatedFilePatterns).toEqual([
      '*.lock',
    ])
  })
})
