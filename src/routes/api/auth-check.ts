import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  getAuthMode,
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'
import { getUser } from '../../server/request-context'

export const Route = createFileRoute('/api/auth-check')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authMode = getAuthMode()
        const authRequired = isPasswordProtectionEnabled()
        const authenticated = isAuthenticated(request)

        const response: Record<string, unknown> = {
          authenticated,
          authRequired,
        }

        if (authMode === 'multi-user') {
          response.multiUser = true
          const user = getUser(request)
          if (user) {
            response.user = {
              id: user.id,
              username: user.username,
              role: user.role,
            }
          }
        }

        return json(response)
      },
    },
  },
})
