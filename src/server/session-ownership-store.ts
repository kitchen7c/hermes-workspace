import { getDb } from './db'

/**
 * Session ownership store backed by the user_sessions table in SQLite.
 *
 * Maps userId -> set of sessionKeys for both dashboard-backed and
 * local portable sessions. Ownership must be claimed before a session
 * can be used by a user.
 */

type OwnershipRow = {
  user_id: string
  session_key: string
}

export class SessionOwnershipConflictError extends Error {
  constructor(
    readonly sessionKey: string,
    readonly ownerUserId: string,
  ) {
    super(
      `Session "${sessionKey}" is already owned by another user (${ownerUserId})`,
    )
    this.name = 'SessionOwnershipConflictError'
  }
}

function canonicalOwnershipPredicate(alias = 'us'): string {
  return `NOT EXISTS (
    SELECT 1
    FROM user_sessions older
    WHERE older.session_key = ${alias}.session_key
      AND (
        older.created_at < ${alias}.created_at
        OR (older.created_at = ${alias}.created_at AND older.rowid < ${alias}.rowid)
      )
  )`
}

function getCanonicalOwner(sessionKey: string): OwnershipRow | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT us.user_id, us.session_key
       FROM user_sessions us
       WHERE us.session_key = ?
         AND ${canonicalOwnershipPredicate('us')}
       LIMIT 1`,
    )
    .get(sessionKey) as OwnershipRow | undefined
  return row ?? null
}

export function claimSessionOwnership(
  userId: string,
  sessionKey: string,
): void {
  const db = getDb()
  const owner = getCanonicalOwner(sessionKey)
  if (owner && owner.user_id !== userId) {
    throw new SessionOwnershipConflictError(sessionKey, owner.user_id)
  }
  db.prepare(
    `INSERT OR IGNORE INTO user_sessions (user_id, session_key, created_at)
     VALUES (?, ?, ?)`,
  ).run(userId, sessionKey, Date.now())
}

export function ownsSession(
  userId: string,
  sessionKey: string,
): boolean {
  const owner = getCanonicalOwner(sessionKey)
  return owner?.user_id === userId
}

export function getUserSessionKeys(userId: string): Set<string> {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT us.session_key
       FROM user_sessions us
       WHERE us.user_id = ?
         AND ${canonicalOwnershipPredicate('us')}`,
    )
    .all(userId) as Array<{ session_key: string }>
  return new Set(rows.map((r) => r.session_key))
}

export function releaseSessionOwnership(
  userId: string,
  sessionKey: string,
): void {
  const db = getDb()
  if (ownsSession(userId, sessionKey)) {
    db.prepare('DELETE FROM user_sessions WHERE session_key = ?').run(sessionKey)
    return
  }
  db.prepare(
    'DELETE FROM user_sessions WHERE user_id = ? AND session_key = ?',
  ).run(userId, sessionKey)
}

export function releaseAllUserSessions(userId: string): void {
  const db = getDb()
  const ownedKeys = [...getUserSessionKeys(userId)]
  const deleteSession = db.prepare(
    'DELETE FROM user_sessions WHERE session_key = ?',
  )
  const deleteUserRows = db.prepare(
    'DELETE FROM user_sessions WHERE user_id = ?',
  )
  const tx = db.transaction(() => {
    for (const sessionKey of ownedKeys) {
      deleteSession.run(sessionKey)
    }
    deleteUserRows.run(userId)
  })
  tx()
}

export function countOwnedSessions(userId: string): number {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT COUNT(*) as count
       FROM user_sessions us
       WHERE us.user_id = ?
         AND ${canonicalOwnershipPredicate('us')}`,
    )
    .get(userId) as { count: number }
  return row.count
}
