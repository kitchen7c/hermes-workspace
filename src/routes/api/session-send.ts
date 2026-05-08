/**
 * ControlSuite-compatible session-send adapter.
 *
 * Operations sends { sessionKey, message } and expects { ok: true } quickly.
 * We forward to the local /api/send-stream endpoint and discard the body
 * (the Operations chat panel polls /api/history at 5s intervals to pick up
 * the reply, so we don't need to hold the stream open here).
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import { getUser } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'
import { resolveMainForUser } from '../../server/session-utils'

export const Route = createFileRoute('/api/session-send')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        try {
          const body = (await request.json()) as {
            sessionKey?: string
            message?: string
          }
          let sessionKey = (body.sessionKey || '').trim()
          const message = (body.message || '').trim()

          // Resolve 'main' against current user
          if (sessionKey === 'main') {
            const user = getUser(request)
            sessionKey = await resolveMainForUser(user)
          }

          if (!sessionKey || sessionKey === 'new') {
            return json(
              { ok: false, error: 'sessionKey is required' },
              { status: 400 },
            )
          }

          // Check ownership
          const user = getUser(request)
          if (!isSessionOwnedByUser(user, sessionKey)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }
          if (!message) {
            return json(
              { ok: false, error: 'message is required' },
              { status: 400 },
            )
          }
          // Fire-and-forget: kick off the stream, then return. Operations
          // chat panel polls /api/session-history for new assistant turns.
          const url = new URL('/api/send-stream', request.url)
          const cookie = request.headers.get('cookie') || ''
          fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(cookie ? { cookie } : {}),
            },
            body: JSON.stringify({
              sessionKey,
              message,
            }),
          }).catch(() => {
            // swallow; UI discovers failures via next /api/session-history poll
          })
          return json({ ok: true, sessionKey, queued: true })
        } catch (error) {
          return json(
            {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to queue message',
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
