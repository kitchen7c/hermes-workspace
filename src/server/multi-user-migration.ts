import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDb } from './db'
import { createUser, getUserByUsername, hasAnyUser } from './user-store'
import { buildUserContext } from './request-context'
import { claimSessionOwnership } from './session-ownership-store'
import { listSessions } from './claude-api'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

const CWD = process.cwd()

/**
 * Run the one-time migration from legacy/single-user mode to
 * multi-user mode on startup.
 *
 * Trigger: HERMES_PASSWORD is set and migration hasn't completed.
 *
 * The _migrations marker is the sole gate — NOT hasAnyUser().
 * If a previous run crashed after creating the admin but before
 * finishing copy/claims, the next startup retries the remaining
 * steps idempotently.
 */
export async function runMultiUserMigration(): Promise<void> {
  const password = process.env.HERMES_PASSWORD || process.env.CLAUDE_PASSWORD || ''
  if (!password) return

  const db = getDb()

  // Gate: skip if fully migrated
  const migrated = db
    .prepare("SELECT 1 FROM _migrations WHERE name = 'multi-user-v1'")
    .get()
  if (migrated) return

  console.log('[migration] Starting multi-user migration...')

  let hasSoftFailure = false

  // Step 1: Create admin user (idempotent — skip if exists)
  let adminUser = getUserByUsername('admin')
  if (!adminUser) {
    try {
      adminUser = await createUser('admin', password, 'admin')
      console.log('[migration] Created admin user')
    } catch (err) {
      console.error('[migration] Failed to create admin user:', err)
      throw err // Hard failure — abort, no retry possible
    }
  } else {
    console.log('[migration] Admin user already exists — resuming partial migration')
  }

  // Step 2: Initialize admin state root
  const ctx = buildUserContext(adminUser)

  // Step 3: Copy shared workspace state (idempotent — overwrites)
  try {
    const sharedWebuiDir = join(HERMES_HOME, 'webui_state')
    if (existsSync(sharedWebuiDir)) {
      if (existsSync(join(sharedWebuiDir, 'workspaces.json'))) {
        copyFileSync(
          join(sharedWebuiDir, 'workspaces.json'),
          join(ctx.workspaceStateDir, 'workspaces.json'),
        )
      }
      if (existsSync(join(sharedWebuiDir, 'last_workspace.txt'))) {
        copyFileSync(
          join(sharedWebuiDir, 'last_workspace.txt'),
          join(ctx.workspaceStateDir, 'last_workspace.txt'),
        )
      }
      console.log('[migration] Copied shared workspace state')
    } else {
      console.log('[migration] No shared workspace state to copy')
    }
  } catch (err) {
    console.warn('[migration] Failed to copy workspace state:', err)
    hasSoftFailure = true
  }

  // Step 4: Copy shared local portable sessions (idempotent — overwrites)
  try {
    const sharedLocalSessions = join(CWD, '.runtime', 'local-sessions.json')
    if (existsSync(sharedLocalSessions)) {
      mkdirSync(ctx.localRuntimeDir, { recursive: true, mode: 0o700 })
      copyFileSync(sharedLocalSessions, ctx.localSessionsFile)
      console.log('[migration] Copied shared local sessions')
    } else {
      console.log('[migration] No shared local sessions to copy')
    }
  } catch (err) {
    console.warn('[migration] Failed to copy local sessions:', err)
    hasSoftFailure = true
  }

  // Step 5: Claim all existing dashboard sessions for admin (INSERT OR IGNORE)
  try {
    const sessions = await listSessions(200, 0)
    for (const session of sessions) {
      claimSessionOwnership(adminUser.id, session.id)
    }
    console.log(`[migration] Claimed ${sessions.length} dashboard sessions`)
  } catch (err) {
    console.warn('[migration] Failed to claim dashboard sessions:', err)
    hasSoftFailure = true
  }

  // Step 6: Claim migrated local portable sessions for admin (INSERT OR IGNORE)
  try {
    if (existsSync(ctx.localSessionsFile)) {
      const raw = readFileSync(ctx.localSessionsFile, 'utf-8')
      const data = JSON.parse(raw) as {
        sessions?: Record<string, unknown>
      }
      if (data.sessions) {
        const sessionIds = Object.keys(data.sessions)
        for (const sessionId of sessionIds) {
          claimSessionOwnership(adminUser.id, sessionId)
        }
        console.log(`[migration] Claimed ${sessionIds.length} local sessions`)
      }
    }
  } catch (err) {
    console.warn('[migration] Failed to claim local sessions:', err)
    hasSoftFailure = true
  }

  // Step 7: Record migration marker — only if ALL steps succeeded.
  // If any soft failure occurred, skip the marker so the migration
  // retries on next startup (all steps are idempotent).
  if (!hasSoftFailure) {
    db.prepare(
      "INSERT OR REPLACE INTO _migrations (name, applied_at) VALUES ('multi-user-v1', ?)",
    ).run(Date.now())
    console.log('[migration] Multi-user migration complete')
  } else {
    console.warn('[migration] Migration incomplete — will retry on next startup')
  }
}
