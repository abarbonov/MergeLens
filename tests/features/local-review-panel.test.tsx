import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalReviewPanel } from '@/features/local-review/LocalReviewPanel'
import { createLocalReviewController } from '@/features/local-review/localReviewController'
import type {
  LocalReviewController,
  LocalReviewTransport,
} from '@/features/local-review/types'
import type { SavePullRequestNoteResponse } from '@/shared/messaging/schemas'

const context = { owner: 'Octo', repository: 'Example', pullNumber: 42 }

const template = {
  id: 'template-1',
  title: 'Correctness review',
  body: 'Check edge cases',
  createdAt: '2026-08-14T10:00:00.000Z',
  updatedAt: '2026-08-14T10:00:00.000Z',
}

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const createTransport = (
  overrides: Partial<LocalReviewTransport> = {},
): LocalReviewTransport => ({
  loadWorkspace: vi.fn<LocalReviewTransport['loadWorkspace']>(
    async (_context, correlationId) => ({
      status: 'success' as const,
      correlationId,
      data: { note: null, templates: [] },
    }),
  ),
  saveNote: vi.fn<LocalReviewTransport['saveNote']>(
    async (_context, body, correlationId) => ({
      status: 'success' as const,
      correlationId,
      data: {
        note:
          body.length === 0
            ? null
            : {
                prKey: 'octo/example#42',
                owner: 'octo',
                repository: 'example',
                pullNumber: 42,
                body,
                updatedAt: '2026-08-14T10:00:00.000Z',
              },
      },
    }),
  ),
  writeClipboard: vi.fn().mockResolvedValue(undefined),
  ...overrides,
})

const controllers: LocalReviewController[] = []

const renderPanel = (transport: LocalReviewTransport, debounceMs = 600) => {
  let correlationSequence = 0
  const controller = createLocalReviewController(context, {
    transport,
    debounceMs,
    createCorrelationId: () => `panel-${++correlationSequence}`,
  })
  controllers.push(controller)
  render(<LocalReviewPanel controller={controller} />)
  return controller
}

afterEach(async () => {
  await Promise.all(
    controllers.splice(0).map((controller) => controller.dispose()),
  )
  vi.useRealTimers()
})

describe('LocalReviewPanel', () => {
  it('renders loading and empty ready states accessibly', async () => {
    const load =
      deferred<Awaited<ReturnType<LocalReviewTransport['loadWorkspace']>>>()
    renderPanel(createTransport({ loadWorkspace: vi.fn(() => load.promise) }))

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading your private review workspace',
    )
    await act(async () => {
      load.resolve({
        status: 'success',
        correlationId: 'panel-1',
        data: { note: null, templates: [] },
      })
    })

    expect(
      screen.getByRole('textbox', { name: 'Pull request note' }),
    ).toBeEnabled()
    expect(
      screen.getByText(/Start a note or create reusable templates/),
    ).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: 'Review template' }),
    ).toBeDisabled()
  })

  it('inserts a template at the cursor without replacing selected text', async () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined)
    renderPanel(
      createTransport({
        loadWorkspace: vi.fn<LocalReviewTransport['loadWorkspace']>(
          async (_context, correlationId) => ({
            status: 'success' as const,
            correlationId,
            data: {
              note: {
                prKey: 'octo/example#42',
                owner: 'octo',
                repository: 'example',
                pullNumber: 42,
                body: 'Alpha Beta',
                updatedAt: '2026-08-14T10:00:00.000Z',
              },
              templates: [template],
            },
          }),
        ),
        writeClipboard,
      }),
    )
    const editor = await screen.findByRole('textbox', {
      name: 'Pull request note',
    })
    ;(editor as HTMLTextAreaElement).setSelectionRange(6, 10)

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Review template' }),
      {
        target: { value: 'template-1' },
      },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }))
    expect(editor).toHaveValue('Alpha Check edge casesBeta')

    fireEvent.click(screen.getByRole('button', { name: 'Copy note' }))
    await screen.findByText('Note copied to clipboard')
    expect(writeClipboard).toHaveBeenCalledWith('Alpha Check edge casesBeta')
  })

  it('shows dirty, saving, and saved autosave states', async () => {
    vi.useFakeTimers()
    const save = deferred<SavePullRequestNoteResponse>()
    const transport = createTransport({ saveNote: vi.fn(() => save.promise) })
    renderPanel(transport, 50)
    await act(async () => Promise.resolve())
    const editor = screen.getByRole('textbox', { name: 'Pull request note' })

    fireEvent.change(editor, { target: { value: 'Pending review note' } })
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saving')

    await act(async () => {
      save.resolve({
        status: 'success',
        correlationId: 'panel-2',
        data: {
          note: {
            prKey: 'octo/example#42',
            owner: 'octo',
            repository: 'example',
            pullNumber: 42,
            body: 'Pending review note',
            updatedAt: '2026-08-14T10:00:00.000Z',
          },
        },
      })
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('renders receiver retry and recoverable clipboard feedback', async () => {
    const transport = createTransport({
      loadWorkspace: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            'Could not establish connection. Receiving end does not exist.',
          ),
        )
        .mockImplementation(async (_context, correlationId) => ({
          status: 'success' as const,
          correlationId,
          data: {
            note: {
              prKey: 'octo/example#42',
              owner: 'octo',
              repository: 'example',
              pullNumber: 42,
              body: 'Copy me',
              updatedAt: '2026-08-14T10:00:00.000Z',
            },
            templates: [],
          },
        })),
      writeClipboard: vi.fn().mockRejectedValue(new Error('Permission denied')),
    })
    renderPanel(transport)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'MergeLens is reconnecting',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('textbox', { name: 'Pull request note' })

    fireEvent.click(screen.getByRole('button', { name: 'Copy note' }))
    expect(
      await screen.findByText('Could not copy the note. Try again.'),
    ).toBeVisible()
  })

  it('stops editor keyboard events from reaching global bubble listeners', async () => {
    const globalKeyDown = vi.fn()
    window.addEventListener('keydown', globalKeyDown)
    renderPanel(createTransport())
    const editor = await screen.findByRole('textbox', {
      name: 'Pull request note',
    })

    fireEvent.keyDown(editor, {
      key: 'k',
      ctrlKey: true,
      isComposing: true,
    })
    expect(globalKeyDown).not.toHaveBeenCalled()
    window.removeEventListener('keydown', globalKeyDown)
  })
})
