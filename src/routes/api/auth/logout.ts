import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  createSessionCookie,
  getSessionTokenFromCookie,
  revokeSessionToken,
} from '../../../server/auth-middleware'

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cookieHeader = request.headers.get('cookie')
        const token = getSessionTokenFromCookie(cookieHeader)

        if (token) {
          revokeSessionToken(token)
        }

        // Clear the cookie by setting Max-Age=0
        const clearCookie = createSessionCookie('').replace(
          'Max-Age=2592000',
          'Max-Age=0',
        )

        return json(
          { ok: true },
          {
            status: 200,
            headers: {
              'Set-Cookie': clearCookie,
            },
          },
        )
      },
    },
  },
})
