# Technical Specification: User Workspace Isolation

**Version**: 3.0  
**Status**: Proposed  
**Target**: Hermes Workspace v2.3+

---

## 1. System Overview

Add multi-user authentication and per-user workspace isolation to Hermes Workspace.

In multi-user mode, the workspace must isolate these user-facing state surfaces:

- chat session visibility and send access
- managed file storage and selected workspace
- local portable session cache
- browser-visible UI state derived from workspace files

This spec intentionally does **not** promise per-user memory isolation in v1. Memory files remain shared across all users because the Hermes Agent runtime reads and writes a single global memory root — workspace-level memory routing would create a false sense of privacy (see ARCHITECTURE.md ADR-5a). Per-user memory is deferred until the Agent runtime itself supports per-user memory roots.

---

## 2. Filesystem Layout

### 2.1 Global Files

```text
~/.hermes/
  workspace-users.db
  workspace-sessions.json
  users/
    <userId>/...
```

### 2.2 Per-User State Root

Every real multi-user account gets a private state root:

```text
~/.hermes/users/<userId>/
  webui_state/
    workspaces.json
    last_workspace.txt
  runtime/
    local-sessions.json
  workspace/
```

### 2.3 Meaning of Each Path

| Path | Purpose |
|---|---|
| `webui_state/` | User-private workspace selection/catalog state |
| `runtime/local-sessions.json` | User-private local portable chat sessions |
| `workspace/` | User-private managed file root used by `/api/files` |

### 2.4 Compatibility Modes

Before multi-user is enabled:

- legacy password mode continues to use the shared/global layout
- no-auth mode continues to use the shared/global layout

After multi-user mode is enabled (`users` table has rows), regular user routes stop reading shared global memory/workspace files. Migration is the only code path that reads the old shared locations.

---

## 3. Data Model

### 3.1 Database

- **Engine**: SQLite via `better-sqlite3`
- **File**: `~/.hermes/workspace-users.db`
- **Journal**: WAL mode
- **Foreign keys**: Enforced

### 3.2 Schema

```sql
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE user_sessions (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, session_key)
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session ON user_sessions(session_key);

CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

### 3.3 Session Token Storage

Existing `workspace-sessions.json` format changes from:

```json
{
  "tokens": {
    "abc": 1715000000000
  }
}
```

to:

```json
{
  "tokens": {
    "abc": {
      "userId": "uuid-of-user",
      "expiry": 1715000000000
    }
  }
}
```

Legacy numeric entries auto-migrate on load.

### 3.4 Constraints

| Constraint | Value |
|---|---|
| Username charset | `[a-zA-Z0-9_]{3,50}` |
| Password min length | 6 |
| Password max length | 1000 |
| Session token TTL | 30 days |
| bcrypt rounds | 10 |
| Login rate limit | 5/min/IP |
| User creation rate limit | 3/min/IP |

---

## 4. Authentication and User Context

### 4.1 `getUser(request)`

```ts
interface WorkspaceUser {
  id: string
  username: string
  role: 'admin' | 'user'
  createdAt: number
}

function getUser(request: Request): WorkspaceUser | null
```

### 4.2 `getUserContext(request)`

```ts
interface UserWorkspaceContext {
  user: WorkspaceUser
  stateRoot: string
  workspaceRoot: string
  workspaceStateDir: string
  localRuntimeDir: string
  localSessionsFile: string
  // memoryRoot reserved for future per-user memory (ADR-5a)
}

