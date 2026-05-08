/**
 * ControlSuite-compatible session-history adapter.
 * Forwards to the existing /api/history handler with param translation:
 *   key= -> sessionKey=
 *   limit, includeTools pass through.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages,
  toChatMessage,
} from '../../server/claude-api'
import { resolveSessionKey, resolveMainForUser } from '../../server/session-utils'
import { isAuthenticated } from '../../server/auth-middleware';
import { getUser, getUserContext } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'
import {
  getLocalMessages,
  getLocalSession,
} from '../../server/local-session-store'

export const Route = createFileRoute('/api/session-history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        const url = new URL(request.url)
        let key =
          url.searchParams.get('key')?.trim() ||
          url.searchParams.get('sessionKey')?.trim() ||
          ''
        const limit = Number(url.searchParams.get('limit') || '200')
        const includeTools = url.searchParams.get('includeTools') === 'true'
        if (!key) {
          return json({ ok: false, messages: [], error: 'key is required' })
        }

        // Resolve 'main' against the current user BEFORE ownership check.
        // Otherwise 'main' fails the check because it's not a real session key.
        const user = getUser(request)
        if (key === 'main') {
          key = await resolveMainForUser(user)
        }

        // 'new' has no history
        if (key === 'new') {
          return json({ ok: true, messages: [], sessionKey: 'new', source: 'gateway' })
        }

        // Check session ownership on the resolved key
        if (!isSessionOwnedByUser(user, key)) {
          return json({ ok: false, error: 'Not found' }, { status: 404 })
        }

        // Try local store first (in-memory sessions)
        const local = getLocalSession(key, getUserContext(request))
        if (local) {
          const messages = getLocalMessages(key, getUserContext(request)).slice(-limit)
          return json({ ok: true, messages, sessionKey: key, source: 'local' })
        }
        if (!getGatewayCapabilities().sessions) {
          return json({
            ok: false,
            messages: [],
            sessionKey: key,
            error: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }
        try {
          void includeTools
          const rows = await getMessages(key)
          const trimmed = rows.slice(-limit)
          return json({
            ok: true,
            messages: trimmed.map((row) => toChatMessage(row)),
            sessionKey: key,
            source: 'gateway',
          })
        } catch (error) {
          return json(
            {
              ok: false,
              messages: [],
              sessionKey: key,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to load history',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
