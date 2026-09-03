import { beforeEach, describe, expect, it, vi } from 'vitest'

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/shared/logging', () => ({
  logger: {
    ...logger,
    child: () => logger,
  },
}))

import {
  parseDeleteReviewTemplateRequest,
  parseDeleteReviewTemplateResponse,
  parseGetLocalReviewWorkspaceRequest,
  parseGetLocalReviewWorkspaceResponse,
  parseListReviewTemplatesRequest,
  parseListReviewTemplatesResponse,
  parseSavePullRequestNoteRequest,
  parseSavePullRequestNoteResponse,
  parseUpsertReviewTemplateRequest,
  parseUpsertReviewTemplateResponse,
} from '@/shared/messaging/protocol'

const context = {
  owner: 'Octo',
  repository: 'Example',
  pullNumber: 42,
}

const template = {
  id: 'template-1',
  title: 'Correctness',
  body: 'Check edge cases',
  createdAt: '2026-08-14T10:00:00.000Z',
  updatedAt: '2026-08-14T10:00:00.000Z',
}

describe('local review messaging protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates every local review request shape', () => {
    expect(
      parseGetLocalReviewWorkspaceRequest({
        correlationId: 'workspace-1',
        context,
      }),
    ).toEqual({ correlationId: 'workspace-1', context })
    expect(
      parseSavePullRequestNoteRequest({
        correlationId: 'note-1',
        context,
        body: 'Private note',
      }),
    ).toMatchObject({ correlationId: 'note-1', body: 'Private note' })
    expect(
      parseListReviewTemplatesRequest({
        correlationId: 'list-1',
      }),
    ).toEqual({ correlationId: 'list-1' })
    expect(
      parseUpsertReviewTemplateRequest({
        correlationId: 'upsert-1',
        template: { title: 'Correctness', body: 'Check edge cases' },
      }),
    ).toMatchObject({ correlationId: 'upsert-1' })
    expect(
      parseDeleteReviewTemplateRequest({
        correlationId: 'delete-1',
        templateId: 'template-1',
      }),
    ).toEqual({ correlationId: 'delete-1', templateId: 'template-1' })
  })

  it('rejects malformed and oversized private content', () => {
    expect(() =>
      parseGetLocalReviewWorkspaceRequest({
        correlationId: 'workspace-1',
        context: { ...context, pullNumber: 0 },
      }),
    ).toThrow('Invalid local review workspace request')
    expect(() =>
      parseSavePullRequestNoteRequest({
        correlationId: 'note-1',
        context,
        body: 'x'.repeat(50_001),
      }),
    ).toThrow('Invalid pull request note save request')
    expect(() =>
      parseUpsertReviewTemplateRequest({
        correlationId: 'upsert-1',
        template: { title: 'x'.repeat(81), body: 'Body' },
      }),
    ).toThrow('Invalid review template upsert request')
    expect(() =>
      parseDeleteReviewTemplateRequest({
        correlationId: 'delete-1',
        templateId: '',
      }),
    ).toThrow('Invalid review template delete request')
  })

  it('validates success and typed error responses', () => {
    const workspace = {
      status: 'success' as const,
      correlationId: 'workspace-1',
      data: { note: null, templates: [template] },
    }
    expect(parseGetLocalReviewWorkspaceResponse(workspace)).toEqual(workspace)
    expect(
      parseSavePullRequestNoteResponse({
        status: 'success',
        correlationId: 'note-1',
        data: { note: null },
      }),
    ).toMatchObject({ status: 'success', correlationId: 'note-1' })
    expect(
      parseListReviewTemplatesResponse({
        status: 'success',
        correlationId: 'list-1',
        data: { templates: [template] },
      }),
    ).toMatchObject({ status: 'success', correlationId: 'list-1' })
    expect(
      parseUpsertReviewTemplateResponse({
        status: 'success',
        correlationId: 'upsert-1',
        data: { template, templates: [template] },
      }),
    ).toMatchObject({ status: 'success', correlationId: 'upsert-1' })
    expect(
      parseDeleteReviewTemplateResponse({
        status: 'error',
        correlationId: 'delete-1',
        error: { code: 'storage-unavailable', message: 'Storage unavailable' },
      }),
    ).toMatchObject({
      status: 'error',
      error: { code: 'storage-unavailable' },
    })
  })

  it('rejects unsafe response records and excessive template counts', () => {
    expect(() =>
      parseGetLocalReviewWorkspaceResponse({
        status: 'success',
        correlationId: 'workspace-1',
        data: {
          note: { body: 'Missing identity fields' },
          templates: [],
        },
      }),
    ).toThrow('Invalid local review workspace response')
    expect(() =>
      parseListReviewTemplatesResponse({
        status: 'success',
        correlationId: 'list-1',
        data: { templates: Array.from({ length: 101 }, () => template) },
      }),
    ).toThrow('Invalid review template list response')
  })

  it('logs only sanitized lengths and identifiers for private requests', () => {
    const noteBody = 'private-note-marker'
    const templateTitle = 'private-title-marker'
    const templateBody = 'private-template-marker'

    parseSavePullRequestNoteRequest({
      correlationId: 'note-private',
      context,
      body: noteBody,
    })
    parseUpsertReviewTemplateRequest({
      correlationId: 'template-private',
      template: { title: templateTitle, body: templateBody },
    })

    const diagnostics = JSON.stringify(logger.debug.mock.calls)
    expect(diagnostics).not.toContain(noteBody)
    expect(diagnostics).not.toContain(templateTitle)
    expect(diagnostics).not.toContain(templateBody)
    expect(diagnostics).toContain(`\"bodyLength\":${templateBody.length}`)
  })
})
