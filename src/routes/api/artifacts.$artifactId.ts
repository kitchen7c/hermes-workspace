import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, getAuthMode } from '../../server/auth-middleware'
import { getUser } from '../../server/request-context'
import { isSessionOwnedByUser } from '../../server/session-helpers'
import { getToolArtifact } from '../../server/tool-artifacts-store'

export const Route = createFileRoute('/api/artifacts/$artifactId')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        const artifact = getToolArtifact(params.artifactId)
        if (!artifact) {
          return json(
            { ok: false, error: 'Artifact not found' },
            { status: 404 },
          )
        }

        // In multi-user mode, validate ownership of the artifact's session
        if (getAuthMode() === 'multi-user') {
          const user = getUser(request)
          if (!isSessionOwnedByUser(user, artifact.sessionId)) {
            return json({ ok: false, error: 'Not found' }, { status: 404 })
          }
        }

        return json({ ok: true, artifact })
      },
    },
  },
})
