import type { WorkspaceUser } from './user-store'
import {
  getUserSessionKeys,
} from './session-ownership-store'
import { getAuthMode } from './auth-middleware'
import {
  listSessions,
  getSession,
} from './claude-api'

type ResolveSessionKeyInput = {
  rawSessionKey?: string
  friendlyId?: string
  defaultKey?: string
}

type ResolveSessionResult = {
  sessionKey: string
  resolvedVia: 'raw' | 'friendly' | 'default'
}

const SYNTHETIC_SESSION_KEYS = new Set(['main', 'new'])

export function isSyntheticSessionKey(
  value: string | null | undefined,
): boolean {
  if (!value) return false
  return SYNTHETIC_SESSION_KEYS.has(value.trim())
}

export async function resolveSessionKey({
  rawSessionKey,
  friendlyId,
  defaultKey = 'new',
}: ResolveSessionKeyInput): Promise<ResolveSessionResult> {
  const trimmedRaw = rawSessionKey?.trim() ?? ''
  if (trimmedRaw.length > 0) {
    return { sessionKey: trimmedRaw, resolvedVia: 'raw' }
  }

  const trimmedFriendly = friendlyId?.trim() ?? ''
  if (trimmedFriendly.length > 0) {
    return { sessionKey: trimmedFriendly, resolvedVia: 'friendly' }
  }

  return { sessionKey: defaultKey, resolvedVia: 'default' }
}

/**
 * Resolve 'main' to the user's most recent owned session.
 * If the user has no sessions, returns 'new'.
 */
export async function resolveMainForUser(
  user: WorkspaceUser | null,
): Promise<string> {
  if (getAuthMode() !== 'multi-user' || !user) return 'new'

  // Virtual users own everything — resolve against global list
  if (user.id === 'legacy' || user.id === 'anonymous') {
    try {
      const recent = await listSessions(30, 0)
      const isInternal = (id: string) =>
        id.startsWith('cron_') ||
        id.startsWith('cron:') ||
        id.startsWith('agent:main:ops-')
      const hasRealTitle = (s: {
        id: string
        title?: string | null
      }) => {
        const t = (s.title ?? '').trim()
        return t.length > 0 && t !== s.id
      }
      const titled = recent.find(
        (s) => !isInternal(s.id) && hasRealTitle(s),
      )
      const fallback = titled
        ? null
        : recent.find(
            (s) =>
              !isInternal(s.id) &&
              typeof s.message_count === 'number' &&
              s.message_count > 0,
          )
      return titled?.id ?? fallback?.id ?? 'new'
    } catch {
      return 'new'
    }
  }

  // Real multi-user: resolve against owned sessions only.
  // Query the user's owned session index FIRST, then fetch those
  // sessions directly by ID. This avoids the bounded global scan
  // problem where a user's sessions are buried behind newer ones.
  const ownedKeys = getUserSessionKeys(user.id)
  if (ownedKeys.size === 0) return 'new'

  const isInternal = (id: string) =>
    id.startsWith('cron_') || id.startsWith('cron:') || id.startsWith('agent:main:ops-')
  const hasRealTitle = (s: { id: string; title?: string | null }) => {
    const t = (s.title ?? '').trim()
    return t.length > 0 && t !== s.id
  }

  try {
    // Try up to 20 owned keys, fetching each by ID until we find a match.
    // This is O(owned) instead of O(global), and works regardless of how
    // many newer sessions other users have created.
    let titled: { id: string } | undefined
    let fallback: { id: string; message_count?: number } | undefined
    let checked = 0

    for (const sessionId of ownedKeys) {
      if (checked >= 20) break
      if (isInternal(sessionId)) continue
      checked++

      try {
        const s = await getSession(sessionId)
        if (!s) continue
        if (!titled && hasRealTitle(s as unknown as { id: string; title?: string | null })) {
          titled = s as unknown as { id: string }
        }
        if (
          !fallback &&
          typeof (s as unknown as { message_count?: number }).message_count === 'number' &&
          (s as unknown as { message_count: number }).message_count > 0
        ) {
          fallback = s as unknown as { id: string; message_count?: number }
        }
        if (titled) break
      } catch {
        // Session may not exist on gateway — skip
        continue
      }
    }

    return titled?.id ?? fallback?.id ?? 'new'
  } catch {
    return 'new'
  }
}
