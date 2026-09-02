import { describe, expect, it, vi } from 'vitest'
import {
  observePageContext,
  type LocationChangeDetail,
} from '@/shared/github/dom/navigation'

describe('observePageContext', () => {
  it('publishes initial and distinct WXT location changes once', () => {
    window.history.replaceState({}, '', '/octo/example/pull/1')
    let locationChangeListener:
      ((event: LocationChangeDetail) => void) | undefined
    const handler = vi.fn()
    const context = {
      addEventListener: vi.fn((_target, _type, listener) => {
        locationChangeListener = listener
      }),
    }

    observePageContext(context, window, handler)
    locationChangeListener?.({
      newUrl: new URL('https://github.com/octo/example/pull/2'),
    })
    locationChangeListener?.({
      newUrl: new URL('https://github.com/octo/example/pull/2/files'),
    })
    locationChangeListener?.({
      newUrl: new URL('https://github.com/octo/example/issues/2'),
    })

    expect(handler).toHaveBeenCalledTimes(3)
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ pullNumber: 1 })
    expect(handler.mock.calls[1]?.[0]).toMatchObject({ pullNumber: 2 })
    expect(handler.mock.calls[2]?.[0]).toBeNull()
  })
})
