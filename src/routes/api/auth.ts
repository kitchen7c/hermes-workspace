import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createSessionCookie,
  generateSessionToken,
  getAuthMode,
  isPasswordProtectionEnabled,
  storeSessionToken,
  storeUserSessionToken,
  verifyPassword,
} from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'
import { hasAnyUser, verifyUserCredentials } from '../../server/user-store'

const LegacyAuthSchema = z.object({
  password: z.string().max(1000),
})

const MultiUserAuthSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().max(1000),
})

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        // Rate limit: max 5 auth attempts per minute per IP
        const ip = getClientIp(request)
        if (!rateLimit(`auth:${ip}`, 5, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const raw = await request.json().catch(() => ({}))
          const authMode = getAuthMode()

          if (authMode === 'multi-user') {
            // Multi-user mode: username + password
            const parsed = MultiUserAuthSchema.safeParse(raw)
            if (!parsed.success) {
              return json(
                { ok: false, error: 'Username and password required' },
                { status: 400 },
              )
            }

            const { username, password } = parsed.data
            const user = await verifyUserCredentials(username, password)

            if (!user) {
              await new Promise((resolve) => setTimeout(resolve, 1000))
              return json(
                { ok: false, error: 'Invalid username or password' },
                { status: 401 },
              )
            }

            const token = generateSessionToken()
            storeUserSessionToken(token, user.id)

            return json(
              { ok: true, username: user.username, role: user.role },
              {
                status: 200,
                headers: {
                  'Set-Cookie': createSessionCookie(token),
                },
              },
            )
          }

          // Legacy mode: password only
          if (!isPasswordProtectionEnabled()) {
            return json(
              { ok: false, error: 'Authentication not required' },
              { status: 400 },
            )
          }

          const parsed = LegacyAuthSchema.safeParse(raw)
          if (!parsed.success) {
            return json(
              { ok: false, error: 'Invalid request' },
              { status: 400 },
            )
          }

          const { password } = parsed.data
          const valid = verifyPassword(password)

          if (!valid) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            return json(
              { ok: false, error: 'Invalid password' },
              { status: 401 },
            )
          }

          const token = generateSessionToken()
          storeSessionToken(token)

          return json(
            { ok: true },
            {
              status: 200,
              headers: {
                'Set-Cookie': createSessionCookie(token),
              },
            },
          )
        } catch (err) {
          if (import.meta.env.DEV) console.error('[/api/auth] Error:', err)
          return json(
            { ok: false, error: 'Authentication failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
