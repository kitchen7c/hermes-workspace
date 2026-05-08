import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { getUser } from '../../../server/request-context'
import { isSessionOwnedByUser } from '../../../server/session-helpers'
import { getActiveRunForSession } from '../../../server/run-store'

export const Route = createFileRoute('/api/sessions/$sessionKey/active-run')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const sessionKey = params.sessionKey?.trim()
        if (!sessionKey) {
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
          const run = await getActiveRunForSession(sessionKey)
          return json({ ok: true, run })
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
