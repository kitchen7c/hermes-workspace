import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware';
import { requireAdmin } from '../../server/admin-gate';
import { getSwarmEnvironment } from '../../server/swarm-environment'

export const Route = createFileRoute('/api/swarm-environment')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const adminCheck = requireAdmin(request);
        if (adminCheck) return adminCheck;
        return json({
          ok: true,
          generatedAt: Date.now(),
          ...getSwarmEnvironment(),
        })
      },
    },
  },
})
