import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth-middleware', () => ({
  getAuthMode: vi.fn(),
  isAuthenticated: vi.fn(),
}))
vi.mock('@/server/context-usage', () => ({
  emptyContextUsageSnapshot: vi.fn(() => ({
    ok: true,
    contextPercent: 0,
    maxTokens: 0,
    usedTokens: 0,
    model: '',
    staticTokens: 0,
    conversationTokens: 0,
  })),
  readContextUsage: vi.fn(),
}))
vi.mock('../../server/request-context', () => ({
  getUser: vi.fn(),
}))
vi.mock('../../server/session-helpers', () => ({
  isSessionOwnedByUser: vi.fn(),
}))

import {
  getAuthMode,
  isAuthenticated,
} from '../../server/auth-middleware'
import { readContextUsage } from '@/server/context-usage'
import { getUser } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'
import { Route } from './context-usage'

const mockGetAuthMode = vi.mocked(getAuthMode)
const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockReadContextUsage = vi.mocked(readContextUsage)
const mockGetUser = vi.mocked(getUser)
const mockIsSessionOwnedByUser = vi.mocked(isSessionOwnedByUser)

async function callGet(url: string): Promise<Response> {
  const handler = Route.options.server?.handlers?.GET
  if (!handler) throw new Error('No GET handler')
  return handler({ request: new Request(url) } as Parameters<typeof handler>[0])
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetAuthMode.mockReturnValue('multi-user')
  mockIsAuthenticated.mockReturnValue(true)
  mockGetUser.mockReturnValue({
    id: 'user-1',
    username: 'alice',
    role: 'user',
    createdAt: 1,
  })
  mockReadContextUsage.mockResolvedValue({
    ok: true,
    contextPercent: 10,
    maxTokens: 200000,
    usedTokens: 20000,
    model: 'claude-sonnet-4',
    staticTokens: 0,
    conversationTokens: 20000,
  })
})

describe('GET /api/context-usage', () => {
  it('rejects foreign session ids in multi-user mode', async () => {
    mockIsSessionOwnedByUser.mockReturnValue(false)

    const res = await callGet(
      'http://localhost/api/context-usage?sessionId=session-123',
    )

    expect(res.status).toBe(404)
    expect(mockReadContextUsage).not.toHaveBeenCalled()
  })

  it('returns an empty snapshot instead of falling back to the global latest session when no session id is provided', async () => {
    const res = await callGet('http://localhost/api/context-usage')

    expect(res.status).toBe(200)
    expect(mockReadContextUsage).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({
      ok: true,
      contextPercent: 0,
      maxTokens: 0,
      usedTokens: 0,
      model: '',
      staticTokens: 0,
      conversationTokens: 0,
    })
  })
})
