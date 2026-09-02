import { describe, expect, it } from 'vitest'
import { parsePageContext } from '@/shared/github/context/parsePageContext'

describe('parsePageContext', () => {
  it('parses a GitHub pull request URL', () => {
    expect(parsePageContext('https://github.com/octo/example/pull/42')).toEqual(
      {
        kind: 'pull-request',
        owner: 'octo',
        repository: 'example',
        pullNumber: 42,
        url: 'https://github.com/octo/example/pull/42',
      },
    )
  })

  it('preserves query and hash variants while parsing the PR identity', () => {
    const context = parsePageContext(
      'https://github.com/octo/example/pull/42/files?diff=split#discussion_r1',
    )

    expect(context).toMatchObject({
      owner: 'octo',
      repository: 'example',
      pullNumber: 42,
    })
    expect(context?.url).toContain('?diff=split#discussion_r1')
  })

  it.each([
    'https://github.com/octo/example/issues/42',
    'https://github.com/octo/example/pull/0',
    'https://github.com/octo/example/pull/not-a-number',
    'https://github.example.com/octo/example/pull/42',
    'http://github.com/octo/example/pull/42',
    'not a URL',
  ])('rejects unsupported URL %s', (url) => {
    expect(parsePageContext(url)).toBeNull()
  })
})
