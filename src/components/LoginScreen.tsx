import { useState } from 'react'
import { DEFAULT_SERVER, login } from '../services/etebase'

interface Props {
  onAuthenticated: () => void
}

// Persists across logouts so a user who pointed at a self-hosted server
// doesn't have to re-type the URL each time. Stored in localStorage (not
// the session Tauri Store) precisely because we want it to outlive a
// logout that wipes the session.
const SERVER_PREF_KEY = 'ete-sthetic.etebase.serverUrl'

function readSavedServer(): string {
  try {
    const raw = localStorage.getItem(SERVER_PREF_KEY)
    return raw && raw.trim() ? raw : DEFAULT_SERVER
  } catch {
    return DEFAULT_SERVER
  }
}

function writeSavedServer(url: string): void {
  try {
    if (url === DEFAULT_SERVER) localStorage.removeItem(SERVER_PREF_KEY)
    else localStorage.setItem(SERVER_PREF_KEY, url)
  } catch {
    // Quota or disabled storage — silently drop; the value will just
    // default again on next login, which is annoying but not broken.
  }
}

export function LoginScreen({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const initialServer = readSavedServer()
  const [server, setServer] = useState(initialServer)
  // Auto-expand the disclosure when a non-default server is saved so the
  // user can see (and edit) the URL they're about to authenticate with.
  const [showAdvanced, setShowAdvanced] = useState(
    initialServer !== DEFAULT_SERVER,
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    const chosen = server.trim() || DEFAULT_SERVER
    try {
      await login(username.trim(), password, chosen)
      writeSavedServer(chosen)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5"
        autoComplete="on"
      >
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-medium tracking-tight text-text">
            ete-sthetic
          </h1>
          <p className="text-xs text-text-faint">Sign in to your EteSync account</p>
        </header>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">
              Username
            </span>
            <input
              type="text"
              autoComplete="username"
              required
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">
              Password
            </span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </label>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-xs text-text-faint hover:text-text-muted"
            >
              {showAdvanced ? '− Hide server' : '+ Custom server'}
            </button>
            {showAdvanced && (
              <label className="mt-2 block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">
                  Server URL
                </span>
                <input
                  type="url"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  disabled={submitting}
                  placeholder={DEFAULT_SERVER}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                />
              </label>
            )}
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || !username || !password}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
