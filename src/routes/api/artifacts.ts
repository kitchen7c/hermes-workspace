import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, getAuthMode } from '../../server/auth-middleware'
import { getUser } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'
import { listToolArtifacts } from '../../server/tool-artifacts-store'

export const Route = createFileRoute('/api/artifacts')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        let sessionId = url.searchParams.get('sessionId')?.trim() || undefined
        const limit = Number(url.searchParams.get('limit') || '100')

        // In multi-user mode, require sessionId filter and validate ownership
        if (getAuthMode() === 'multi-user') {
          if (!sessionId) {
            return json(
              { ok: false, error: 'sessionId required in multi-user mode' },
              { status: 400 },
            )
          }
          const user = getUser(request)
          if (!isSessionOwnedByUser(user, sessionId)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }
        }

        const artifacts = listToolArtifacts(sessionId).slice(
          0,
          Number.isFinite(limit) && limit > 0 ? limit : 100,
        )
        return json({ ok: true, artifacts })
      },
    },
  },
})
