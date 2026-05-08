import { getAuthMode } from './auth-middleware'
import { getUser } from './request-context'

/**
 * Returns a 403 Response if the request is in multi-user mode and the
 * user is not an admin. Returns null if the request is allowed.
 */
export function requireAdmin(request: Request): Response | null {
  if (getAuthMode() !== 'multi-user') return null

  const user = getUser(request)
  if (!user || user.role !== 'admin') {
    return new Response(
      JSON.stringify({ ok: false, error: 'Forbidden: admin only' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    )
  }

  return null
}
