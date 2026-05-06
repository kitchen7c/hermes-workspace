# Architecture Decision Record: User Workspace Isolation

## Status
Proposed — replaces the earlier session-only multi-user draft

## Context

Hermes Workspace currently treats most local state as shared runtime state:

- chat sessions are globally visible unless filtered in the app
- memory routes read and write one shared `HERMES_HOME`
- workspace selection is stored in one shared `webui_state`
- local portable sessions are stored in one shared `.runtime/local-sessions.json`
- terminal sessions are authenticated, but not user-owned

That model can support password protection and partial session filtering, but it cannot honestly support "each user has their own chat history, memory, file storage, and local workspace state."

The new goal is stronger:

> In multi-user mode, each authenticated user gets a private workspace-owned state root. Chat sessions, managed file storage, workspace selection, and local session caches resolve through that user context by default. Memory files are explicitly NOT isolated in v1 — the Agent runtime still reads and writes a shared memory root, so workspace-level memory routing would create a false sense of privacy (see ADR-5a).

This is still a **single Hermes Workspace deployment**. We are not creating one container or one OS account per user in v1.

## Scope Boundary

| What's in scope | What's out of scope |
|---|---|
| Multi-user login (username + password) | Per-user OS/process sandboxing |
| Per-user chat session visibility and send access | Per-user Hermes gateway process |
| Per-user provider credentials |
| Per-user managed workspace/files root | Per-user MCP server configuration |
| Per-user workspace selection/catalog state | Per-user skills/profile installation |
| Per-user local portable session cache | Shared collaborative folders between users |
| Admin-only shared operational surfaces | True terminal filesystem isolation on one shared OS user |
| Legacy migration of shared state to the initial admin | |

## Core Model

The design splits state into two classes:

### 1. Global control-plane state

Shared by the deployment, not by the end user:

- user accounts
- auth tokens
- session ownership mapping
- admin-only operational surfaces

### 2. User workspace state

Private to a specific authenticated user:

- managed workspace root
- memory files (`MEMORY.md`, `memory/`, `memories/`)
- local session cache
- workspace catalog / last-selected workspace
- browser-visible session history

This yields one clear invariant:

> Any route that touches mutable user-facing state must resolve a `UserWorkspaceContext` before it does any filesystem or session work.

## Key Decisions

### ADR-1: `UserWorkspaceContext` is the primary boundary

**Decision**: Introduce a request-resolved context object and use it everywhere user-facing state is loaded or mutated.

```ts
interface UserWorkspaceContext {
  user: WorkspaceUser
  stateRoot: string
  memoryRoot: string
  workspaceRoot: string
  workspaceStateDir: string
  localRuntimeDir: string
  localSessionsFile: string
}
```

`getUser(request)` answers "who is this?"  
`getUserContext(request)` answers "which private state belongs to them?"

This is the clean break the current repo is missing.

### ADR-2: Private state lives under `~/.hermes/users/<userId>/`

**Decision**: Multi-user mode stores user-private state in a deterministic filesystem layout:

```text
~/.hermes/
  workspace-users.db
  workspace-sessions.json
  users/
    <userId>/
      MEMORY.md
      memory/
      memories/
      webui_state/
        workspaces.json
        last_workspace.txt
      runtime/
        local-sessions.json
      workspace/
```

**Why**:

- aligns with the repo's existing file-based patterns
- gives the memory browser a root with the same shape it already expects
- keeps migration and backup legible
- keeps room for a future per-user gateway/runtime if needed

### ADR-3: `isAuthenticated(request)` is not enough

**Decision**: Replace boolean auth checks with user-aware request resolution across API handlers.

The old pattern:

```ts
if (!isAuthenticated(request)) return 401
```

is insufficient because it says nothing about:

- which sessions the user owns
- which memory root should be read
- which workspace root should be browsed
- whether the route is admin-only in multi-user mode

### ADR-4: Keep a session ownership mapping table

**Decision**: Continue using a `user_sessions` mapping table for dashboard-backed sessions and local portable sessions.

We still reject key-prefixing because session keys flow through multiple dashboard and chat routes. The ownership table remains the cleanest boundary for:

- listing only the current user's sessions
- denying message injection into another user's session
- resolving synthetic keys like `'main'` against the current user's history

### ADR-5a: Memory files are NOT isolated in v1

**Decision**: Memory routes (`/api/memory/*`) continue reading and writing the shared `HERMES_HOME` memory root in all modes. Per-user memory is deferred to a future release.

**Reason**: The Hermes Agent runtime reads and writes `~/.hermes/MEMORY.md` and `~/.hermes/memory/` directly — not through workspace API routes. If the workspace routes were redirected to `~/.hermes/users/<userId>/MEMORY.md`, the Agent would never see or use those files. This would create a damaging split:

- The workspace UI shows "alice's private memory"
- The Agent operates on the shared global memory
- Neither side sees the other's writes

Until the Agent itself supports per-user memory roots (an upstream change), workspace-level memory isolation is a cosmetic feature that misleads users about what the Agent actually knows. Honesty requires not shipping it.

