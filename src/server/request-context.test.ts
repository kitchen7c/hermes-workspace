import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalHermesHome = process.env.HERMES_HOME
let hermesHome: string

beforeEach(() => {
  vi.resetModules()
  hermesHome = mkdtempSync(join(tmpdir(), 'hermes-request-context-'))
  process.env.HERMES_HOME = hermesHome
})

afterEach(() => {
  if (originalHermesHome === undefined) {
    delete process.env.HERMES_HOME
  } else {
    process.env.HERMES_HOME = originalHermesHome
  }
  rmSync(hermesHome, { recursive: true, force: true })
})

describe('buildUserContext', () => {
  it('seeds empty per-user workspace and local session files on creation', async () => {
    const { buildUserContext } = await import('./request-context')

    const ctx = buildUserContext({
      id: 'user-1',
      username: 'alice',
      role: 'user',
      createdAt: 1,
    })

    expect(existsSync(ctx.workspaceStateDir)).toBe(true)
    expect(existsSync(ctx.workspaceRoot)).toBe(true)
    expect(existsSync(ctx.localRuntimeDir)).toBe(true)
    expect(JSON.parse(readFileSync(ctx.localSessionsFile, 'utf-8'))).toEqual({
      sessions: {},
      messages: {},
    })
    expect(
      JSON.parse(
        readFileSync(join(ctx.workspaceStateDir, 'workspaces.json'), 'utf-8'),
      ),
    ).toEqual({
      workspaces: [],
      last: '',
    })
    expect(
      readFileSync(join(ctx.workspaceStateDir, 'last_workspace.txt'), 'utf-8'),
    ).toBe('')
  })
})
