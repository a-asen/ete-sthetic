import { useEffect, useRef, useState } from 'react'
import { MODULE_FLAGS_CHANGED_EVENT } from '../services/moduleFlags'
import {
  clearSyncLog,
  formatSyncAge,
  getSyncLog,
  getSyncStatus,
  subscribeSyncStatus,
  triggerSyncAll,
  type SyncLogEntry,
} from '../services/syncStatus'

// Indicator showing the worst-case freshness across every enabled
// module. Rendered inline inside App's top bar. Self-ticks on a 30 s
// cadence and re-renders the instant any module flips its in-flight /
// error state. Clicking the pill opens a details panel: per-status
// summary, a "Sync now" action, and a log of recent sync failures with
// guidance — so a red dot is explainable, not mysterious.
//
// Hidden entirely until at least one module has reported a sync, so a
// fresh login doesn't show "Synced never" before the first background
// sync lands.

const TICK_MS = 30_000

// Network-ish failures get connection-oriented guidance; everything else
// gets the generic retry/re-auth advice.
function guidanceFor(message: string): string {
  if (
    /network|fetch|failed to fetch|load failed|econn|timeout|timed out|offline|dns|unreachable/i.test(
      message,
    )
  ) {
    return 'Looks like a connection problem — check your internet; the EteSync server may be unreachable. It will retry automatically.'
  }
  if (/unauthor|forbidden|401|403|login|session/i.test(message)) {
    return 'Your session may have expired. Try signing out and back in from Home.'
  }
  return 'A retry often clears this. If it keeps happening, sign out and back in.'
}

function relTime(at: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - at) / 1000))
  if (diff < 60) return `${diff}s ago`
  const m = Math.floor(diff / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(at).toLocaleString()
}

export function SyncStatusPill() {
  const [status, setStatus] = useState(getSyncStatus)
  const [log, setLog] = useState<readonly SyncLogEntry[]>(getSyncLog)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const refresh = () => {
      setStatus(getSyncStatus())
      setLog([...getSyncLog()])
      setNow(Date.now())
    }
    const id = window.setInterval(refresh, TICK_MS)
    window.addEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
    window.addEventListener('focus', refresh)
    const unsubscribe = subscribeSyncStatus(refresh)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(MODULE_FLAGS_CHANGED_EVENT, refresh)
      window.removeEventListener('focus', refresh)
      unsubscribe()
    }
  }, [])

  // Close the panel on click-away / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hasTimestamp = status.oldestSyncedAt !== null
  const isSyncing = status.syncing.size > 0
  const hasFailures = status.failed.size > 0
  if (!hasTimestamp && !isSyncing && !hasFailures && log.length === 0)
    return null

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

  const dotColor = hasFailures
    ? 'bg-danger'
    : isSyncing
      ? 'bg-accent animate-pulse'
      : 'bg-accent'

  const textColor = hasFailures ? 'text-danger' : 'text-text-muted'

  async function handleSyncNow() {
    if (busy || isSyncing) return
    setBusy(true)
    try {
      await triggerSyncAll()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Sync status — click for details"
        aria-live="polite"
        className={`flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] transition-colors hover:border-border-strong ${textColor}`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <span className="tabular-nums">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Sync details"
          className="absolute right-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-lg border border-border bg-surface text-xs shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="font-medium text-text">
                {isSyncing
                  ? 'Syncing…'
                  : hasFailures
                    ? 'Last sync had problems'
                    : 'Up to date'}
              </div>
              <div className="truncate text-[11px] text-text-faint">
                Oldest synced: {absolute}
              </div>
            </div>
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={busy || isSyncing}
              className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy || isSyncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>

          {isSyncing && (
            <div className="border-b border-border px-3 py-1.5 text-[11px] text-text-muted">
              In progress: {[...status.syncing].join(', ')}
            </div>
          )}

          <div className="max-h-72 overflow-y-auto">
            {log.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-text-faint">
                No sync errors recorded this session. 🎉
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                {log.map((e, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium capitalize text-danger">
                        {e.module}
                      </span>
                      <span className="shrink-0 tabular-nums text-text-faint">
                        {relTime(e.at, now)}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-text-muted">
                      {e.message}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-faint">
                      {guidanceFor(e.message)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {log.length > 0 && (
            <div className="flex justify-end border-t border-border px-3 py-1.5">
              <button
                type="button"
                onClick={() => {
                  clearSyncLog()
                  setLog([])
                }}
                className="rounded px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                Clear log
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
