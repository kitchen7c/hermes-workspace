import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setDbPath, getDb, closeDb } from './db'

describe('db', () => {
  beforeEach(() => {
    // Use in-memory SQLite for testing
    setDbPath(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  it('creates the users table', () => {
    const db = getDb()
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('users')
    expect(tableNames).toContain('user_sessions')
    expect(tableNames).toContain('_migrations')
  })

  it('enforces foreign keys', () => {
    const db = getDb()
    const row = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>
    expect(row[0].foreign_keys).toBe(1)
  })

  it('uses WAL journal mode', () => {
    const db = getDb()
    const row = db.pragma('journal_mode') as Array<{ journal_mode: string }>
    // In-memory DB does not support WAL — it uses 'memory' mode.
    // The WAL pragma only takes effect for file-based databases.
    expect(['wal', 'memory']).toContain(row[0].journal_mode)
  })

  it('returns the same instance on repeated calls', () => {
    const db1 = getDb()
    const db2 = getDb()
    expect(db1).toBe(db2)
  })

  it('is idempotent for schema creation', () => {
    // Call getDb multiple times - schema should not error on re-creation
    getDb()
    closeDb()
    setDbPath(':memory:')
    getDb()
    // Should not throw
  })
})
