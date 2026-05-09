import { useState } from 'react'
import { DEFAULT_SERVER, login } from '../services/etebase'

interface Props {
  onAuthenticated: () => void
}

export function LoginScreen({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState(DEFAULT_SERVER)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password, server.trim() || DEFAULT_SERVER)
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
            ete-stethic
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