function getUserContext(request: Request): UserWorkspaceContext | null
```

### 4.3 Auth Modes

```ts
type AuthMode = 'multi-user' | 'legacy-password' | 'no-auth'
```

Rules:

1. if `users` table has rows -> `multi-user`
2. else if `HERMES_PASSWORD` is set -> `legacy-password`
3. else -> `no-auth`

### 4.4 Virtual Users for Compatibility Modes

| Mode | Virtual user |
|---|---|
| `legacy-password` | `{ id: 'legacy', username: 'admin', role: 'admin' }` |
| `no-auth` | `{ id: 'anonymous', username: 'anonymous', role: 'admin' }` |

Compatibility-mode requests may resolve to a shared/global context. Real per-user state roots exist only for real users in `multi-user` mode.

### 4.5 API Endpoints

#### `POST /api/auth`

```text
Request (multi-user): { username, password }
Request (legacy):     { password }
Response:             { ok: true } + Set-Cookie
```

#### `POST /api/auth/logout`

Invalidates the current token and clears the cookie.

#### `GET /api/auth-check`

```json
{
  "authenticated": true,
  "authRequired": true,
  "multiUser": true,
  "user": {
    "username": "alice",
    "role": "user"
  }
}
```

#### `GET /api/auth/users`

Admin only. List users.

#### `POST /api/auth/users`

Admin only. Create user and initialize their private state root:

- create `~/.hermes/users/<userId>/`
- create `webui_state/`, `runtime/`, `workspace/`
- seed empty `workspaces.json`
- seed empty `runtime/local-sessions.json`

Memory directories are not created — memory remains shared in v1.

#### `DELETE /api/auth/users/:id`

Admin only. Deletes DB ownership rows and the user's private state root.

Deletion rules:

- cannot delete self
- filesystem removal must target only `~/.hermes/users/<userId>/`
- dashboard-backed sessions may persist upstream but become inaccessible

---

## 5. Session Isolation

### 5.1 Ownership Model

Dashboard and local portable sessions both use `user_sessions`.

Core operations:

```ts
function claimSessionOwnership(userId: string, sessionKey: string): void
function ownsSession(userId: string, sessionKey: string): boolean
function getUserSessionKeys(userId: string): Set<string>
function releaseSessionOwnership(userId: string, sessionKey: string): void
```

### 5.2 Ownership Recording Points

Ownership must be claimed before creation at these boundaries:

- `POST /api/sessions`
- `POST /api/send-stream` when it bootstraps a session
- local portable session creation in `local-session-store.ts`
- session fork creation

### 5.3 Paginated Listing

Because dashboard `listSessions(limit, offset)` is globally paginated, user-visible session listing must scan pages until it has enough owned sessions or reaches a ceiling.

Suggested constants:

```ts
const PAGE_SIZE = 50
const SCAN_CEILING = 200
```

### 5.4 Guarded Session Routes

Every route that accepts a session key must check ownership in multi-user mode:

- `GET /api/history`
- `GET /api/session-history`
- `GET /api/session-status`
- `GET /api/sessions/$sessionKey/status`
- `GET /api/sessions/$sessionKey/active-run`
- `GET /api/chat-events`
- `POST /api/send-stream`
- `POST /api/session-send`
- `POST /api/sessions/send`
- `PATCH /api/sessions`
- `DELETE /api/sessions`

Unauthorized access returns `404`, not `403`, to avoid leaking existence.

### 5.5 Synthetic Key Resolution

`'main'` and `'new'` must resolve against the current user's owned sessions, not the global dashboard order.

If the user has no owned sessions:

- `'main'` resolves to `'new'`

### 5.6 Local Portable Session Store

Current global store:

```text
<repo>/.runtime/local-sessions.json
```

becomes:

```text
~/.hermes/users/<userId>/runtime/local-sessions.json
```

`local-session-store.ts` must be context-aware and stop using `process.cwd()` as a global session cache location in multi-user mode.

---

## 6. Managed Workspace and Files Isolation

### 6.1 Managed Root

In multi-user mode, each user gets:

```text
~/.hermes/users/<userId>/workspace/
```

This is the only file root available to regular users through `/api/files`.

### 6.2 Workspace Catalog

`workspaces.json` and `last_workspace.txt` move from shared profile-global `webui_state` into the current user's private `webui_state`.

### 6.3 Validation Rules

In multi-user mode:

- workspace entries must resolve inside the current user's managed `workspace/`
- absolute paths outside that root are rejected
- shared global profile workspace entries are ignored

In compatibility modes, existing single-user behavior remains unchanged.

### 6.4 Files Routes

`/api/files` must:

1. resolve `getUserContext(request)`
2. load that user's selected workspace root
3. reject any path outside that root

This applies to:

- listing
- read/download
- create file/folder
- rename
- delete
- copy/move

---

## 7. Terminal Policy

### 7.1 Multi-User Rule

In multi-user mode, raw terminal endpoints are **admin-only**:

- `POST /api/terminal-stream`
- `POST /api/terminal-input`
- `POST /api/terminal-resize`
- `POST /api/terminal-close`

### 7.2 Reason

An app-level PTY owner check is not a real privacy boundary when all shells run as the same OS user. A user who can open a shell can often access files outside the managed workspace root.

### 7.3 Compatibility Modes

Legacy/no-auth mode may keep the current local-or-auth behavior.

### 7.4 Future Mode

If user terminals are reintroduced later, they must have:

- explicit owner tagging
- attach/input/resize/close ownership checks
- a real sandbox boundary outside the app process

---

## 8. Shared Admin Surfaces

These remain shared deployment surfaces and require admin role in multi-user mode unless separately redesigned:

- swarm routes
- conductor / operations control
- global provider config
- MCP config and marketplace mutation
- shared profile/config endpoints
- any route that mutates shared `HERMES_HOME` runtime state

---

## 9. Migration

### 9.1 Trigger

On startup, if:

- `users` table is empty
- `HERMES_PASSWORD` is set

then run the one-time migration.

### 9.2 Steps

1. Create `admin` user from `HERMES_PASSWORD`
2. Create `~/.hermes/users/<adminId>/`
3. Copy shared workspace selection state:
   - shared `webui_state/workspaces.json`
   - shared `webui_state/last_workspace.txt`
4. Copy shared local portable sessions from `<repo>/.runtime/local-sessions.json`
   to `users/<adminId>/runtime/local-sessions.json`
5. Claim all dashboard sessions for admin
6. Claim all migrated local portable sessions for admin
7. Record `_migrations` marker

### 9.3 Post-Migration Behavior

After migration:

- regular multi-user requests no longer read the old shared workspace/local-session files
- memory routes continue reading the shared global memory root (memory is not isolated in v1)
- old shared files may remain on disk temporarily for rollback or manual inspection

### 9.4 Rollback

Rollback to legacy mode requires:

1. stop workspace
2. remove `workspace-users.db`
3. remove new token format or restore backup
4. restore/use `HERMES_PASSWORD`
5. restart

---

## 10. UI and Client Contract Changes

### 10.1 Login Screen

The login screen must support:

- password-only mode for legacy auth
- username + password mode for multi-user auth

### 10.2 Auth Status Client Type

Client auth type expands to include:

```ts
interface AuthStatus {
  authenticated: boolean
  authRequired: boolean
  multiUser?: boolean
  user?: {
    username: string
    role: 'admin' | 'user'
  }
}
```

### 10.3 Local Browser State

Client-side local storage keys that represent workspace state must be namespaced by user identifier in multi-user mode to avoid leaking:

- last open session
- collapsed/expanded shell preferences
- chat panel session selection

Example:

```text
hermes-workspace:<userId>:sidebar
hermes-workspace:<userId>:last-session
```

---

## 11. Security Notes

### 11.1 Password Storage

- bcrypt hash
- no plaintext storage
- no password logging

### 11.2 Tokens

- HttpOnly
- SameSite=Strict
- Secure in production
- 30-day TTL
- server-side revocation on logout or user deletion

### 11.3 Cross-User Access

- session-key routes use ownership checks
- files routes use user-rooted path resolution
- admin-only shared routes check `user.role`
- **memory routes are NOT isolated** — they read/write the shared global memory root
- the Agent runtime itself operates on shared memory, not per-user memory

### 11.4 Honest Boundary

Multi-user v1 provides **workspace-level isolation for sessions, files, and local state**. Memory remains shared. Raw terminal stays admin-only.

---

## 12. Shared Memory Behavior

Memory routes (`/api/memory/*`) are intentionally NOT isolated in v1. All users read and write the same shared `HERMES_HOME` memory files. The Agent runtime itself operates on these shared files.

This is documented in:
- the login screen (show a note that memory is shared)
- the memory browser UI (show a "shared" badge/tooltip)
- the ARCHITECTURE.md ADR-5a

### 12.1 Future

When the Hermes Agent runtime supports per-user memory resolution (e.g., via a `--memory-root` flag or a `user.memory_home` config field), add memory isolation as a single phase:

1. add `memoryRoot` resolution to `getUserContext()`
2. pass it to `memory-browser.ts`
3. redirect memory reads/writes to the per-user root
4. update migration to copy shared memory into new user roots on creation

---

## 13. Edge Cases

### 13.1 User With No State Yet

User creation initializes the private root eagerly, so empty-workspace cases are valid and do not require lazy directory creation at first request. Memory is not per-user, so no memory directories are created.

### 13.2 Missing Migrated Shared Files

If shared `webui_state` or `.runtime/local-sessions.json` do not exist during migration, skip them without failing startup.

### 13.3 Old Shared Workspace Entries Pointing Outside Managed Root

During migration, only entries that resolve inside the admin managed workspace root are copied as active selections. Others may be copied as inert metadata or dropped; they must not become regular-user file roots.

### 13.4 Empty `'main'`

If a user has no owned sessions, `'main'` resolves to `'new'`.
