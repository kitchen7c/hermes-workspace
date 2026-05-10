import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))

vi.mock('../../server/admin-gate', () => ({
  requireAdmin: vi.fn(),
}))

vi.mock('../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: vi.fn(),
  getResolvedUrls: vi.fn(),
  setDashboardUrl: vi.fn(),
  setGatewayUrl: vi.fn(),
}))

import { isAuthenticated } from '../../server/auth-middleware'
import { requireAdmin } from '../../server/admin-gate'
import {
  ensureGatewayProbed,
  getResolvedUrls,
  setDashboardUrl,
  setGatewayUrl,
} from '../../server/gateway-capabilities'
import { Route } from './connection-settings'

const mockIsAuthenticated = vi.mocked(isAuthenticated)
const mockRequireAdmin = vi.mocked(requireAdmin)
const mockEnsureGatewayProbed = vi.mocked(ensureGatewayProbed)
const mockGetResolvedUrls = vi.mocked(getResolvedUrls)
const mockSetDashboardUrl = vi.mocked(setDashboardUrl)
const mockSetGatewayUrl = vi.mocked(setGatewayUrl)

function handler(method: 'GET' | 'PUT') {
  const routeHandler = Route.options.server?.handlers?.[method]
  if (!routeHandler) throw new Error(`No ${method} handler`)
  return routeHandler
}

function jsonRequest(method: string, body?: unknown): Request {
  return new Request('http://localhost/api/connection-settings', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsAuthenticated.mockReturnValue(true)
  mockRequireAdmin.mockReturnValue(null)
  mockEnsureGatewayProbed.mockResolvedValue({} as never)
  mockGetResolvedUrls.mockReturnValue({
    gateway: 'http://127.0.0.1:8000',
    dashboard: 'http://127.0.0.1:8001',
  } as never)
})

describe('/api/connection-settings', () => {
  it('keeps read access available to authenticated users', async () => {
    const res = await handler('GET')({ request: jsonRequest('GET') } as never)

    expect(res.status).toBe(200)
    expect(mockRequireAdmin).not.toHaveBeenCalled()
  })

  it('requires admin before mutating shared connection settings', async () => {
    const adminResponse = new Response(
      JSON.stringify({ ok: false, error: 'Forbidden: admin only' }),
      { status: 403 },
    )
    mockRequireAdmin.mockReturnValue(adminResponse)

    const res = await handler('PUT')({
      request: jsonRequest('PUT', { gateway: 'http://127.0.0.1:9000' }),
    } as never)

    expect(res.status).toBe(403)
    expect(mockRequireAdmin).toHaveBeenCalled()
    expect(mockSetGatewayUrl).not.toHaveBeenCalled()
    expect(mockSetDashboardUrl).not.toHaveBeenCalled()
  })
})
