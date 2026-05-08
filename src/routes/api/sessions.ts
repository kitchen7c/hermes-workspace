import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType } from '../../server/rate-limit'
import {
  SESSIONS_API_UNAVAILABLE_MESSAGE,
  createSession,
  deleteSession,
  ensureGatewayProbed,
  getGatewayCapabilities,
  listSessions,
  toSessionSummary,
  updateSession,
} from '../../server/claude-api'
import { createCapabilityUnavailablePayload } from '@/lib/feature-gates'
import {
  deleteLocalSession,
  getLocalSession,
  listLocalSessions,
  updateLocalSessionTitle,
} from '../../server/local-session-store'
import { getUser, getUserContext } from '../../server/request-context'
import { claimBeforeCreate, isSessionOwnedByUser, listOwnedSessions } from '../../server/session-helpers'
import { getAuthMode } from '../../server/auth-middleware'
import { releaseSessionOwnership } from '../../server/session-ownership-store'

export const Route = createFileRoute('/api/sessions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          return json({
            ok: true,
            sessions: [],
            source: 'unavailable',
            message: SESSIONS_API_UNAVAILABLE_MESSAGE,
          })
        }

        try {
          const user = getUser(request)
          const userCtx = getUserContext(request)
          const authMode = getAuthMode()

          let gatewaySessions: ReturnType<typeof toSessionSummary>[]

          if (authMode === 'multi-user' && user && user.id !== 'legacy' && user.id !== 'anonymous') {
            // Multi-user: only list sessions owned by this user
            gatewaySessions = await listOwnedSessions(user)
          } else {
            const sessions = await listSessions(50, 0)
            gatewaySessions = sessions.map(toSessionSummary)
          }

          // Merge local portable sessions
          const localSessions = listLocalSessions(userCtx)
          const gatewayIds = new Set(gatewaySessions.map((s: any) => s.key || s.id))
          for (const ls of localSessions) {
            if (!gatewayIds.has(ls.id)) {
              gatewaySessions.push({
                key: ls.id,
                id: ls.id,
                friendlyId: ls.id,
                title: ls.title || 'Local Chat',
                label: ls.title || 'Local Chat',
                derivedTitle: ls.title || 'Local Chat',
                startedAt: ls.createdAt,
                updatedAt: ls.updatedAt,
                message_count: ls.messageCount,
                model: ls.model,
                source: 'local',
              } as any)
            }
          }

          return json({ sessions: gatewaySessions })
        } catch (err) {
          return json(
            {
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheckPost = requireJsonContentType(request)
        if (csrfCheckPost) return csrfCheckPost
        const capabilities = await ensureGatewayProbed()
        const user = getUser(request)
        const authMode = getAuthMode()

        if (!capabilities.sessions) {
          const friendlyId = randomUUID()
          // Claim ownership for multi-user mode
          if (user) claimBeforeCreate(user, friendlyId)
          return json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey: friendlyId,
            friendlyId,
            persisted: false,
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const requestedLabel =
            typeof body.label === 'string' ? body.label.trim() : ''
          const label = requestedLabel || undefined

          const requestedFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          // In multi-user mode, durable session keys must come from the
          // backend or a server-generated UUID. Trusting client-selected ids
          // lets one user claim another user's existing session key.
          const friendlyId =
            authMode === 'multi-user'
              ? randomUUID()
              : requestedFriendlyId || randomUUID()

          const requestedModel =
            typeof body.model === 'string' ? body.model.trim() : ''
          const model = requestedModel || undefined

          if (capabilities.dashboard.available && !capabilities.enhancedChat) {
            // Claim ownership
            if (user) claimBeforeCreate(user, friendlyId)
            return json({
              ok: true,
              sessionKey: friendlyId,
              friendlyId,
              entry: {
                key: friendlyId,
                id: friendlyId,
                title: label || friendlyId,
                label: label || friendlyId,
                derivedTitle: label || friendlyId,
                model: model || '',
                startedAt: Date.now(),
                updatedAt: Date.now(),
                message_count: 0,
                source: 'dashboard',
              },
              modelApplied: Boolean(model),
              persisted: false,
            })
          }

          const session = await createSession({
            ...(authMode === 'multi-user' ? {} : { id: friendlyId || randomUUID() }),
            title: label,
            model,
          })

          // Claim ownership
          if (user) claimBeforeCreate(user, session.id)

          return json({
            ok: true,
            sessionKey: session.id,
            friendlyId: session.id,
            entry: toSessionSummary(session),
            modelApplied: true,
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
      PATCH: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheckPatch = requireJsonContentType(request)
        if (csrfCheckPatch) return csrfCheckPatch
        const capabilities = await ensureGatewayProbed()
        const user = getUser(request)

        if (!capabilities.sessions) {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >
          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const sessionKey = rawSessionKey || rawFriendlyId || randomUUID()

          // Check ownership
          if (!isSessionOwnedByUser(user, sessionKey)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }

          return json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey,
            friendlyId: rawFriendlyId || sessionKey,
            updated: false,
          })
        }
        try {
          const body = (await request.json().catch(() => ({}))) as Record<
            string,
            unknown
          >

          const rawSessionKey =
            typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''
          const rawFriendlyId =
            typeof body.friendlyId === 'string' ? body.friendlyId.trim() : ''
          const label =
            typeof body.label === 'string' ? body.label.trim() : undefined
          const sessionKey = rawSessionKey || rawFriendlyId

          if (!sessionKey) {
            return json(
              { ok: false, error: 'sessionKey required' },
              { status: 400 },
            )
          }

          const localSession = getLocalSession(sessionKey, getUserContext(request))
          if (localSession) {
            if (!isSessionOwnedByUser(user, sessionKey)) {
              return json({ ok: false, error: 'Not found' }, { status: 404 })
            }
            if (label) updateLocalSessionTitle(sessionKey, label, getUserContext(request))
            return json({
              ok: true,
              sessionKey,
              friendlyId: rawFriendlyId || sessionKey,
              entry: {
                key: sessionKey,
                id: sessionKey,
                title: label || sessionKey,
                label: label || sessionKey,
                derivedTitle: label || sessionKey,
                startedAt: localSession.createdAt,
                updatedAt: Date.now(),
                message_count: localSession.messageCount,
                model: localSession.model,
                source: 'local',
              },
              updated: true,
              source: 'local',
            })
          }

          if (!isSessionOwnedByUser(user, sessionKey)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }

          if (capabilities.dashboard.available && !capabilities.enhancedChat) {
            return json({
              ok: true,
              sessionKey,
              entry: {
                key: sessionKey,
                id: sessionKey,
                title: label || sessionKey,
                label: label || sessionKey,
                derivedTitle: label || sessionKey,
                updatedAt: Date.now(),
              },
              updated: false,
            })
          }

          const session = await updateSession(sessionKey, {
            title: label,
          })

          return json({
            ok: true,
            sessionKey,
            entry: toSessionSummary(session),
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
      DELETE: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const rawSessionKey = url.searchParams.get('sessionKey') ?? ''
        const rawFriendlyId = url.searchParams.get('friendlyId') ?? ''
        const sessionKey = rawSessionKey.trim() || rawFriendlyId.trim()

        if (!sessionKey) {
          return json(
            { ok: false, error: 'sessionKey required' },
            { status: 400 },
          )
        }

        const user = getUser(request)

        // Check ownership
        if (!isSessionOwnedByUser(user, sessionKey)) {
          return json({ ok: false, error: 'Not found' }, { status: 404 })
        }

        // Local sessions live in the workspace portable store
        const userCtx = getUserContext(request)
        if (getLocalSession(sessionKey, userCtx)) {
          deleteLocalSession(sessionKey, userCtx)
          if (user) releaseSessionOwnership(user.id, sessionKey)
          return json({ ok: true, sessionKey, source: 'local' })
        }

        const capabilities = await ensureGatewayProbed()
        if (!capabilities.sessions) {
          if (user) releaseSessionOwnership(user.id, sessionKey)
          return json({
            ...createCapabilityUnavailablePayload('sessions'),
            ok: true,
            sessionKey,
            deleted: false,
          })
        }
        try {
          await deleteSession(sessionKey)
          if (user) releaseSessionOwnership(user.id, sessionKey)

          return json({ ok: true, sessionKey })
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
