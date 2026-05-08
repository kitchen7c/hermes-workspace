import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UserWorkspaceContext } from './request-context'

const DEFAULT_DATA_DIR = join(process.cwd(), '.runtime')
const DEFAULT_SESSIONS_FILE = join(DEFAULT_DATA_DIR, 'local-sessions.json')
const MAX_MESSAGES_PER_SESSION = 500

export type LocalSession = {
  id: string
  title: string | null
  model: string | null
  createdAt: number
  updatedAt: number
  messageCount: number
}

export type LocalMessage = {
  id: string
  role: string
  content: string
  timestamp: number
  toolCalls?: unknown
  toolCallId?: string
  toolName?: string
}

type StoreData = {
  sessions: Record<string, LocalSession>
  messages: Record<string, Array<LocalMessage>>
}

/**
 * A per-file store instance. Each user context gets its own store backed
 * by a different file (or the same global file in legacy mode).
 */
class LocalSessionFileStore {
  private store: StoreData = { sessions: {}, messages: {} }
  private sessionsFile: string
  private dataDir: string
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private loaded = false

  constructor(sessionsFile: string) {
    this.sessionsFile = sessionsFile
    this.dataDir = join(sessionsFile, '..')
  }

  private loadFromDisk(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      if (existsSync(this.sessionsFile)) {
        const raw = readFileSync(this.sessionsFile, 'utf-8')
        const parsed = JSON.parse(raw) as StoreData
        if (parsed.sessions && parsed.messages) {
          this.store = parsed
        }
      }
    } catch {
      // ignore corrupt local cache
    }
  }

  private saveToDisk(): void {
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true })
      writeFileSync(this.sessionsFile, JSON.stringify(this.store, null, 2))
    } catch {
      // ignore cache write failures
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveToDisk()
    }, 2000)
  }

  listSessions(): Array<LocalSession> {
    this.loadFromDisk()
    return Object.values(this.store.sessions).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    )
  }

  getSession(sessionId: string): LocalSession | null {
    this.loadFromDisk()
    return this.store.sessions[sessionId] ?? null
  }

  ensureSession(sessionId: string, model?: string): LocalSession {
    this.loadFromDisk()
    if (!this.store.sessions[sessionId]) {
      this.store.sessions[sessionId] = {
        id: sessionId,
        title: null,
        model: model ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0,
      }
      this.store.messages[sessionId] = []
      this.saveToDisk()
    }
    return this.store.sessions[sessionId]
  }

  updateSessionTitle(sessionId: string, title: string): void {
    this.loadFromDisk()
    const session = this.store.sessions[sessionId]
    if (session) {
      session.title = title
      session.updatedAt = Date.now()
      this.saveToDisk()
    }
  }

  touchSession(sessionId: string): void {
    const session = this.store.sessions[sessionId]
    if (session) session.updatedAt = Date.now()
  }

  deleteSession(sessionId: string): void {
    this.loadFromDisk()
    delete this.store.sessions[sessionId]
    delete this.store.messages[sessionId]
    this.saveToDisk()
  }

  getMessages(sessionId: string): Array<LocalMessage> {
    this.loadFromDisk()
    return this.store.messages[sessionId] ?? []
  }

  appendMessage(sessionId: string, message: LocalMessage): void {
    this.loadFromDisk()
    this.ensureSession(sessionId)
    if (!this.store.messages[sessionId]) this.store.messages[sessionId] = []
    this.store.messages[sessionId].push(message)
    if (this.store.messages[sessionId].length > MAX_MESSAGES_PER_SESSION) {
      this.store.messages[sessionId] = this.store.messages[sessionId].slice(
        -MAX_MESSAGES_PER_SESSION,
      )
    }
    const session = this.store.sessions[sessionId]
    if (session) {
      session.messageCount = this.store.messages[sessionId].length
      session.updatedAt = Date.now()
    }
    this.scheduleSave()
  }
}

// Legacy global store for backward compatibility
const globalStore = new LocalSessionFileStore(DEFAULT_SESSIONS_FILE)

// Cache store instances by file path so repeated calls for the same
// user context always hit the same in-memory store. Without this,
// each call creates a fresh instance that reloads from disk, and
// delayed writes from one instance can be silently overwritten by
// the next reload.
const _storeCache = new Map<string, LocalSessionFileStore>()

/**
 * Get a store for the given user context (multi-user mode)
 * or the global store (legacy/no-auth mode).
 */
function getStoreForContext(ctx?: UserWorkspaceContext | null): LocalSessionFileStore {
  if (ctx && ctx.user.id !== 'legacy' && ctx.user.id !== 'anonymous') {
    const filePath = ctx.localSessionsFile
    let store = _storeCache.get(filePath)
    if (!store) {
      store = new LocalSessionFileStore(filePath)
      _storeCache.set(filePath, store)
    }
    return store
  }
  return globalStore
}

// ---- Backward-compatible exports (use global store) ----

export function listLocalSessions(
  ctx?: UserWorkspaceContext | null,
): Array<LocalSession> {
  return getStoreForContext(ctx).listSessions()
}

export function getLocalSession(
  sessionId: string,
  ctx?: UserWorkspaceContext | null,
): LocalSession | null {
  return getStoreForContext(ctx).getSession(sessionId)
}

export function ensureLocalSession(
  sessionId: string,
  model?: string,
  ctx?: UserWorkspaceContext | null,
): LocalSession {
  return getStoreForContext(ctx).ensureSession(sessionId, model)
}

export function updateLocalSessionTitle(
  sessionId: string,
  title: string,
  ctx?: UserWorkspaceContext | null,
): void {
  getStoreForContext(ctx).updateSessionTitle(sessionId, title)
}

export function touchLocalSession(
  sessionId: string,
  ctx?: UserWorkspaceContext | null,
): void {
  getStoreForContext(ctx).touchSession(sessionId)
}

export function deleteLocalSession(
  sessionId: string,
  ctx?: UserWorkspaceContext | null,
): void {
  getStoreForContext(ctx).deleteSession(sessionId)
}

export function getLocalMessages(
  sessionId: string,
  ctx?: UserWorkspaceContext | null,
): Array<LocalMessage> {
  return getStoreForContext(ctx).getMessages(sessionId)
}

export function appendLocalMessage(
  sessionId: string,
  message: LocalMessage,
  ctx?: UserWorkspaceContext | null,
): void {
  getStoreForContext(ctx).appendMessage(sessionId, message)
}
