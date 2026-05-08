/**
 * User-namespaced localStorage/sessionStorage wrappers.
 *
 * In multi-user mode, keys are prefixed with the current user's ID so
 * browser state (last session, sidebar preferences, etc.) does not
 * leak across accounts sharing the same browser.
 *
 * The workspace shell sets window.__hermes_userId after auth check.
 * Before that, all keys fall back to unprefixed (legacy) mode.
 */

// Extend Window interface for our global
declare global {
  interface Window {
    __hermes_userId?: string
  }
}

function getPrefix(): string {
  try {
    if (typeof window !== 'undefined' && window.__hermes_userId) {
      return `hermes:${window.__hermes_userId}:`
    }
  } catch {
    // SSR or unavailable
  }
  return ''
}

export const namespacedLocalStorage = {
  getItem(key: string): string | null {
    try {
      const prefixed = getPrefix() + key
      return window.localStorage.getItem(prefixed)
    } catch {
      return null
    }
  },

  setItem(key: string, value: string): void {
    try {
      const prefixed = getPrefix() + key
      window.localStorage.setItem(prefixed, value)
    } catch {
      // ignore
    }
  },

  removeItem(key: string): void {
    try {
      const prefixed = getPrefix() + key
      window.localStorage.removeItem(prefixed)
    } catch {
      // ignore
    }
  },
}

export const namespacedSessionStorage = {
  getItem(key: string): string | null {
    try {
      const prefixed = getPrefix() + key
      return window.sessionStorage.getItem(prefixed)
    } catch {
      return null
    }
  },

  setItem(key: string, value: string): void {
    try {
      const prefixed = getPrefix() + key
      window.sessionStorage.setItem(prefixed, value)
    } catch {
      // ignore
    }
  },

  removeItem(key: string): void {
    try {
      const prefixed = getPrefix() + key
      window.sessionStorage.removeItem(prefixed)
    } catch {
      // ignore
    }
  },
}
