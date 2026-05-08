import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeDb, getDb, setDbPath } from './db'
import {
  claimSessionOwnership,
  countOwnedSessions,
  getUserSessionKeys,
  ownsSession,
  releaseAllUserSessions,
  releaseSessionOwnership,
  SessionOwnershipConflictError,
} from './session-ownership-store'
import { createUser } from './user-store'

describe('session-ownership-store', () => {
  beforeEach(() => {
    setDbPath(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  it('rejects claims for a session key already owned by another user', async () => {
    const alice = await createUser('alice', 'password123')
    const bob = await createUser('bob', 'password123')

    claimSessionOwnership(alice.id, 'session-1')

    expect(() => claimSessionOwnership(bob.id, 'session-1')).toThrow(
      SessionOwnershipConflictError,
    )
    expect(ownsSession(alice.id, 'session-1')).toBe(true)
    expect(ownsSession(bob.id, 'session-1')).toBe(false)
  })

  it('treats the earliest claim as canonical when stale duplicate rows exist', async () => {
    const alice = await createUser('alice', 'password123')
    const bob = await createUser('bob', 'password123')

    claimSessionOwnership(alice.id, 'session-1')
    getDb()
      .prepare(
        `INSERT INTO user_sessions (user_id, session_key, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(bob.id, 'session-1', Date.now() + 1000)

    expect(ownsSession(alice.id, 'session-1')).toBe(true)
    expect(ownsSession(bob.id, 'session-1')).toBe(false)
    expect([...getUserSessionKeys(alice.id)]).toEqual(['session-1'])
    expect(getUserSessionKeys(bob.id).size).toBe(0)
    expect(countOwnedSessions(alice.id)).toBe(1)
    expect(countOwnedSessions(bob.id)).toBe(0)
  })

  it('deletes all rows for a session key when the canonical owner releases it', async () => {
    const alice = await createUser('alice', 'password123')
    const bob = await createUser('bob', 'password123')

    claimSessionOwnership(alice.id, 'session-1')
    getDb()
      .prepare(
        `INSERT INTO user_sessions (user_id, session_key, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(bob.id, 'session-1', Date.now() + 1000)

    releaseSessionOwnership(alice.id, 'session-1')

    expect(ownsSession(alice.id, 'session-1')).toBe(false)
    expect(ownsSession(bob.id, 'session-1')).toBe(false)
    expect(getUserSessionKeys(alice.id).size).toBe(0)
    expect(getUserSessionKeys(bob.id).size).toBe(0)
  })

  it('removes canonical sessions and stale duplicate rows on user cleanup', async () => {
    const alice = await createUser('alice', 'password123')
    const bob = await createUser('bob', 'password123')

    claimSessionOwnership(alice.id, 'session-1')
    claimSessionOwnership(bob.id, 'session-2')
    getDb()
      .prepare(
        `INSERT INTO user_sessions (user_id, session_key, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(alice.id, 'session-2', Date.now() + 1000)

    releaseAllUserSessions(bob.id)

    expect(ownsSession(bob.id, 'session-2')).toBe(false)
    expect(ownsSession(alice.id, 'session-2')).toBe(false)
    expect(ownsSession(alice.id, 'session-1')).toBe(true)
  })
})
