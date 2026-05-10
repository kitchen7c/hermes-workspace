import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../server/auth-middleware', () => ({
  getAuthMode: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock('../../../server/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('../../../server/rate-limit')>(
    '../../../server/rate-limit',
  )
  return {
    ...actual,
    getClientIp: vi.fn(),
    rateLimit: vi.fn(),
    rateLimitResponse: vi.fn(),
  }
})

vi.mock('../../../server/request-context', () => ({
  buildUserContext: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('../../../server/user-store', () => ({
  createUser: vi.fn(),
  hasAnyUser: vi.fn(),
  listUsers: vi.fn(),
}))

import { getAuthMode, isAuthenticated } from '../../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '../../../server/rate-limit'
import { buildUserContext, getUser } from '../../../server/request-context'
import { createUser, listUsers } from '../../../server/user-store'
import { Route } from './users'

const mockGetAuthMode = vi.mocked(getAuthMode)
const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockGetClientIp = vi.mocked(getClientIp)
const mockRateLimit = vi.mocked(rateLimit)
const mockRateLimitResponse = vi.mocked(rateLimitResponse)
const mockBuildUserContext = vi.mocked(buildUserContext)
const mockGetUser = vi.mocked(getUser)
const mockCreateUser = vi.mocked(createUser)
const mockListUsers = vi.mocked(listUsers)

function handler(method: 'GET' | 'POST') {
  const routeHandler = Route.options.server?.handlers?.[method]
  if (!routeHandler) throw new Error(`No ${method} handler`)
  return routeHandler
}

function jsonRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/auth/users', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
  mockGetAuthMode.mockReturnValue('multi-user')
  mockGetUser.mockReturnValue({
    id: 'admin-1',
    username: 'admin',
    role: 'admin',
    createdAt: 1,
  })
  mockGetClientIp.mockReturnValue('203.0.113.8')
  mockRateLimit.mockReturnValue(true)
  mockRateLimitResponse.mockReturnValue(
    new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
    }),
  )
  mockListUsers.mockReturnValue([])
  mockCreateUser.mockResolvedValue({
    id: 'user-1',
    username: 'alice',
    role: 'user',
    createdAt: 2,
  })
})

describe('/api/auth/users', () => {
  it('does not rate limit user listing', async () => {
    const res = await handler('GET')({ request: jsonRequest('GET') } as never)

    expect(res.status).toBe(200)
    expect(mockRateLimit).not.toHaveBeenCalled()
  })

  it('applies the spec user-creation rate limit before creating a user', async () => {
    const res = await handler('POST')({
      request: jsonRequest('POST', {
        username: 'alice',
        password: 'password123',
      }),
    } as never)

    expect(res.status).toBe(201)
    expect(mockRateLimit).toHaveBeenCalledWith(
      'auth-users:203.0.113.8',
      3,
      60_000,
    )
    expect(mockCreateUser).toHaveBeenCalled()
    expect(mockBuildUserContext).toHaveBeenCalled()
  })

  it('returns 429 and skips creation when the user-creation rate limit is exceeded', async () => {
    mockRateLimit.mockReturnValue(false)

    const res = await handler('POST')({
      request: jsonRequest('POST', {
        username: 'alice',
        password: 'password123',
      }),
    } as never)

    expect(res.status).toBe(429)
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockBuildUserContext).not.toHaveBeenCalled()
  })
})
