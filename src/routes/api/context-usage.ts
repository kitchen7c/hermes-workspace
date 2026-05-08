import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getAuthMode, isAuthenticated } from '../../server/auth-middleware'
import {
  emptyContextUsageSnapshot,
  readContextUsage,
} from '@/server/context-usage'
import { getUser } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'

export const Route = createFileRoute('/api/context-usage')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const url = new URL(request.url)
        const sessionId =
          url.searchParams.get('sessionId')?.trim() ||
          url.searchParams.get('sessionKey')?.trim() ||
          ''

        if (sessionId === 'new' || sessionId === 'main') {
          return json(emptyContextUsageSnapshot())
        }
        if (getAuthMode() === 'multi-user') {
          if (!sessionId) {
            return json(emptyContextUsageSnapshot())
          }
          const user = getUser(request)
          if (!isSessionOwnedByUser(user, sessionId)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }
        }
        const snapshot = await readContextUsage(sessionId)
        return json(snapshot)
      },
    },
  },
})
