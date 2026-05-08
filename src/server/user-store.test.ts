import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setDbPath, closeDb } from './db'
import {
  createUser,
  verifyUserCredentials,
  getUserById,
  getUserByUsername,
  listUsers,
  deleteUser,
  hasAnyUser,
  countUsers,
  validateUsername,
  validatePassword,
} from './user-store'

describe('user-store', () => {
  beforeEach(() => {
    setDbPath(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  describe('validateUsername', () => {
    it('accepts valid usernames', () => {
      expect(validateUsername('alice')).toBe(true)
      expect(validateUsername('bob_smith')).toBe(true)
      expect(validateUsername('user123')).toBe(true)
      expect(validateUsername('abc')).toBe(true)
      expect(validateUsername('ABC_def_999')).toBe(true)
    })

    it('rejects short usernames', () => {
      expect(validateUsername('ab')).toBe(false)
      expect(validateUsername('')).toBe(false)
    })

    it('rejects usernames with special characters', () => {
      expect(validateUsername('alice!')).toBe(false)
      expect(validateUsername('bob@smith')).toBe(false)
      expect(validateUsername('user-name')).toBe(false)
    })
  })

  describe('validatePassword', () => {
    it('accepts valid passwords', () => {
      expect(validatePassword('123456')).toBe(true)
      expect(validatePassword('a'.repeat(1000))).toBe(true)
    })

    it('rejects short passwords', () => {
      expect(validatePassword('12345')).toBe(false)
      expect(validatePassword('')).toBe(false)
    })
  })

  describe('createUser', () => {
    it('creates a user and returns the user object', async () => {
      const user = await createUser('alice', 'password123')
      expect(user.username).toBe('alice')
      expect(user.role).toBe('user')
      expect(user.id).toBeTruthy()
      expect(user.createdAt).toBeGreaterThan(0)
    })

    it('creates an admin user', async () => {
      const user = await createUser('admin', 'adminpass', 'admin')
      expect(user.role).toBe('admin')
    })

    it('rejects duplicate usernames', async () => {
      await createUser('alice', 'password123')
      await expect(createUser('alice', 'otherpass')).rejects.toThrow(
        /already taken/,
      )
    })

    it('rejects invalid username', async () => {
      await expect(createUser('ab', 'password123')).rejects.toThrow(
        /3-50 characters/,
      )
    })

    it('rejects short password', async () => {
      await expect(createUser('alice', '12345')).rejects.toThrow(
        /6-1000 characters/,
      )
    })
  })

  describe('verifyUserCredentials', () => {
    it('returns user for valid credentials', async () => {
      await createUser('alice', 'password123')
      const user = await verifyUserCredentials('alice', 'password123')
      expect(user).not.toBeNull()
      expect(user!.username).toBe('alice')
    })

    it('returns null for wrong password', async () => {
      await createUser('alice', 'password123')
      const user = await verifyUserCredentials('alice', 'wrongpass')
      expect(user).toBeNull()
    })

    it('returns null for unknown username', async () => {
      const user = await verifyUserCredentials('nobody', 'password123')
      expect(user).toBeNull()
    })
  })

  describe('getUserById', () => {
    it('returns user by id', async () => {
      const created = await createUser('alice', 'password123')
      const user = getUserById(created.id)
      expect(user).not.toBeNull()
      expect(user!.username).toBe('alice')
    })

    it('returns null for unknown id', () => {
      expect(getUserById('nonexistent')).toBeNull()
    })
  })

  describe('getUserByUsername', () => {
    it('returns user by username', async () => {
      await createUser('alice', 'password123')
      const user = getUserByUsername('alice')
      expect(user).not.toBeNull()
      expect(user!.username).toBe('alice')
    })

    it('returns null for unknown username', () => {
      expect(getUserByUsername('nobody')).toBeNull()
    })
  })

  describe('listUsers', () => {
    it('lists all users ordered by creation', async () => {
      await createUser('bob', 'password123')
      await createUser('alice', 'password456')
      const users = listUsers()
      expect(users).toHaveLength(2)
      expect(users[0].username).toBe('bob')
      expect(users[1].username).toBe('alice')
    })

    it('returns empty array when no users', () => {
      expect(listUsers()).toEqual([])
    })
  })

  describe('deleteUser', () => {
    it('deletes an existing user', async () => {
      const user = await createUser('alice', 'password123')
      expect(deleteUser(user.id)).toBe(true)
      expect(getUserById(user.id)).toBeNull()
    })

    it('returns false for nonexistent user', () => {
      expect(deleteUser('nonexistent')).toBe(false)
    })
  })

  describe('hasAnyUser', () => {
    it('returns false when no users', () => {
      expect(hasAnyUser()).toBe(false)
    })

    it('returns true after creating a user', async () => {
      await createUser('alice', 'password123')
      expect(hasAnyUser()).toBe(true)
    })
  })

  describe('countUsers', () => {
    it('returns 0 when empty', () => {
      expect(countUsers()).toBe(0)
    })

    it('returns correct count', async () => {
      await createUser('alice', 'password123')
      await createUser('bob', 'password456')
      expect(countUsers()).toBe(2)
    })
  })
})