**Future path**: When the Agent runtime can resolve a per-user memory root, add memory isolation in one phase using the existing `UserWorkspaceContext.memoryRoot` field (already reserved in the context shape).

### ADR-5b: Managed files become per-user, not global

**Decision**: In multi-user mode, `/api/workspace` and `/api/files` stop reading shared profile-global workspace state for regular users.

Instead:

- each user gets a managed workspace root at `~/.hermes/users/<userId>/workspace`
- each user's `webui_state/workspaces.json` only tracks folders inside that managed root
- `/api/files` resolves paths only inside the current user's selected workspace

This is a clean break from the current shared `loadWorkspaceCatalog()` behavior. The old shared profile-global workspace selection is only used during migration and single-user compatibility mode.

### ADR-6: Raw PTY terminal is admin-only in multi-user mode (unchanged)

**Decision**: In multi-user mode, the raw terminal routes remain available only to admins.

**Reason**: app-level ownership checks are not enough. A shell running as the same OS account can `cd` anywhere that OS account can access. That means a user-owned PTY on a shared OS user is **not** a real file-isolation boundary.

So v1 takes the honest approach:

- per-user managed files are private through `/api/files`
- raw PTY terminal stays admin-only
- a future sandboxed mode can reintroduce user terminals behind a real runtime boundary

### ADR-7: Shared operational surfaces stay shared, but role-gated (unchanged)

**Decision**: Swarm, global settings, provider config, MCP config, and similar runtime-wide surfaces stay shared deployment features and require `user.role === 'admin'` unless a route is explicitly redesigned for private use.

This prevents accidental leakage through "unchanged" operational endpoints.

### ADR-8: Migration assigns existing shared state to the initial admin (unchanged)

**Decision**: Migration does not try to fan out existing shared state to all future users.

On first migration from single-user mode:

1. create the initial `admin`
2. claim all existing dashboard sessions for that admin
3. copy shared memory files into the admin state root
4. copy shared local portable sessions into the admin runtime file
5. copy shared workspace selection state into the admin `webui_state`

New users start with empty private state.

## Architecture Diagram

```text
┌────────────────────────────────────────────────────────────┐
│ Browser A (user-a)          Browser B (user-b)            │
│ cookie: token-a             cookie: token-b               │
└──────────────┬───────────────────────┬────────────────────┘
               │                       │
               ▼                       ▼
┌────────────────────────────────────────────────────────────┐
│                    Hermes Workspace Server                │
│                                                            │
│  auth-middleware      request-context                      │
│  token -> userId      getUser() + getUserContext()        │
│                                                            │
│  ┌──────────────────────────┐  ┌────────────────────────┐ │
│  │ Global control plane     │  │ Per-user state roots   │ │
│  │                          │  │                        │ │
│  │ users                    │  │ users/user-a/...       │ │
│  │ user_sessions            │  │ users/user-b/...       │ │
│  │ auth tokens              │  │ MEMORY.md              │ │
│  │ admin-only ops routes    │  │ memory/, memories/     │ │
│  └──────────────────────────┘  │ webui_state/           │ │
│                                │ runtime/local-sessions │ │
│                                │ workspace/             │ │
│                                └────────────────────────┘ │
└──────────────────────┬────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────┐
│ Shared Hermes Agent / Dashboard deployment                 │
│                                                            │
│ Chat streaming, dashboard sessions, jobs, ops, config      │
│ remain one deployment and are mediated by workspace rules. │
└────────────────────────────────────────────────────────────┘
```

## Data Flow Examples

### Data Flow: Session Send

```text
POST /api/send-stream
        │
        ▼
getUser(request) -> user-a
        │
        ▼
resolve / claim ownership for target session
        │
        ▼
proxy to shared Hermes Agent runtime
        │
        ▼
stream response back only to user-a
```

## Consequences

### Positive

- user-visible state matches the privacy promise for session, files, and terminal
- memory isolation is explicitly deferred rather than shipped broken
- migration is simpler (no file copying — sessions are claimed, not duplicated)
- shared operational features remain available to admins
- future per-user runtime work has a stable filesystem layout to build on

### Costs

- more API routes must become context-aware
- regular-user terminal access is intentionally reduced in multi-user mode
- memory remains shared across all users — docs must be clear about this
- some upstream Hermes runtime state remains shared until upstream adds per-user support

## Explicit Non-Goals

This design does **not** claim to provide:

- OS-level sandboxing
- fully private shell execution on one shared Unix account
- per-user Hermes gateway home/profile/process
- **per-user memory isolation** (deferred — Agent runtime must support it first)
- private skills, MCP config, or provider credentials in v1

Those require a deeper runtime split than this repo currently has.

## Extension Points

Once `UserWorkspaceContext` exists, future work becomes simpler:

- sandboxed per-user terminal mode
- user-private MCP config
- user-private skill installs
- user-private gateway processes using the same `~/.hermes/users/<userId>/` roots
