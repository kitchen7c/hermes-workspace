import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { hasAnyUser } from './user-store'

// Trigger one-time migration on first import
let _migrationRun = false
function ensureMigration(): void {
  if (_migrationRun) return
  _migrationRun = true
  // Skip migration during test runs — module imports should not
  // have filesystem side effects. Migration only runs at server start.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return
  // Lazy import to avoid circular dependency on boot
  import('./multi-user-migration').then(({ runMultiUserMigration }) => {
    runMultiUserMigration().catch((err) => {
      console.error('[auth] Migration failed:', err)
    })
  })
}
// Run migration on module load (skipped in test environments)
ensureMigration()

/**
 * Persistent session token store.
 *
 * Tokens are held in memory for fast lookup and persisted to a JSON file
 * so they survive server restarts.  This is safe for single-instance
 * deployments.  For multi-worker setups the file becomes a race-condition
 * window — in that case replace with Redis or a database.
 *
 * File location: ~/.hermes/workspace-sessions.json
 *
 * Token format (multi-user):
 *   tokens: { "<token>": { userId: "uuid", expiry: 1715000000000 } }
 *
 * Token format (legacy):
 *   tokens: { "<token>": 1715000000000 }
 */
interface TokenEntry {
  userId: string
  expiry: number
}

interface SessionStore {
  tokens: Record<string, number | TokenEntry>
}

const HERMES_HOME =
  process.env.HERMES_HOME ?? process.env.CLAUDE_HOME ?? join(homedir(), '.hermes')

const STORE_FILE = join(HERMES_HOME, 'workspace-sessions.json')
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function loadStore(): SessionStore {
  try {
    if (existsSync(STORE_FILE)) {
      const raw = readFileSync(STORE_FILE, 'utf8')
      const parsed = JSON.parse(raw) as SessionStore
      // Expire any stale tokens on load
      const now = Date.now()
      const valid: Record<string, number | TokenEntry> = {}
      for (const [token, value] of Object.entries(parsed.tokens)) {
        const expiry = typeof value === 'number' ? value : value.expiry
        if (expiry > now) valid[token] = value
      }
      return { tokens: valid }
    }
  } catch {
    // Corrupt store — start fresh
  }
  return { tokens: {} }
}

function saveStore(store: SessionStore): void {
  try {
    const dir = dirname(STORE_FILE)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    }
    writeFileSync(STORE_FILE, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 })
    try {
      chmodSync(STORE_FILE, 0o600)
    } catch {
      // chmod is best-effort (e.g. Windows)
    }
  } catch {
    console.warn(`[auth] Failed to persist session store to ${STORE_FILE}`)
  }
}

// In-memory working copy: token -> { userId, expiry }
interface TokenRecord {
  userId: string | null // null for legacy tokens (no userId)
  expiry: number
}
const _tokens: Map<string, TokenRecord> = new Map()

// Hydrate from disk on module load
const initial = loadStore()
for (const [token, value] of Object.entries(initial.tokens)) {
  if (typeof value === 'number') {
    _tokens.set(token, { userId: null, expiry: value })
  } else {
    _tokens.set(token, { userId: value.userId, expiry: value.expiry })
  }
}

function _prune(): void {
  const now = Date.now()
  let changed = false
  for (const [token, record] of _tokens) {
    if (record.expiry <= now) {
      _tokens.delete(token)
      changed = true
    }
  }
  if (changed) _persist()
}

function _persist(): void {
  const tokens: Record<string, number | TokenEntry> = {}
  for (const [token, record] of _tokens) {
    if (record.userId) {
      tokens[token] = { userId: record.userId, expiry: record.expiry }
    } else {
      tokens[token] = record.expiry
    }
  }
  saveStore({ tokens })
}

// Sweep expired tokens every 10 minutes
setInterval(_prune, 10 * 60 * 1000)

/**
 * Generate a cryptographically secure session token.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Store a session token with a userId (multi-user mode).
 */
export function storeUserSessionToken(token: string, userId: string): void {
  _tokens.set(token, { userId, expiry: Date.now() + TOKEN_TTL_MS })
  _persist()
}

/**
 * Store a session token (legacy mode — no userId).
 */
export function storeSessionToken(token: string): void {
  _tokens.set(token, { userId: null, expiry: Date.now() + TOKEN_TTL_MS })
  _persist()
}

/**
 * Check if a session token is valid and not expired.
 */
export function isValidSessionToken(token: string): boolean {
  const record = _tokens.get(token)
  if (!record) return false
  if (record.expiry <= Date.now()) {
    _tokens.delete(token)
    _persist()
    return false
  }
  return true
}

/**
 * Remove a session token (logout).
 */
export function revokeSessionToken(token: string): void {
  _tokens.delete(token)
  _persist()
}

/**
 * Revoke all tokens for a given user.
 */
export function revokeAllUserTokens(userId: string): void {
  let changed = false
  for (const [token, record] of _tokens) {
    if (record.userId === userId) {
      _tokens.delete(token)
      changed = true
    }
  }
  if (changed) _persist()
}

/**
 * Get the userId associated with a token, if any.
 * Returns null for legacy tokens (no userId) or invalid tokens.
 */
