import { createFileRoute } from '@tanstack/react-router'
import { requireLocalOrAuth, getAuthMode } from '../../server/auth-middleware'
import { getUser } from '../../server/request-context'
import { closeTerminalSession } from '../../server/terminal-sessions'
import { requireJsonContentType } from '../../server/rate-limit'

export const Route = createFileRoute('/api/terminal-close')({
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

        if (!requireLocalOrAuth(request)) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Unauthorized' }),
            {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const body = (await request.json().catch(() => ({}))) as Record<
          string,
          unknown
        >
        const sessionId =
          typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
        if (!sessionId) {
          return new Response(
            JSON.stringify({ ok: false, error: 'sessionId required' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        closeTerminalSession(sessionId)
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
