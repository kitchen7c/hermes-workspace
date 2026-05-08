import type { WorkspaceUser } from './user-store'
import {
  claimSessionOwnership,
  getUserSessionKeys,
} from './session-ownership-store'
import { getAuthMode } from './auth-middleware'
import {
  listSessions,
  getSession,
  toSessionSummary,
} from './claude-api'

const PAGE_SIZE = 50
const SCAN_CEILING = 500

/**
 * Claim ownership of a session for a user before the session is created/used.
 * No-op in non-multi-user modes.
 */
export function claimBeforeCreate(
  user: WorkspaceUser,
  sessionKey: string,
): void {
  if (getAuthMode() !== 'multi-user') return
  claimSessionOwnership(user.id, sessionKey)
}

/**
 * Check if a session key is owned by the given user.
 * In non-multi-user modes, always returns true.
 */
export function isSessionOwnedByUser(
  user: WorkspaceUser | null,
  sessionKey: string,
): boolean {
  if (!user) return false
  if (getAuthMode() !== 'multi-user') return true

  // Virtual users (legacy/anonymous) own everything in compat mode
  if (user.id === 'legacy' || user.id === 'anonymous') return true

  return getUserSessionKeys(user.id).has(sessionKey)
}

/**
 * List sessions owned by a specific user.
 *
 * In multi-user mode, scans the global dashboard session list (paginated)
 * until it finds enough sessions owned by the user, up to SCAN_CEILING.
 *
 * In compatibility modes, returns the global list directly.
 */
export async function listOwnedSessions(
  user: WorkspaceUser,
  limit = PAGE_SIZE,
): Promise<ReturnType<typeof toSessionSummary>[]> {
  if (getAuthMode() !== 'multi-user') {
    const sessions = await listSessions(limit, 0)
    return sessions.map(toSessionSummary)
  }

  // Virtual users (legacy/anonymous) see all sessions
  if (user.id === 'legacy' || user.id === 'anonymous') {
    const sessions = await listSessions(limit, 0)
    return sessions.map(toSessionSummary)
  }

  const ownedKeys = getUserSessionKeys(user.id)
  const results: ReturnType<typeof toSessionSummary>[] = []
  let offset = 0

  // Phase 1: scan global pages for owned sessions (fast path)
  while (results.length < limit && offset < SCAN_CEILING) {
    const page = await listSessions(PAGE_SIZE, offset)
    if (page.length === 0) break

    for (const session of page) {
      if (ownedKeys.has(session.id)) {
        results.push(toSessionSummary(session))
        ownedKeys.delete(session.id)
        if (results.length >= limit) break
      }
    }

    offset += PAGE_SIZE
  }

  // Phase 2: fetch any remaining owned sessions by ID (slow path —
  // these are sessions buried behind newer ones from other users).
  if (results.length < limit && ownedKeys.size > 0) {
    const remaining = [...ownedKeys].slice(0, limit - results.length)
    for (const sessionId of remaining) {
      try {
        const session = await getSession(sessionId)
        if (session) {
          results.push(toSessionSummary(session))
        }
      } catch {
        // Session may not exist on gateway — skip
      }
    }
  }

  return results
}
