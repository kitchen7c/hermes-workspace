import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getUserById, hasAnyUser, type WorkspaceUser } from './user-store'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

export interface UserWorkspaceContext {
  user: WorkspaceUser
  stateRoot: string
  workspaceRoot: string
  workspaceStateDir: string
  localRuntimeDir: string
  localSessionsFile: string
  // memoryRoot is reserved for future per-user memory (ADR-5a)
}

/**
 * The virtual user used in legacy-password mode.
 */
export const LEGACY_USER: WorkspaceUser = {
  id: 'legacy',
  username: 'admin',
  role: 'admin',
  createdAt: 0,
}

/**
 * The virtual user used in no-auth mode.
 */
export const ANONYMOUS_USER: WorkspaceUser = {
  id: 'anonymous',
  username: 'anonymous',
  role: 'admin',
  createdAt: 0,
}

function getUserStateRoot(userId: string): string {
  return join(HERMES_HOME, 'users', userId)
}

function ensureUserStateRoot(userId: string): string {
  const root = getUserStateRoot(userId)
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  return root
}

/**
 * Build a full UserWorkspaceContext for a real multi-user account.
 * Creates the state root directories eagerly.
 */
export function buildUserContext(user: WorkspaceUser): UserWorkspaceContext {
  const stateRoot = ensureUserStateRoot(user.id)
  const workspaceRoot = join(stateRoot, 'workspace')
  const workspaceStateDir = join(stateRoot, 'webui_state')
  const localRuntimeDir = join(stateRoot, 'runtime')
  const localSessionsFile = join(localRuntimeDir, 'local-sessions.json')

  // Ensure subdirectories exist
  for (const dir of [workspaceRoot, workspaceStateDir, localRuntimeDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
  }

  const workspacesFile = join(workspaceStateDir, 'workspaces.json')
  const lastWorkspaceFile = join(workspaceStateDir, 'last_workspace.txt')
  if (!existsSync(workspacesFile)) {
    writeFileSync(
      workspacesFile,
      JSON.stringify({ workspaces: [], last: '' }, null, 2),
      'utf-8',
    )
  }
  if (!existsSync(lastWorkspaceFile)) {
    writeFileSync(lastWorkspaceFile, '', 'utf-8')
  }

  if (!existsSync(localSessionsFile)) {
    writeFileSync(
      localSessionsFile,
      JSON.stringify({ sessions: {}, messages: {} }, null, 2),
      'utf-8',
    )
  }

  return {
    user,
    stateRoot,
    workspaceRoot,
    workspaceStateDir,
    localRuntimeDir,
    localSessionsFile,
  }
}

/**
 * Build a shared context for compatibility modes (legacy/anonymous).
 */
export function buildSharedContext(user: WorkspaceUser): UserWorkspaceContext {
  return {
    user,
    stateRoot: HERMES_HOME,
    workspaceRoot: join(HERMES_HOME, 'workspace'),
    workspaceStateDir: join(HERMES_HOME, 'webui_state'),
    localRuntimeDir: join(process.cwd(), '.runtime'),
    localSessionsFile: join(process.cwd(), '.runtime', 'local-sessions.json'),
  }
}

/**
 * Get the authenticated workspace user from a request.
 *
 * Uses lazy imports to avoid circular dependency with auth-middleware
 * (auth-middleware imports user-store after Phase 2 rewrite).
 *
 * Returns:
 * - a real WorkspaceUser for multi-user mode
 * - LEGACY_USER for legacy-password mode
 * - ANONYMOUS_USER for no-auth mode
 * - null if authentication fails
 */
export function getUser(request: Request): WorkspaceUser | null {
  // Check if multi-user mode is active
  if (hasAnyUser()) {
    // Lazy-load auth-middleware to avoid circular dependency
    const { getUserIdFromToken } =
      require('./auth-middleware') as typeof import('./auth-middleware')
    const userId = getUserIdFromToken(request)
    if (!userId) return null
    return getUserById(userId)
  }

  // Legacy password mode — password env is set but no users in DB
  const { isPasswordProtectionEnabled, isAuthenticated } =
    require('./auth-middleware') as typeof import('./auth-middleware')

  if (isPasswordProtectionEnabled()) {
    if (isAuthenticated(request)) {
      return LEGACY_USER
    }
    return null
  }

  // No-auth mode
  return ANONYMOUS_USER
}

/**
 * Get the user workspace context for a request.
 *
 * In multi-user mode, returns the per-user state context.
 * In compatibility modes, returns a context pointing at the shared root.
 */
export function getUserContext(
  request: Request,
): UserWorkspaceContext | null {
  const user = getUser(request)
  if (!user) return null

  // Virtual users (legacy/anonymous) use the shared root
  if (user.id === 'legacy' || user.id === 'anonymous') {
    return buildSharedContext(user)
  }

  return buildUserContext(user)
}

/**
 * Get the Hermes home directory (shared memory root).
 * Used by memory routes — memory remains shared in v1.
 */
export function getHermesHome(): string {
  return HERMES_HOME
}

export { getUserStateRoot, ensureUserStateRoot }
