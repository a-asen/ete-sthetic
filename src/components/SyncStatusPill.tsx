import { useEffect, useState } from 'react'
import { MODULE_FLAGS_CHANGED_EVENT } from '../services/moduleFlags'
import { formatSyncAge, getSyncStatus } from '../services/syncStatus'

// Fixed top-right indicator showing the worst-case freshness across
// every enabled module. Self-ticking on a 30 s cadence (the user
// only cares about minute-level resolution; faster ticks would burn
// renders for no signal). Hovering shows the absolute timestamp;
// clicking is a no-op for v1 — a "sync everything" trigger needs
// each currently-mounted view to expose its syncAll, which is a
// follow-up.
//
// Hidden entirely until at least one module has reported a sync, so
// a fresh login doesn't show "Synced never" before the first
// background sync lands.

const TICK_MS = 30_000

export function SyncStatusPill() {
  const [status, setStatus] = useState(getSyncStatus)
  const [now, setNow] = useState(() => Date.now())

  // Drive the relative-time label off a periodic tick. setInterval is
  // fine here — drift doesn't matter at 30 s resolution.
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
    return () => {
      window.clearInterval(id)
      window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  if (status.oldestSyncedAt === null) return null

  const label = formatSyncAge(status.oldestSyncedAt, now)
  const absolute = new Date(status.oldestSyncedAt).toLocaleString()

  return (
    <div
      title={`Oldest sync across enabled modules: ${absolute}`}
      role="status"
      aria-live="polite"
      className="pointer-events-auto fixed right-3 top-3 z-40 flex items-center gap-1.5 rounded-full border border-border bg-surface/95 px-2.5 py-1 text-[11px] text-text-muted shadow-sm backdrop-blur-sm"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-accent"
      />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
