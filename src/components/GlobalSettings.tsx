import { useEffect, useState } from 'react'
import {
  applyAccent,
  applyStoredTheme,
  readStoredAccent,
  readStoredThemePref,
  writeStoredAccent,
  writeStoredThemePref,
  type ThemePref,
} from '../services/theme'
import {
  HINTS_CHANGED_EVENT,
  readHintsEnabled,
  setHintsEnabled,
} from '../services/hints'
import { getAccountInfo, logout, type AccountInfo } from '../services/etebase'
import { SettingsWindow } from './SettingsWindow'
import { SettingsSection } from './SettingsSection'
import { ModuleToggles } from './ModuleToggles'
import { BlueprintsSettings } from './BlueprintsSettings'

// Curated accent presets (default mint first) — mirrors the tasks popover.
const ACCENT_PRESETS = [
  '#2f8a6c',
  '#3b82f6',
  '#8b5cf6',
  '#e0699f',
  '#e07a3f',
  '#d9b23a',
  '#10b981',
  '#ef4444',
]

const SECTIONS = [
  { id: 'shared.appearance', label: 'Appearance' },
  { id: 'shared.modules', label: 'Modules' },
  { id: 'tasks.blueprints', label: 'Task Blueprints' },
  { id: 'shared.account', label: 'Account' },
] as const

// App-wide ("general") settings — appearance, which modules are enabled /
// their order, and the account — surfaced from the top-bar gear next to the
// sync pill rather than buried in a per-module popover. Reuses the same
// SettingsWindow + SettingsSection shell the per-module popovers use.
export function GlobalSettings({
  onClose,
  onLoggedOut,
}: {
  onClose: () => void
  onLoggedOut: () => void
}) {
  const [themePref, setThemePrefState] = useState<ThemePref>(
    readStoredThemePref,
  )
  const setTheme = (p: ThemePref) => {
    writeStoredThemePref(p)
    applyStoredTheme()
    setThemePrefState(p)
  }

  const [accent, setAccentState] = useState<string | null>(readStoredAccent)
  const setAccent = (hex: string | null) => {
    writeStoredAccent(hex)
    applyAccent(hex)
    setAccentState(hex)
  }
  const [hex, setHex] = useState(accent ?? '#2f8a6c')
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hex)

  const [hintsOn, setHintsOn] = useState(readHintsEnabled)
  useEffect(() => {
    const refresh = () => setHintsOn(readHintsEnabled())
    window.addEventListener(HINTS_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(HINTS_CHANGED_EVENT, refresh)
  }, [])

  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  useEffect(() => {
    let alive = true
    getAccountInfo().then((a) => {
      if (alive) setAccount(a)
    })
    return () => {
      alive = false
    }
  }, [])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    await logout()
    onClose()
    onLoggedOut()
  }

  return (
    <SettingsWindow title="Settings" sections={SECTIONS} onClose={onClose}>
      <SettingsSection id="shared.appearance" label="Appearance" forceOpen>
        <Row label="Theme">
          <span className="flex items-center rounded-md border border-border text-[11px] text-text-muted">
            {(['system', 'light', 'dark'] as const).map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => setTheme(p)}
                aria-pressed={themePref === p}
                className={`h-6 px-2 capitalize transition-colors ${
                  i === 0 ? 'rounded-l-md' : ''
                } ${i === 2 ? 'rounded-r-md' : 'border-r border-border'} ${
                  themePref === p
                    ? 'bg-accent-soft text-accent'
                    : 'hover:bg-surface-2 hover:text-text'
                }`}
              >
                {p}
              </button>
            ))}
          </span>
        </Row>

        <div className="px-3 py-2">
          <p className="mb-1.5 text-[11px] text-text-faint">Accent</p>
          <div className="flex flex-wrap gap-1.5">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAccent(c)}
                title={c}
                aria-label={`Accent ${c}`}
                className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                  accent === c ? 'border-text' : 'border-border'
                }`}
                style={{ background: c }}
              />
            ))}
            <button
              type="button"
              onClick={() => setAccent(null)}
              title="Theme default"
              aria-label="Default accent"
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-colors ${
                accent === null
                  ? 'border-text text-text'
                  : 'border-border text-text-faint hover:border-border-strong hover:text-text-muted'
              }`}
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="color"
              value={hexValid ? hex : '#2f8a6c'}
              onChange={(e) => setHex(e.target.value)}
              aria-label="Custom accent picker"
              className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
            />
            <input
              type="text"
              value={hex}
              spellCheck={false}
              onChange={(e) => setHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hexValid) {
                  e.preventDefault()
                  setAccent(hex.toLowerCase())
                }
              }}
              aria-label="Custom accent hex"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-1.5 py-1 font-mono text-xs text-text outline-none focus:border-border-strong"
            />
            <button
              type="button"
              disabled={!hexValid}
              onClick={() => setAccent(hex.toLowerCase())}
              className="shrink-0 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>

        <Row label="Show usage hints">
          <Toggle
            on={hintsOn}
            onClick={() => setHintsEnabled(!hintsOn)}
            label="Show usage hints"
          />
        </Row>
      </SettingsSection>

      <ModuleToggles forceOpen />

      <BlueprintsSettings />

      <SettingsSection id="shared.account" label="Account" forceOpen>
        <div className="space-y-2 px-3 py-2 text-xs">
          {account ? (
            <>
              <Field label="Account" value={account.username} />
              {account.email && <Field label="Email" value={account.email} />}
              <Field label="Server" value={account.serverUrl} />
            </>
          ) : (
            <p className="text-text-faint">Not signed in.</p>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="mt-1 w-full rounded-md border border-border px-3 py-1.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </SettingsSection>
    </SettingsWindow>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <span className="text-xs text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-text-faint">
        {label}
      </span>
      <span className="block break-all text-text">{value}</span>
    </div>
  )
}

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors ${
        on ? 'border-accent/50 bg-accent-soft' : 'border-border bg-surface-2'
      }`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${
          on ? 'left-4 bg-accent' : 'left-0.5 bg-text-faint'
        }`}
      />
    </button>
  )
}
