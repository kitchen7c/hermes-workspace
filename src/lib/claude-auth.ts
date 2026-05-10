export interface AuthStatus {
  authenticated: boolean
  authRequired: boolean
  error?: string
  multiUser?: boolean
  user?: {
    id: string
    username: string
    role: 'admin' | 'user'
  }
}

export async function fetchWorkspaceAuthStatus(
  timeoutMs = 5_000,
): Promise<AuthStatus> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch('/api/auth-check', { signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out after 5 seconds')
    }

    throw error instanceof Error
      ? error
      : new Error('Failed to connect to Hermes Agent')
  } finally {
    globalThis.clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  return (await res.json()) as AuthStatus
}

export type BackendConnectionStatus = {
  ok: boolean
  chatReady: boolean
  modelConfigured: boolean
}

export async function fetchBackendConnectionStatus(
  timeoutMs = 5_000,
): Promise<BackendConnectionStatus> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch('/api/connection-status', {
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out after 5 seconds')
    }

    throw error instanceof Error
      ? error
      : new Error('Failed to connect to Hermes Agent')
  } finally {
    globalThis.clearTimeout(timeout)
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const data = (await res.json()) as {
    ok?: boolean
    chatReady?: boolean
    modelConfigured?: boolean
  }

  return {
    ok: data.ok === true,
    chatReady: data.chatReady === true,
    modelConfigured: data.modelConfigured === true,
  }
}

export const fetchClaudeAuthStatus = fetchWorkspaceAuthStatus
