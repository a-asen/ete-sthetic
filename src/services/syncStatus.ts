import { getCalMemory } from './calstore'
import { getContactMemory } from './contactstore'
import { readModuleEnabled, type ModuleName } from './moduleFlags'
import { getTaskMemory } from './taskstore'

// Global "last synced" rollup across whichever modules are enabled.
// Returns the *oldest* lastSyncedAt across all collections in those
// modules — the worst-case freshness, so the indicator's "Synced 3m
// ago" really does mean nothing is older than 3 m.
//
// Returns null in three cases:
//  - the user is logged out (memory caches are wiped),
//  - no module has synced yet this session, or
//  - the only enabled module is tasks and tasks has no collections
//    yet (e.g. fresh signup) — there's nothing to report on.

export interface SyncStatus {
  // ms-since-epoch of the oldest successful sync across enabled modules,
  // or null when nothing has been synced yet.
  oldestSyncedAt: number | null
  // Modules currently mid-sync. The SyncStatusPill flips to "Syncing…"
  // whenever this is non-empty.
  syncing: ReadonlySet<ModuleName>
  // Modules whose last sync failed since their previous success. Cleared
  // automatically the moment a module reports a successful sync. The
  // pill switches to a danger label when this is non-empty.
  failed: ReadonlySet<ModuleName>
}

// ---- Mutable in-process state ----
// All three sets/maps below are intentionally global module-singletons.
// Each module's View updates them on sync start/finish/error and the
// pill subscribes via `subscribeSyncStatus`. Wiping happens at logout
// time via `resetSyncStatus`.

const inFlight = new Set<ModuleName>()
const failures = new Set<ModuleName>()
const handlers = new Map<ModuleName, () => void | Promise<void>>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function subscribeSyncStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Called by each View when a sync begins/ends. Boolean is "is this
// module currently syncing now?" — the View's local sync state, lifted
// up. Errors live in their own setter so a finished-with-error sync
// can drop out of the in-flight set while still flagging the failure.
export function setModuleSyncing(m: ModuleName, syncing: boolean): void {
  const had = inFlight.has(m)
  if (syncing) inFlight.add(m)
  else inFlight.delete(m)
  if (had !== syncing) notify()
}

export function setModuleSyncFailed(m: ModuleName, failed: boolean): void {
  const had = failures.has(m)
  if (failed) failures.add(m)
  else failures.delete(m)
  if (had !== failed) notify()
}

// Register the module's "sync all my collections" entry point so the
// pill's click handler can call into every currently-mounted module.
// Returns an unregister fn for useEffect cleanup.
export function registerSyncAllHandler(
  m: ModuleName,
  handler: () => void | Promise<void>,
): () => void {
  handlers.set(m, handler)
  return () => {
    if (handlers.get(m) === handler) handlers.delete(m)
  }
}

// Trigger a sync-all on every module that has a registered handler AND
// is enabled. Disabled / unmounted modules silently no-op. Errors are
// swallowed (each module's handler is expected to flip its own
// setModuleSyncFailed before throwing).
export async function triggerSyncAll(): Promise<void> {
  const tasks: Array<Promise<void>> = []
  for (const [m, fn] of handlers) {
    if (!readModuleEnabled(m)) continue
    try {
      const res = fn()
      if (res) tasks.push(res.catch(() => {}))
    } catch {
      // Synchronous throw shouldn't happen — handlers wrap their own
      // work — but swallow defensively so one bad module can't sink
      // the others.
    }
  }
  await Promise.all(tasks)
}

// Called from etebase.logout so a re-login starts with a clean slate.
export function resetSyncStatus(): void {
  inFlight.clear()
  failures.clear()
  notify()
}

function timestampsFor(m: ModuleName): IterableIterator<number> {
  if (m === 'tasks') return getTaskMemory().syncedAt.values()
  if (m === 'calendar') return getCalMemory().lastSyncedAt.values()
  return getContactMemory().lastSyncedAt.values()
}

export function getSyncStatus(): SyncStatus {
  let oldest: number | null = null
  const syncing = new Set<ModuleName>()
  const failed = new Set<ModuleName>()
  for (const m of ['tasks', 'calendar', 'contacts'] as const) {
    if (!readModuleEnabled(m)) continue
    for (const ts of timestampsFor(m)) {
      if (oldest === null || ts < oldest) oldest = ts
    }
    if (inFlight.has(m)) syncing.add(m)
    if (failures.has(m)) failed.add(m)
  }
  return { oldestSyncedAt: oldest, syncing, failed }
}

// Compact relative-time formatter for the indicator pill.
// Buckets: "Just synced" < 5s, "Ns ago" < 60s, "Nm ago" < 60m,
// "Nh ago" < 24h, otherwise the local date string. Avoids `Intl` so
// the pill stays cheap to re-render on a 30s tick.
export function formatSyncAge(syncedAt: number, now: number): string {
  const diff = Math.max(0, Math.floor((now - syncedAt) / 1000))
  if (diff < 5) return 'Just synced'
  if (diff < 60) return `Synced ${diff}s ago`
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `Synced ${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Synced ${hours}h ago`
  return `Synced ${new Date(syncedAt).toLocaleDateString()}`
}
