import { useEffect, useState } from 'react'
import { getAccountInfo, logout, type AccountInfo } from '../services/etebase'

interface Props {
  // App flips auth back to the login screen; same contract as the other
  // module views so the top-bar logout lives in one place.
  onLoggedOut: () => void
}

// The always-on landing module (see moduleFlags — "home" can't be disabled).
// Existing so tasks/calendar/contacts can each be hidden without leaving the
// user with nowhere to go. Shows who you're signed in as, the server you're
// pointed at, and a sign-out button. If the session can't be resolved
// (cleared/expired) it shows a prompt to sign in instead.
export function HomeView({ onLoggedOut }: Props) {
  const [info, setInfo] = useState<AccountInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let alive = true
    getAccountInfo()
      .then((res) => {
        if (alive) setInfo(res)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  async function handleLogout() {
    if (signingOut) return
    setSigningOut(true)
    await logout()
    onLoggedOut()
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-medium tracking-tight text-text">
            ete-sthetic
          </h1>
          <p className="text-xs text-text-faint">
            Your encrypted tasks, calendar &amp; contacts
          </p>
        </header>

        {loading ? (
          <p className="text-center text-sm text-text-faint">Loading…</p>
        ) : info ? (
          <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
            <div className="space-y-3">
              <Field label="Account" value={info.username} />
              {info.email && <Field label="Email" value={info.email} />}
              <Field label="Server" value={info.serverUrl} />
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={signingOut}
              className="w-full rounded-md border border-border px-3 py-2 text-sm text-text-muted transition hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-border bg-surface p-4 text-center">
            <p className="text-sm text-text-muted">
              You're not signed in.
            </p>
            <button
              type="button"
              onClick={onLoggedOut}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-bg transition hover:opacity-90"
            >
              Sign in
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-text-faint">
        {label}
      </span>
      <span className="block break-all text-sm text-text">{value}</span>
    </div>
  )
}
