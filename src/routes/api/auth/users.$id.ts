import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated, getAuthMode, revokeAllUserTokens } from '../../../server/auth-middleware'
import { getUser } from '../../../server/request-context'
import { deleteUser, getUserById } from '../../../server/user-store'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

export const Route = createFileRoute('/api/auth/users/$id')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
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

        const targetId = params.id

        // Cannot delete yourself
        if (currentUser.id === targetId) {
          return json(
            { ok: false, error: 'Cannot delete yourself' },
            { status: 400 },
          )
        }

        const targetUser = getUserById(targetId)
        if (!targetUser) {
          return json(
            { ok: false, error: 'User not found' },
            { status: 404 },
          )
        }

        // Revoke all tokens for the user
        revokeAllUserTokens(targetId)

        // Delete from database
        deleteUser(targetId)

        // Remove private state root
        const userStateRoot = join(HERMES_HOME, 'users', targetId)
        try {
          if (existsSync(userStateRoot)) {
            rmSync(userStateRoot, { recursive: true, force: true })
          }
        } catch {
          // Non-fatal: state root cleanup failure
          console.warn(`[auth] Failed to remove state root for user ${targetId}`)
        }

        return json({ ok: true })
      },
    },
  },
})
