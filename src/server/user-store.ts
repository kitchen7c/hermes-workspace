import { randomUUID } from 'node:crypto'
import { hash, compare } from 'bcryptjs'
import { getDb } from './db'

export interface WorkspaceUser {
  id: string
  username: string
  role: 'admin' | 'user'
  createdAt: number
}

const BCRYPT_ROUNDS = 10
const USERNAME_RE = /^[a-zA-Z0-9_]{3,50}$/

export function validateUsername(username: string): boolean {
  return USERNAME_RE.test(username)
}

export function validatePassword(password: string): boolean {
  return password.length >= 6 && password.length <= 1000
}

export async function createUser(
  username: string,
  password: string,
  role: 'admin' | 'user' = 'user',
): Promise<WorkspaceUser> {
  if (!validateUsername(username)) {
    throw new Error('Username must be 3-50 characters: a-z, A-Z, 0-9, _')
  }
  if (!validatePassword(password)) {
    throw new Error('Password must be 6-1000 characters')
  }

  const db = getDb()
  const id = randomUUID()
  const passwordHash = await hash(password, BCRYPT_ROUNDS)
  const now = Date.now()

  try {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, username, passwordHash, role, now, now)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE constraint')) {
      throw new Error(`Username "${username}" is already taken`)
    }
    throw err
  }

  return { id, username, role, createdAt: now }
}

export async function verifyUserCredentials(
  username: string,
  password: string,
): Promise<WorkspaceUser | null> {
  const db = getDb()
  const row = db
    .prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE username = ?')
    .get(username) as
    | { id: string; username: string; password_hash: string; role: string; created_at: number }
    | undefined

  if (!row) return null

  const valid = await compare(password, row.password_hash)
  if (!valid) return null

  return {
    id: row.id,
    username: row.username,
    role: row.role as 'admin' | 'user',
    createdAt: row.created_at,
  }
}

export function getUserById(userId: string): WorkspaceUser | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id, username, role, created_at FROM users WHERE id = ?')
    .get(userId) as
    | { id: string; username: string; role: string; created_at: number }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    role: row.role as 'admin' | 'user',
    createdAt: row.created_at,
  }
}

export function getUserByUsername(username: string): WorkspaceUser | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id, username, role, created_at FROM users WHERE username = ?')
    .get(username) as
    | { id: string; username: string; role: string; created_at: number }
    | undefined

  if (!row) return null

  return {
    id: row.id,
    username: row.username,
    role: row.role as 'admin' | 'user',
    createdAt: row.created_at,
  }
}

export function listUsers(): WorkspaceUser[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC')
    .all() as Array<{ id: string; username: string; role: string; created_at: number }>

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    role: row.role as 'admin' | 'user',
    createdAt: row.created_at,
  }))
}

export function deleteUser(userId: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  return result.changes > 0
}

export function hasAnyUser(): boolean {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  return row.count > 0
}

export function countUsers(): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  return row.count
}
