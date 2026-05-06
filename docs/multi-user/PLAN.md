# Implementation Plan: User Workspace Isolation

**Version**: 3.0  
**Estimated effort**: 7–10 person-days  
**Dependencies**: `docs/multi-user/ARCHITECTURE.md`, `docs/multi-user/SPEC.md`

---

## Goal

Replace the current session-only multi-user direction with a real per-user workspace model:

- private chat sessions
- private managed file root and workspace selection
- private local portable sessions
- admin-only raw terminal and shared operational surfaces
- memory is explicitly shared (deferred until Agent runtime supports per-user memory)

---

## Phase 0: Dependency and Test Baseline

### 0.1 Install / verify auth storage dependencies

```bash
pnpm add better-sqlite3 bcryptjs
pnpm add -D @types/better-sqlite3 @types/bcryptjs
```

### 0.2 Verify baseline

```bash
pnpm build
pnpm test
```

**Deliverable**: green baseline before behavior changes.

---

## Phase 1: Data Layer and User Context

### 1.1 Create `src/server/db.ts`

Responsibilities:

- open `workspace-users.db`
- apply schema migrations
- expose singleton DB access

### 1.2 Create `src/server/user-store.ts`

Responsibilities:

- CRUD for users
- password hashing / verification
- `hasAnyUser()`

### 1.3 Create `src/server/request-context.ts`

Responsibilities:

- `getUser(request)`
- `getUserContext(request)`
- resolve per-user filesystem roots

Suggested exports:

```ts
function getUser(request: Request): WorkspaceUser | null
function getUserContext(request: Request): UserWorkspaceContext | null
function getUserStateRoot(userId: string): string
function ensureUserStateRoot(userId: string): UserWorkspaceContext
```

### 1.4 Add unit tests

Target files:

- `src/server/db.test.ts`
- `src/server/user-store.test.ts`
- `src/server/request-context.test.ts`

Scenarios:

- user create/list/delete
- token -> user resolution
- deterministic path resolution
- directory initialization

**Deliverable**: user and context resolution exist independently of route code.

---

## Phase 2: Auth Rewrite

### 2.1 Rewrite `src/server/auth-middleware.ts`

Changes:

- token store becomes `token -> { userId, expiry }`
- add `getUserIdFromToken()`
- add `revokeAllUserTokens(userId)`
- keep compatibility with legacy numeric token entries

### 2.2 Rewrite `src/routes/api/auth.ts`

Support:

- legacy `{ password }`
- multi-user `{ username, password }`

### 2.3 Update `src/routes/api/auth-check.ts`

Add:

- `multiUser`
- `user.username`
- `user.role`

### 2.4 Add user admin routes

Files:

- `src/routes/api/auth/logout.ts`
- `src/routes/api/auth/users.ts`
- `src/routes/api/auth/users.$id.ts`

### 2.5 Add auth tests

Target tests:

- `src/server/auth-middleware.test.ts`
- `src/routes/api/__tests__/auth.test.ts`
- `src/routes/api/__tests__/auth-users.test.ts`

**Deliverable**: auth system produces real user identity, not only boolean access.

---

## Phase 3: Session Ownership Hardening

### 3.1 Create `src/server/session-ownership-store.ts`

Responsibilities:

- claim / release / owns / list keys

### 3.2 Create `src/server/session-helpers.ts`

Responsibilities:

- claim-before-create helper
- paginated owned-session listing helper

### 3.3 Update session routes

Primary files:

- `src/routes/api/sessions.ts`
- `src/routes/api/send-stream.ts`
- `src/routes/api/history.ts`
- `src/routes/api/session-history.ts`
- `src/routes/api/session-status.ts`
- `src/routes/api/sessions/$sessionKey.status.ts`
- `src/routes/api/sessions/$sessionKey.active-run.ts`
- `src/routes/api/session-send.ts`
- `src/routes/api/sessions/send.ts`
- `src/routes/api/chat-events.ts`
- `src/server/session-utils.ts`

Required behaviors:

- ownership check on all session-key routes
- `'main'` resolves against the current user's sessions
- local and dashboard sessions are both visible only to the owner

### 3.4 Add targeted tests

Suggested coverage:

- user A cannot read/send user B session
- paginated global dashboard list still returns user-owned older sessions
- `'main'` falls back to `'new'` when user has no sessions

**Deliverable**: chat history and send paths are actually user-private.

---

## Phase 4: Per-User Local Session Store

### 4.1 Rewrite `src/server/local-session-store.ts`

Current problem:

- global file at `<repo>/.runtime/local-sessions.json`

Target:

- context-aware file at `~/.hermes/users/<userId>/runtime/local-sessions.json`

Changes:

- remove global `process.cwd()`-based store path in multi-user mode
- accept user context or explicit file path
- keep compatibility path only for legacy/no-auth mode

### 4.2 Update callers

Primary files:

- `src/routes/api/sessions.ts`
- `src/routes/api/send-stream.ts`
- any helper that reads or writes local sessions/messages

### 4.3 Add tests

Scenarios:

- two users create same-named local session ids in separate stores without collision
- migrated local sessions only appear for admin

**Deliverable**: portable/local chats are private by file location, not just filtered in memory.

---

