import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for #123 (Secure cookie attribute) and #125
 * (x-forwarded-for spoofing), plus multi-user auth token tests.
 *
 * We reset the module between tests because the cookie helper captures
 * env-dependent state at call time and rate-limit / middleware paths
 * depend on `TRUST_PROXY`.
 */

beforeEach(async () => {
  vi.resetModules()
  // Set in-memory DB after reset so the fresh module picks it up
  const { setDbPath } = await import('./db')
  setDbPath(':memory:')
})

afterEach(async () => {
  delete process.env.COOKIE_SECURE
  delete process.env.NODE_ENV
  delete process.env.TRUST_PROXY
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_PASSWORD
  const { closeDb: close } = await import('./db')
  close()
})

describe('createSessionCookie (#123)', () => {
  it('omits Secure in development by default', async () => {
    process.env.NODE_ENV = 'development'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toMatch(/^claude-auth=tok123/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
  })

  it('sets Secure in production by default', async () => {
    process.env.NODE_ENV = 'production'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('respects COOKIE_SECURE=1 override in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.COOKIE_SECURE = '1'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
  })

  it('respects COOKIE_SECURE=0 override in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = '0'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).not.toContain('Secure')
  })
})

describe('getRequestIp (#125)', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers })
  }

  it('ignores x-forwarded-for when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('127.0.0.1')
  })

  it('ignores x-real-ip when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '203.0.113.77' }))
    expect(ip).toBe('127.0.0.1')
  })

  it('honors x-forwarded-for when TRUST_PROXY=1', async () => {
    process.env.TRUST_PROXY = '1'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('203.0.113.77')
  })

  it('honors x-real-ip fallback when TRUST_PROXY=true and x-forwarded-for absent', async () => {
    process.env.TRUST_PROXY = 'true'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '198.51.100.5' }))
    expect(ip).toBe('198.51.100.5')
  })
})

describe('multi-user tokens', () => {
  function makeRequest(cookie?: string): Request {
    const headers: Record<string, string> = {}
    if (cookie) headers.cookie = cookie
    return new Request('http://localhost/', { headers })
  }

  it('storeUserSessionToken stores token with userId', async () => {
    // Need to clear the DB to ensure multi-user mode isn't accidentally triggered
    // by leftover data from other tests
    const { storeUserSessionToken, isValidSessionToken } = await import('./auth-middleware')
    const token = 'test-token-001'
    storeUserSessionToken(token, 'user-abc')
    expect(isValidSessionToken(token)).toBe(true)
  })

  it('storeSessionToken stores token without userId (legacy)', async () => {
    const { storeSessionToken, isValidSessionToken } = await import('./auth-middleware')
    const token = 'test-token-legacy'
    storeSessionToken(token)
    expect(isValidSessionToken(token)).toBe(true)
  })

  it('revokeSessionToken removes token', async () => {
    const { storeSessionToken, revokeSessionToken, isValidSessionToken } = await import('./auth-middleware')
    const token = 'test-token-revoke'
    storeSessionToken(token)
    expect(isValidSessionToken(token)).toBe(true)
    revokeSessionToken(token)
    expect(isValidSessionToken(token)).toBe(false)
  })

  it('revokeAllUserTokens removes all tokens for a user', async () => {
    const { storeUserSessionToken, revokeAllUserTokens, isValidSessionToken } = await import('./auth-middleware')
    storeUserSessionToken('tok-a', 'user-1')
    storeUserSessionToken('tok-b', 'user-1')
    storeUserSessionToken('tok-c', 'user-2')
    revokeAllUserTokens('user-1')
    expect(isValidSessionToken('tok-a')).toBe(false)
    expect(isValidSessionToken('tok-b')).toBe(false)
    expect(isValidSessionToken('tok-c')).toBe(true)
  })

  it('getUserIdFromToken returns null for legacy token', async () => {
    const { storeSessionToken, getUserIdFromToken } = await import('./auth-middleware')
    storeSessionToken('tok-legacy')
    const req = makeRequest('claude-auth=tok-legacy')
    // Since hasAnyUser() is false (in-memory DB is empty), getUserIdFromToken returns null
    expect(getUserIdFromToken(req)).toBeNull()
  })

  it('getSessionTokenFromCookie extracts token', async () => {
    const { getSessionTokenFromCookie } = await import('./auth-middleware')
    expect(getSessionTokenFromCookie('claude-auth=abc123')).toBe('abc123')
    expect(getSessionTokenFromCookie('other=val; claude-auth=xyz789')).toBe('xyz789')
    expect(getSessionTokenFromCookie(null)).toBeNull()
    expect(getSessionTokenFromCookie('noauth=val')).toBeNull()
  })

  it('getAuthMode returns no-auth when no password and no users', async () => {
    delete process.env.HERMES_PASSWORD
    delete process.env.CLAUDE_PASSWORD
    const { getAuthMode } = await import('./auth-middleware')
    expect(getAuthMode()).toBe('no-auth')
  })

  it('getAuthMode returns legacy-password when password is set', async () => {
    process.env.HERMES_PASSWORD = 'testpass'
    const { getAuthMode } = await import('./auth-middleware')
    expect(getAuthMode()).toBe('legacy-password')
  })

  it('isPasswordProtectionEnabled returns true when password is set', async () => {
    process.env.HERMES_PASSWORD = 'testpass'
    const { isPasswordProtectionEnabled } = await import('./auth-middleware')
    expect(isPasswordProtectionEnabled()).toBe(true)
  })

  it('isPasswordProtectionEnabled returns false when no auth configured', async () => {
    delete process.env.HERMES_PASSWORD
    delete process.env.CLAUDE_PASSWORD
    const { isPasswordProtectionEnabled } = await import('./auth-middleware')
    expect(isPasswordProtectionEnabled()).toBe(false)
  })
})
