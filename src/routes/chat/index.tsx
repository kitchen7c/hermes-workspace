import { createFileRoute, redirect } from '@tanstack/react-router'
import type { AuthStatus } from '@/lib/claude-auth'

const LAST_SESSION_KEY = 'claude-last-session'

export const Route = createFileRoute('/chat/')({
  ssr: false,
  beforeLoad: async () => {
    // Resolve auth first so shared browsers do not restore another
    // user's last-opened chat session.
    let lastSession = 'new'
    try {
      if (typeof window !== 'undefined') {
        let stored: string | null = null
        const res = await fetch('/api/auth-check', { cache: 'no-store' })
        const auth = res.ok ? ((await res.json()) as AuthStatus) : null
        if (auth?.multiUser && auth.user?.id) {
          stored = localStorage.getItem(`hermes:${auth.user.id}:last-session`)
        } else {
          stored =
            localStorage.getItem('last-session') ??
            localStorage.getItem('hermes:last-session') ??
            localStorage.getItem(LAST_SESSION_KEY)
        }
        if (stored && stored !== 'main') lastSession = stored
      }
    } catch {}
    throw redirect({
      to: '/chat/$sessionKey',
      params: { sessionKey: lastSession },
      replace: true,
    })
  },
  component: function ChatIndexRoute() {
    return null
  },
})