function getUserIdForToken(token: string): string | null {
  const record = _tokens.get(token)
  if (!record) return null
  if (record.expiry <= Date.now()) {
    _tokens.delete(token)
    _persist()
    return null
  }
  return record.userId
}

/**
 * Extract the userId from the session token in the request.
 * Returns null if multi-user mode is not active or the token is invalid.
 */
export function getUserIdFromToken(request: Request): string | null {
  // Only resolve userIds in multi-user mode
  if (!hasAnyUser()) return null

  const cookieHeader = request.headers.get('cookie')
  const token = getSessionTokenFromCookie(cookieHeader)
  if (!token) return null

  return getUserIdForToken(token)
}

/**
 * Check if a session token is a legacy token (no userId).
 */
export function isLegacyToken(token: string): boolean {
  const record = _tokens.get(token)
  return record !== undefined && record.userId === null
}

/**
 * Resolve the configured workspace password for legacy mode.
 */
function getConfiguredPassword(): string {
  const fromHermes = process.env.HERMES_PASSWORD
  if (fromHermes && fromHermes.length > 0) return fromHermes
  const fromClaude = process.env.CLAUDE_PASSWORD
  if (fromClaude && fromClaude.length > 0) return fromClaude
  return ''
}

/**
 * Check if password protection is enabled (legacy or multi-user).
 */
export function isPasswordProtectionEnabled(): boolean {
  return getConfiguredPassword().length > 0 || hasAnyUser()
}

/**
 * Verify legacy password using timing-safe comparison.
 */
export function verifyPassword(password: string): boolean {
  const configured = getConfiguredPassword()
  if (!configured || configured.length === 0) {
    return false
  }

  const passwordBuf = Buffer.from(password, 'utf8')
  const configuredBuf = Buffer.from(configured, 'utf8')

  if (passwordBuf.length !== configuredBuf.length) {
    return false
  }

  try {
    return timingSafeEqual(passwordBuf, configuredBuf)
  } catch {
    return false
  }
}

/**
 * Extract session token from cookie header.
 */
export function getSessionTokenFromCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';').map((c) => c.trim())
  for (const cookie of cookies) {
    if (cookie.startsWith('claude-auth=')) {
      return cookie.substring('claude-auth='.length)
    }
  }
  return null
}

function isTrustedProxyEnabled(): boolean {
  const v = (process.env.TRUST_PROXY || '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function getRequestIp(request: Request): string {
  if (isTrustedProxyEnabled()) {
    const forwarded = request.headers.get('x-forwarded-for')
    const first = forwarded?.split(',')[0]?.trim()
    if (first) return first
    const real = request.headers.get('x-real-ip')?.trim()
    if (real) return real
  }
  const maybeAddress = (request as unknown as { remoteAddress?: string })
    .remoteAddress
  return (maybeAddress && maybeAddress.trim()) || '127.0.0.1'
}

function isLocalRequest(request: Request): boolean {
  const ip = getRequestIp(request)
  const localIPs = ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']
  if (localIPs.includes(ip)) return true
  if (/^100\.\d+\.\d+\.\d+$/.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  return false
}

/**
 * Check if the request is authenticated.
 *
 * In multi-user mode: checks if the token is valid and has an associated userId.
 * In legacy mode: checks the token against the configured password.
 * In no-auth mode: always returns true.
 */
export function isAuthenticated(request: Request): boolean {
  // Multi-user mode: check for valid token with a userId
  if (hasAnyUser()) {
    const cookieHeader = request.headers.get('cookie')
    const token = getSessionTokenFromCookie(cookieHeader)
    if (!token) return false
    if (!isValidSessionToken(token)) return false
    // In multi-user mode, legacy tokens (no userId) should NOT grant access
    // unless they've been migrated. But we need backward compat during migration.
    const userId = getUserIdForToken(token)
    if (!userId) return false
    return true
  }

  // Legacy password mode
  if (isPasswordProtectionEnabled()) {
    const cookieHeader = request.headers.get('cookie')
    const token = getSessionTokenFromCookie(cookieHeader)
    if (!token) return false
    return isValidSessionToken(token)
  }

  // No-auth mode
  return true
}

export function requireLocalOrAuth(request: Request): boolean {
  if (!isPasswordProtectionEnabled()) {
    return isLocalRequest(request)
  }

  return isAuthenticated(request)
}

function shouldSetSecureCookie(): boolean {
  const override = (process.env.COOKIE_SECURE || '').trim().toLowerCase()
  if (override === '1' || override === 'true' || override === 'yes') return true
  if (override === '0' || override === 'false' || override === 'no') return false
  return process.env.NODE_ENV === 'production'
}

/**
 * Create a Set-Cookie header for the session token.
 */
export function createSessionCookie(token: string): string {
  const attrs = ['HttpOnly']
  if (shouldSetSecureCookie()) attrs.push('Secure')
  attrs.push('SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`)
  return `claude-auth=${token}; ${attrs.join('; ')}`
}

/**
 * Get the auth mode for the current deployment.
 */
export type AuthMode = 'multi-user' | 'legacy-password' | 'no-auth'

export function getAuthMode(): AuthMode {
  if (hasAnyUser()) return 'multi-user'
  if (getConfiguredPassword().length > 0) return 'legacy-password'
  return 'no-auth'
}