## Phase 5: Managed Workspace and Files Isolation

### 5.1 Rewrite `src/routes/api/workspace.ts`

Current problem:

- stores catalog state under shared profile-global `webui_state`

Target:

- in multi-user mode read/write `webui_state` inside the current user's state root
- initialize `workspace/` directory eagerly
- only allow catalog entries inside the managed workspace root

### 5.2 Rewrite `src/routes/api/files.ts`

Current problem:

- uses `loadWorkspaceCatalog()` with shared selected root

Target:

- resolve current user context
- resolve current user's selected workspace
- reject paths outside that root

### 5.3 Add tests

Primary test file:

- `src/routes/api/-workspace.test.ts`
- add a dedicated `src/routes/api/-files-multi-user.test.ts` if needed

Scenarios:

- user A and user B see different roots
- absolute paths outside the managed root are rejected in multi-user mode
- legacy/no-auth mode preserves current single-user behavior

**Deliverable**: `/api/files` and workspace selection no longer leak shared filesystem state.

---

## Phase 6: Terminal and Shared Surface Gating

### 6.1 Gate terminal routes

Files:

- `src/routes/api/terminal-stream.ts`
- `src/routes/api/terminal-input.ts`
- `src/routes/api/terminal-resize.ts`
- `src/routes/api/terminal-close.ts`

Target behavior:

- multi-user + non-admin -> `403`
- legacy/no-auth -> existing behavior

### 6.2 Gate shared operational routes

Files to role-gate explicitly (check `user.role === 'admin'` in multi-user mode):

- `src/routes/api/swarm-*.ts` — Swarm mutation routes
- `src/routes/api/conductor-*.ts` — Mission dispatch/stop
- `src/routes/api/claude-config.ts` — Global agent config mutations
- `src/routes/api/mcp.ts`, `src/routes/api/mcp/configure.ts` — MCP mutation
- `src/routes/api/skills/install.ts`, `src/routes/api/skills/uninstall.ts` — Skill mutation
- `src/routes/api/profiles/*.ts` — Profile mutation
- `src/routes/api/knowledge/config.ts` — Knowledge config mutation
- `src/routes/api/start-agent.ts`, `src/routes/api/start-claude.ts` — Agent lifecycle
- `src/routes/api/update/*.ts` — Update management

This is an explicit, audit-complete list, not an open audit task.

### 6.3 Add tests

Scenarios:

- regular user denied terminal access
- admin allowed
- existing single-user local behavior unchanged

**Deliverable**: shared unsafe surfaces stop undermining the private-workspace model.

---

## Phase 7: Migration

### 7.1 Create migration helper

Suggested file:

- `src/server/multi-user-migration.ts`

Responsibilities:

- create admin from `HERMES_PASSWORD`
- initialize admin state root
- copy shared workspace state
- copy shared local session cache
- claim dashboard + local sessions
- write `_migrations` marker

Failure handling: each step is independent. If any file-copy step fails (missing source, disk full, permission error), log a warning and continue — the admin user is still created and sessions are still claimed. The only hard-failure is if admin user creation itself fails (abort migration, log error, refuse to start).

### 7.2 Hook into startup

Likely entry points:

- auth initialization path
- server bootstrap path

### 7.3 Add migration tests

Scenarios:

- shared workspace state copied to admin root
- shared `.runtime/local-sessions.json` copied and claimed
- missing source files handled gracefully (non-fatal)
- migration is idempotent

**Deliverable**: upgrade path preserves the current single-user install as the first admin.

---

## Phase 8: UI and Client State Updates

### 8.1 Update auth client type

Files:

- `src/lib/claude-auth.ts`
- any consumer expecting only `{ authenticated, authRequired }`

### 8.2 Update login UI

Files:

- `src/components/auth/login-screen.tsx`
- `src/components/workspace-shell.tsx`

Target behavior:

- username + password form in multi-user mode
- password-only fallback in legacy mode

### 8.3 Namespace local storage

Files:

- `src/stores/workspace-store.ts`
- `src/routes/chat/index.tsx`
- any route/component that persists last session or shell UI state

### 8.4 Hide or gate admin-only tabs/features

Files to inspect:

- `src/components/workspace-shell.tsx`
- terminal/navigation surfaces
- settings/admin entry points

**Deliverable**: frontend behavior matches the new backend boundary and does not leak state across accounts.

---

## Phase 9: Final Verification

### 9.1 Targeted automated verification

Run at minimum:

```bash
pnpm test -- auth
pnpm test -- workspace
pnpm test -- files
pnpm test -- session
pnpm build
```

Use the repo's real test command variants as needed.

### 9.2 Manual verification checklist

1. Create `admin`, `alice`, `bob`
2. Login as `alice`
3. Create chat, local chat, file under workspace root
4. Login as `bob`
5. Verify none of Alice's state is visible
6. Verify Bob cannot open terminal
7. Verify Bob CAN still read shared memory (expected — memory is shared)
8. Login as admin
9. Verify admin can access shared operational surfaces

### 9.3 Documentation cleanup

After code lands:

- update README auth section
- document admin-only terminal behavior in multi-user mode
- document migration behavior and rollback steps

**Deliverable**: user-visible behavior and docs match the actual security boundary.
