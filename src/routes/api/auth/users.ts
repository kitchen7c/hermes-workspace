import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import { isAuthenticated, getAuthMode } from '../../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../../server/rate-limit'
import { getUser } from '../../../server/request-context'
import {
  createUser,
  listUsers,
  hasAnyUser,
} from '../../../server/user-store'
import { buildUserContext } from '../../../server/request-context'

const CreateUserSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(1000),
  role: z.enum(['admin', 'user']).optional().default('user'),
})

export const Route = createFileRoute('/api/auth/users')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const authMode = getAuthMode()
        if (authMode !== 'multi-user') {
          return json({ ok: false, error: 'Not available' }, { status: 400 })
        }

        const currentUser = getUser(request)
        if (!currentUser || currentUser.role !== 'admin') {
          return json({ ok: false, error: 'Admin required' }, { status: 403 })
        }

        const users = listUsers()
        return json({ users })
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const authMode = getAuthMode()
        if (authMode !== 'multi-user') {
          return json({ ok: false, error: 'Not available' }, { status: 400 })
        }

        const currentUser = getUser(request)
        if (!currentUser || currentUser.role !== 'admin') {
          return json({ ok: false, error: 'Admin required' }, { status: 403 })
        }

        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        const ip = getClientIp(request)
        if (!rateLimit(`auth-users:${ip}`, 3, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const raw = await request.json().catch(() => ({}))
          const parsed = CreateUserSchema.safeParse(raw)

          if (!parsed.success) {
            return json(
              { ok: false, error: 'Invalid request: username and password required' },
              { status: 400 },
            )
          }

          const { username, password, role } = parsed.data
          const user = await createUser(username, password, role)

          // Initialize private state root
          buildUserContext(user)

          return json({ ok: true, user }, { status: 201 })
        } catch (err) {
          return json(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            },
            { status: 400 },
          )
        }
      },
    },
  },
})
