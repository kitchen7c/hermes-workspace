import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import {
  getAuthMode,
  isAuthenticated,
  isPasswordProtectionEnabled,
} from '../../server/auth-middleware'
import { ensureGatewayProbed } from '../../server/gateway-capabilities'
import { getUser } from '../../server/request-context'

export const Route = createFileRoute('/api/auth-check')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const caps = await ensureGatewayProbed()
          const reachable = caps.health || caps.chatCompletions || caps.models

          if (!reachable) {
            return json(
              {
                authenticated: false,
                authRequired: false,
                error: 'claude_agent_unreachable',
              },
              { status: 503 },
            )
          }
        } catch (error) {
          return json(
            {
              authenticated: false,
              authRequired: false,
              error:
                error instanceof DOMException && error.name === 'AbortError'
                  ? 'claude_agent_timeout'
                  : 'claude_agent_unreachable',
            },
            { status: 503 },
          )
        }

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
