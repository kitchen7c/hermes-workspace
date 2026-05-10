import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLogout } from './chat-sidebar'

describe('requestLogout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts to the logout endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    await requestLogout()

    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('throws when logout fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(requestLogout()).rejects.toThrow('HTTP 500')
  })
})
