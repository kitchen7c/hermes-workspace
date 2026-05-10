import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth-middleware', () => ({
  getAuthMode: vi.fn(),
  isAuthenticated: vi.fn(),
  isPasswordProtectionEnabled: vi.fn(),
}))
vi.mock('../../server/request-context', () => ({
  getUser: vi.fn(),
}))

import {
  getAuthMode,
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'
import { getUser } from '../../server/request-context'
import { Route } from './auth-check'

const mockGetAuthMode = vi.mocked(getAuthMode)
const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockIsPasswordProtectionEnabled = vi.mocked(isPasswordProtectionEnabled)
const mockGetUser = vi.mocked(getUser)

async function callGet(): Promise<Response> {
  const handler = Route.options.server?.handlers?.GET
  if (!handler) throw new Error('No GET handler')
  return handler({
    request: new Request('http://localhost/api/auth-check'),
  } as Parameters<typeof handler>[0])
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetAuthMode.mockReturnValue('multi-user')
  mockIsAuthenticated.mockReturnValue(false)
  mockIsPasswordProtectionEnabled.mockReturnValue(true)
  mockGetUser.mockReturnValue(null)
})

describe('GET /api/auth-check', () => {
  it('returns auth state without depending on gateway reachability', async () => {
    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      authenticated: false,
      authRequired: true,
      multiUser: true,
    })
  })

  it('includes resolved user details in multi-user mode', async () => {
    mockIsAuthenticated.mockReturnValue(true)
    mockGetUser.mockReturnValue({
      id: 'user-1',
      username: 'alice',
      role: 'user',
      createdAt: 1,
    })

    const res = await callGet()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      authenticated: true,
      authRequired: true,
      multiUser: true,
      user: {
        id: 'user-1',
        username: 'alice',
        role: 'user',
      },
    })
  })
})
