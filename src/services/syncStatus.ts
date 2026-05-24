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
}

function timestampsFor(m: ModuleName): IterableIterator<number> {
  if (m === 'tasks') return getTaskMemory().syncedAt.values()
  if (m === 'calendar') return getCalMemory().lastSyncedAt.values()
  return getContactMemory().lastSyncedAt.values()
}

export function getSyncStatus(): SyncStatus {
  let oldest: number | null = null
  for (const m of ['tasks', 'calendar', 'contacts'] as const) {
    if (!readModuleEnabled(m)) continue
    for (const ts of timestampsFor(m)) {
      if (oldest === null || ts < oldest) oldest = ts
    }
  }
  return { oldestSyncedAt: oldest }
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
