# Sync model

All three modules share one sync design. The goals: **open instantly**, keep
the thing you're looking at **fresh**, and don't hammer the server for
collections you aren't touching.

## Layers

Reads flow through three layers, fastest first:

1. **Snapshots — cold-start disk cache.**
   On launch, each module hydrates from a local snapshot on disk
   (`snapshots.ts`, `calsnapshot.ts`, `contactsnapshot.ts`,
   `icsSubscriptionSnapshot.ts`) so the window is populated before any network
   round-trip.
2. **Stores — warm in-memory cache.**
   While the app runs, parsed items live in per-module in-memory stores
   (`taskstore.ts`, `calstore.ts`, `contactstore.ts`). The UI renders from
   these.
3. **Etebase — the network.**
   [`services/etebase.ts`](/architecture/services#etebase) wraps the official
   Etebase SDK: login/restore, listing collections, and per-type CRUD. It's
   the only module that talks to the server.

## Adaptive scheduling

Syncing is **adaptive per collection**:

- The **active** collection (the list/calendar/book you're viewing) syncs on a
  **fast** cadence.
- **Other** collections sync on a **slow** cadence.
- **Opening** a collection **delta-syncs** it — but only if it's gone stale,
  so switching between fresh collections is instant.

The background scheduler lives in
[`services/backgroundSync.ts`](/architecture/services), and current progress
is surfaced through [`services/syncStatus.ts`](/architecture/services) in the
**sync status pill** (`SyncStatusPill`) at the top-center of the window.

You can always force a sync of the active list with `Ctrl+Shift+S`.

## Optimistic writes

Creates, edits, and deletes apply to the in-memory store (and the UI)
**immediately**, then reconcile when the server write lands. If a write fails
or the server has diverged, the calendar surfaces a
[conflict modal](/guide/calendar#conflict-resolution); other modules resolve
last-write-wins against the reconciled state.

## Session & encryption

EteSync is end-to-end encrypted. ete-sthetic derives your keys locally at
login and stores the resulting **session encrypted on disk** via the Tauri
store plugin ([`services/store.ts`](/architecture/services)). Your password is
never persisted; logging out clears the session.

## At a glance

```
launch ──▶ snapshot (disk) ──▶ render immediately
                │
                ▼
        in-memory store ◀──▶ UI (optimistic writes)
                │
                ▼
     etebase.ts (SDK) ◀──▶ EteSync server
        ▲
        └── backgroundSync: active=fast, others=slow, open=delta-if-stale
```

## Related

- [Architecture › Services layer](/architecture/services)
- [Architecture › Tauri shell](/architecture/tauri-shell) — where the
  encrypted store lives
