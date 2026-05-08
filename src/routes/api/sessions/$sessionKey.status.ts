import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getUser } from '../../../server/request-context'
import { isSessionOwnedByUser } from '../../../server/session-helpers'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getSession,
  toSessionSummary,
} from '../../../server/claude-api'

export const Route = createFileRoute('/api/sessions/$sessionKey/status')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        if (!getGatewayCapabilities().sessions) {
          return json(
            { ok: false, error: SESSIONS_API_UNAVAILABLE_MESSAGE },
            { status: 503 },
          )
        }

        const { sessionKey } = params

        if (!sessionKey || sessionKey.trim().length === 0) {
          return json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        // Check ownership
        const user = getUser(request)
        if (!isSessionOwnedByUser(user, sessionKey)) {
          return json({ ok: false, error: 'Not found' }, { status: 404 })
        }

        try {
          const session = await getSession(sessionKey)
          const result = toSessionSummary(session)
          return json({
            ok: true,
            status: result.status ?? 'idle',
            ...result,
          })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
