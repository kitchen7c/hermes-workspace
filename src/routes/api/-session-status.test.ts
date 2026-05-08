import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../server/claude-api', () => ({
  ensureGatewayProbed: vi.fn(),
  getConfig: vi.fn(),
  getGatewayCapabilities: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
}))
vi.mock('../../server/request-context', () => ({
  getUser: vi.fn(),
}))
vi.mock('../../server/session-helpers', () => ({
  isSessionOwnedByUser: vi.fn(),
}))
vi.mock('../../server/session-utils', () => ({
  isSyntheticSessionKey: vi.fn(() => false),
  resolveMainForUser: vi.fn(),
}))
vi.mock('@/server/context-usage', () => ({
  readContextUsage: vi.fn(),
}))

import { isAuthenticated } from '../../server/auth-middleware'
import {
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
} from '../../server/claude-api'
import { readContextUsage } from '@/server/context-usage'
import { getUser } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'
import { Route } from './session-status'

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockEnsureGatewayProbed = vi.mocked(ensureGatewayProbed)
const mockGetGatewayCapabilities = vi.mocked(getGatewayCapabilities)
const mockGetSession = vi.mocked(getSession)
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
  mockIsAuthenticated.mockReturnValue(true)
  mockEnsureGatewayProbed.mockResolvedValue(undefined as never)
  mockGetGatewayCapabilities.mockReturnValue({
    sessions: true,
    config: false,
  } as never)
  mockGetUser.mockReturnValue({
    id: 'user-1',
    username: 'alice',
    role: 'user',
    createdAt: 1,
  })
  mockIsSessionOwnedByUser.mockReturnValue(true)
  mockGetSession.mockResolvedValue({
    id: 'session-123',
    title: 'Test Session',
    model: 'claude-sonnet-4',
    input_tokens: 12,
    output_tokens: 8,
    started_at: 100,
    last_active: 200,
    ended_at: null,
  } as never)
  mockReadContextUsage.mockResolvedValue({
    ok: true,
    contextPercent: 12.5,
    maxTokens: 200000,
    usedTokens: 25000,
    model: 'claude-sonnet-4',
    staticTokens: 0,
    conversationTokens: 25000,
  })
})

describe('GET /api/session-status', () => {
  it('accepts the legacy ?key= alias', async () => {
    const res = await callGet(
      'http://localhost/api/session-status?key=session-123',
    )

    expect(res.status).toBe(200)
    expect(mockGetSession).toHaveBeenCalledWith('session-123')
    const body = (await res.json()) as {
      ok: boolean
      payload: { sessionKey: string }
    }
    expect(body.ok).toBe(true)
    expect(body.payload.sessionKey).toBe('session-123')
  })
})
