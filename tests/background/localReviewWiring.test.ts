import { beforeEach, describe, expect, it, vi } from 'vitest'

const wiring = vi.hoisted(() => {
  const repository = { kind: 'local-review-repository' }
  return {
    repository,
    backgroundResult: undefined as unknown,
    onMessage: vi.fn(),
    getLocalReviewWorkspace: vi.fn(),
    savePullRequestNote: vi.fn(),
    listReviewTemplates: vi.fn(),
    upsertReviewTemplate: vi.fn(),
    deleteReviewTemplate: vi.fn(),
    DexieLocalReviewRepository: vi.fn(function () {
      return repository
    }),
    createGetLocalReviewWorkspace: vi.fn(),
    createSavePullRequestNote: vi.fn(),
    createListReviewTemplates: vi.fn(),
    createUpsertReviewTemplate: vi.fn(),
    createDeleteReviewTemplate: vi.fn(),
  }
})

vi.mock('@/modules/local-review', () => ({
  DexieLocalReviewRepository: wiring.DexieLocalReviewRepository,
  createGetLocalReviewWorkspace: wiring.createGetLocalReviewWorkspace,
  createSavePullRequestNote: wiring.createSavePullRequestNote,
  createListReviewTemplates: wiring.createListReviewTemplates,
  createUpsertReviewTemplate: wiring.createUpsertReviewTemplate,
  createDeleteReviewTemplate: wiring.createDeleteReviewTemplate,
}))

vi.mock('@/modules/pull-requests', () => ({
  OctokitPullRequestReader: vi.fn(),
  OctokitReviewInboxReader: vi.fn(),
  createGetPullRequestToolbarData: vi.fn(() => vi.fn()),
  createGetReviewInbox: vi.fn(() => vi.fn()),
}))

vi.mock('@/modules/review-notifications', () => ({
  registerReviewNotificationBackground: vi.fn(),
}))

vi.mock('@/modules/quick-links', () => ({
  OctokitQuickLinksReader: vi.fn(),
  createGetPullRequestQuickLinks: vi.fn(() => vi.fn()),
}))

vi.mock('@/modules/quick-links/settings', () => ({
  readConfiguredQuickLinks: vi.fn(),
}))

vi.mock('@/shared/logging', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

vi.mock('@/shared/messaging/protocol', () => ({
  onMessage: wiring.onMessage,
}))

describe('local review background wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    wiring.createGetLocalReviewWorkspace.mockReturnValue(
      wiring.getLocalReviewWorkspace,
    )
    wiring.createSavePullRequestNote.mockReturnValue(wiring.savePullRequestNote)
    wiring.createListReviewTemplates.mockReturnValue(wiring.listReviewTemplates)
    wiring.createUpsertReviewTemplate.mockReturnValue(
      wiring.upsertReviewTemplate,
    )
    wiring.createDeleteReviewTemplate.mockReturnValue(
      wiring.deleteReviewTemplate,
    )
    vi.stubGlobal('browser', {
      runtime: { id: 'test-extension', openOptionsPage: vi.fn() },
    })
    vi.stubGlobal('defineBackground', (callback: () => unknown) => {
      wiring.backgroundResult = callback()
      return wiring.backgroundResult
    })
  })

  it('registers every listener synchronously with one repository instance', async () => {
    await import('@/entrypoints/background')

    expect(wiring.backgroundResult).toBeUndefined()
    expect(wiring.DexieLocalReviewRepository).toHaveBeenCalledTimes(1)
    expect(wiring.createGetLocalReviewWorkspace).toHaveBeenCalledWith(
      wiring.repository,
    )
    expect(wiring.createSavePullRequestNote).toHaveBeenCalledWith(
      wiring.repository,
    )
    expect(wiring.createListReviewTemplates).toHaveBeenCalledWith(
      wiring.repository,
    )
    expect(wiring.createUpsertReviewTemplate).toHaveBeenCalledWith(
      wiring.repository,
    )
    expect(wiring.createDeleteReviewTemplate).toHaveBeenCalledWith(
      wiring.repository,
    )

    const registeredMessages = wiring.onMessage.mock.calls.map(([name]) => name)
    expect(registeredMessages).toEqual(
      expect.arrayContaining([
        'getLocalReviewWorkspace',
        'savePullRequestNote',
        'listReviewTemplates',
        'upsertReviewTemplate',
        'deleteReviewTemplate',
      ]),
    )
  })
})
