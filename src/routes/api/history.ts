import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  ensureGatewayProbed,
  getGatewayCapabilities,
  getMessages,
  listSessions,
  toChatMessage,
} from '../../server/claude-api'
import { resolveSessionKey, resolveMainForUser } from '../../server/session-utils'
import { isAuthenticated } from '../../server/auth-middleware';
import { getLocalSession, getLocalMessages } from '../../server/local-session-store'
import { getUser, getUserContext } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'

export const Route = createFileRoute('/api/history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        await ensureGatewayProbed()
        const user = getUser(request)

        if (!getGatewayCapabilities().sessions) {
          return json({
            sessionKey: 'new',
            sessionId: 'new',
            messages: [],
            source: 'unavailable',
            message: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }
        try {
          const url = new URL(request.url)
          const limit = Number(url.searchParams.get('limit') || '200')
          const rawSessionKey = url.searchParams.get('sessionKey')?.trim()
          const friendlyId = url.searchParams.get('friendlyId')?.trim()
          let { sessionKey } = await resolveSessionKey({
            rawSessionKey,
            friendlyId,
            defaultKey: 'main',
          })

          // 'new' has no history
          if (sessionKey === 'new') {
            return json({
              sessionKey: 'new',
              sessionId: 'new',
              messages: [],
            })
          }

          // Resolve 'main' against the user's owned sessions
          if (sessionKey === 'main') {
            sessionKey = await resolveMainForUser(user)
            if (sessionKey === 'new') {
              return json({
                sessionKey: 'new',
                sessionId: 'new',
                messages: [],
              })
            }
          }

          // Check ownership
          if (!isSessionOwnedByUser(user, sessionKey)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }

          let messages: Awaited<ReturnType<typeof getMessages>> = []
          try {
            messages = await getMessages(sessionKey)
          } catch {
            messages = []
          }

          // Fallback to local session store
          if (messages.length === 0) {
            const localSession = getLocalSession(sessionKey, getUserContext(request))
            if (localSession) {
              const localMessages = getLocalMessages(sessionKey, getUserContext(request))
              return json({
                sessionKey,
                sessionId: sessionKey,
                messages: localMessages.map((m, index) => ({
                  id: m.id,
                  role: m.role,
                  content: [{ type: 'text', text: m.content }],
                  timestamp: m.timestamp,
                  historyIndex: index,
                })),
              })
            }
          }

          const boundedMessages = limit > 0 ? messages.slice(-limit) : messages

          return json({
            sessionKey,
            sessionId: sessionKey,
            messages: boundedMessages.map((message, index) =>
              toChatMessage(message, { historyIndex: index }),
            ),
          })
        } catch (err) {
          return json(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
