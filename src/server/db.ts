import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const HERMES_HOME =
  process.env.HERMES_HOME ??
  process.env.CLAUDE_HOME ??
  join(homedir(), '.hermes')

const DB_PATH = join(HERMES_HOME, 'workspace-users.db')

let _db: Database.Database | null = null
let _dbPathOverride: string | null = null

/** Override the DB path (for testing). Pass ':memory:' for in-memory. */
export function setDbPath(override: string | null): void {
  if (_db) {
    _db.close()
    _db = null
  }
  _dbPathOverride = override
}

function resolveDbPath(): string {
  if (_dbPathOverride) return _dbPathOverride
  return DB_PATH
}

function ensureDir(filePath: string): void {
  if (filePath === ':memory:') return
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function applyMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_key TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, session_key)
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_session ON user_sessions(session_key);

    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)
}

export function getDb(): Database.Database {
  if (_db) return _db

  const dbPath = resolveDbPath()
  ensureDir(dbPath)
  _db = new Database(dbPath)
  applyMigrations(_db)
  return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}

export function getDbPath(): string {
  return DB_PATH
}
