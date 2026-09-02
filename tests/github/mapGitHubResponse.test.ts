import { describe, expect, it } from 'vitest'
import {
  getPullRequestHeadSha,
  mapGitHubResponse,
} from '@/modules/pull-requests/adapters/mapGitHubResponse'

const pullRequestResponse = {
  html_url: 'https://github.com/openai/codex/pull/42',
  title: 'Add PR toolbar',
  state: 'closed',
  merged: true,
  draft: null,
  user: { login: 'octocat' },
  head: { sha: 'abc123' },
}

describe('mapGitHubResponse', () => {
  it('maps a pull request and check runs into normalized toolbar data', () => {
    const result = mapGitHubResponse(
      pullRequestResponse,
      {
        check_runs: [
          {
            id: 10,
            name: 'Unit tests',
            status: 'completed',
            conclusion: 'success',
            details_url: 'https://github.com/openai/codex/actions/runs/1',
          },
          {
            id: 11,
            name: 'Browser tests',
            status: 'in_progress',
            conclusion: null,
            details_url: null,
          },
        ],
      },
    )

    expect(result).toEqual({
      pullRequest: {
        title: 'Add PR toolbar',
        url: 'https://github.com/openai/codex/pull/42',
        state: 'merged',
        isDraft: false,
        authorLogin: 'octocat',
      },
      checks: [
        {
          id: '10',
          name: 'Unit tests',
          status: 'success',
          detailsUrl: 'https://github.com/openai/codex/actions/runs/1',
        },
        {
          id: '11',
          name: 'Browser tests',
          status: 'in-progress',
          detailsUrl: null,
        },
      ],
      diffUrl: 'https://github.com/openai/codex/pull/42.diff',
    })
    expect(getPullRequestHeadSha(pullRequestResponse)).toBe('abc123')
  })

  it('supports an empty checks response', () => {
    expect(
      mapGitHubResponse(
        pullRequestResponse,
        { check_runs: [] },
      ).checks,
    ).toEqual([])
  })

  it.each(['waiting', 'requested'] as const)(
    'maps the GitHub %s state to queued',
    (status) => {
      const result = mapGitHubResponse(
        pullRequestResponse,
        {
          check_runs: [
            {
              id: 12,
              name: 'Queued workflow',
              status,
              conclusion: null,
              details_url: null,
            },
          ],
        },
      )

      expect(result.checks[0]?.status).toBe('queued')
    },
  )

  it('rejects malformed GitHub payloads', () => {
    expect(() =>
      mapGitHubResponse(
        { ...pullRequestResponse, html_url: 'not-a-url' },
        { check_runs: [] },
      ),
    ).toThrow()
  })
})
