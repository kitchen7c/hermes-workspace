import { createFileRoute } from '@tanstack/react-router'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import { getTerminalSession } from '../../server/terminal-sessions'
import { requireLocalOrAuth, getAuthMode } from '../../server/auth-middleware'
import { getUser } from '../../server/request-context'

export const Route = createFileRoute('/api/terminal-input')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // In multi-user mode, terminal is admin-only
        if (getAuthMode() === 'multi-user') {
          const user = getUser(request)
          if (!user || user.role !== 'admin') {
            return new Response(
              JSON.stringify({ ok: false, error: 'Forbidden: admin only' }),
              { status: 403, headers: { 'Content-Type': 'application/json' } },
            )
          }
        }

        // Match terminal-stream semantics: local browser clients should be
        // allowed even without an explicit auth cookie.
        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const ip = getClientIp(request)
        // Interactive terminals can easily emit dozens to hundreds of key/input
        // events per minute. Keep a rate limit for abuse protection, but make it
        // high enough that normal typing, paste, and tmux control sequences work.
        if (!rateLimit(`terminal:${ip}`, 6000, 60_000)) {
          return rateLimitResponse()
        }

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        const sessionId =
          typeof body.sessionId === 'string' ? body.sessionId : ''
        const data = typeof body.data === 'string' ? body.data : ''
        const session = getTerminalSession(sessionId)
        if (!session) {
          return new Response(JSON.stringify({ ok: false }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        session.sendInput(data)
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
