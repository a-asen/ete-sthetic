import { useEffect, useState } from 'react'
import { MODULE_FLAGS_CHANGED_EVENT } from '../services/moduleFlags'
import {
  formatSyncAge,
  getSyncStatus,
  subscribeSyncStatus,
  triggerSyncAll,
} from '../services/syncStatus'

// Fixed top-right indicator showing the worst-case freshness across
// every enabled module. Self-ticks on a 30 s cadence (the user only
// cares about minute-level resolution; faster ticks would burn renders
// for no signal) and additionally re-renders the instant any module
// flips its in-flight / error state. Clicking the pill triggers
// `triggerSyncAll()` — every currently-mounted enabled module's
// registered sync-all handler.
//
// Hidden entirely until at least one module has reported a sync, so a
// fresh login doesn't show "Synced never" before the first background
// sync lands.

const TICK_MS = 30_000

export function SyncStatusPill() {
  const [status, setStatus] = useState(getSyncStatus)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const refresh = () => {
      setStatus(getSyncStatus())
      setNow(Date.now())
    }
    const id = window.setInterval(refresh, TICK_MS)
    // Recompute immediately when modules are enabled/disabled so the
    // pill drops a calendar's timestamp from the "oldest" rollup the
    // moment the user disables calendar.
    window.addEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
    // Recompute when the window regains focus — long-idle laptops
    // shouldn't show a stale "30 s ago" frozen from before the lid
    // was closed.
    window.addEventListener('focus', refresh)
    // Subscribe to mid-sync state changes pushed by each module's view.
    const unsubscribe = subscribeSyncStatus(refresh)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
      unsubscribe()
    }
  }, [])

  // Visibility rules: show as soon as anything is syncing (so the user
  // sees activity from the very first sync of a fresh session), or
  // failed, or once a real timestamp lands.
  const hasTimestamp = status.oldestSyncedAt !== null
  const isSyncing = status.syncing.size > 0
  const hasFailures = status.failed.size > 0
  if (!hasTimestamp && !isSyncing && !hasFailures) return null

  const label = isSyncing
    ? 'Syncing…'
    : hasFailures
      ? `${status.failed.size} failed`
      : hasTimestamp
        ? formatSyncAge(status.oldestSyncedAt!, now)
        : 'Synced never'

  const absolute = hasTimestamp
    ? new Date(status.oldestSyncedAt!).toLocaleString()
    : 'no successful sync yet this session'

  const tooltip = hasFailures
    ? `Sync failed: ${[...status.failed].join(', ')} — click to retry`
    : isSyncing
      ? `Syncing: ${[...status.syncing].join(', ')}`
      : `Oldest sync across enabled modules: ${absolute} · click to sync now`

  const dotColor = hasFailures
    ? 'bg-danger'
    : isSyncing
      ? 'bg-accent animate-pulse'
      : 'bg-accent'

  const textColor = hasFailures ? 'text-danger' : 'text-text-muted'

  async function handleClick() {
    if (busy || isSyncing) return
    setBusy(true)
    try {
      await triggerSyncAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || isSyncing}
      title={tooltip}
      aria-label={tooltip}
      aria-live="polite"
      className={`pointer-events-auto fixed right-3 top-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-surface/95 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur-sm transition-colors hover:border-border-strong disabled:cursor-not-allowed ${textColor}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
      />
      <span className="tabular-nums">{label}</span>
    </button>
  )
}
