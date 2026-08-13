import {
  listAddressBooks,
  listCalendars,
  listContactItems,
  listEventItems,
} from './etebase'
import { loadCalSnapshot, saveCalSnapshot } from './calsnapshot'
import { loadContactSnapshot, saveContactSnapshot } from './contactsnapshot'
import { getCalMemory, patchCalMemory } from './calstore'
import { getContactMemory, patchContactMemory } from './contactstore'
import {
  logSyncFailure,
  setModuleSyncFailed,
  setModuleSyncing,
} from './syncStatus'

const msgOf = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)
import type { ContactItem, EventItem } from '../types'

// Headless equivalents of CalendarView.loadAll / ContactsView's mount sync,
// callable before the lazy module Views have mounted. Lets the app start a
// real network sync for every enabled module the moment the user lands on
// the home screen, instead of waiting for them to navigate to each module.
// The results land in the same in-memory caches (calstore / contactstore)
// the Views read from, so a later navigation paints the freshly-synced
// data with zero spinner.

let calendarsInFlight: Promise<void> | null = null
let contactsInFlight: Promise<void> | null = null

async function syncOneCalendar(uid: string, signal: AbortSignal): Promise<void> {
  const mem = getCalMemory()
  const acc = new Map<string, EventItem>(
    (mem.eventsByCal.get(uid) ?? []).map((e) => [e.itemUid, e]),
  )
  let fromStoken = mem.stokenByCal.get(uid)
  // Cold (no memory seed): pull the disk snapshot for a stoken so the
  // first network round-trip is a delta rather than a full re-sync.
  if (acc.size === 0 && !fromStoken) {
    const snap = await loadCalSnapshot(uid)
    if (snap && !signal.aborted) {
      for (const e of snap.events) acc.set(e.itemUid, e)
      fromStoken = snap.stoken
      mem.eventsByCal.set(uid, [...acc.values()])
      mem.lastSyncedAt.set(uid, snap.lastSyncedAt)
    }
  }
  const res = await listEventItems(uid, {
    signal,
    fromStoken,
    onBatch: (batch) => {
      if (signal.aborted) return
      for (const e of batch) acc.set(e.itemUid, e)
      mem.eventsByCal.set(uid, [...acc.values()])
    },
  })
  if (signal.aborted) return
  for (const removed of res.removed) acc.delete(removed)
  const finalList = [...acc.values()]
  mem.eventsByCal.set(uid, finalList)
  mem.stokenByCal.set(uid, res.stoken)
  const now = Date.now()
  mem.lastSyncedAt.set(uid, now)
  await saveCalSnapshot({
    version: 1,
    uid,
    events: finalList,
    stoken: res.stoken,
    lastSyncedAt: now,
  })
}

export function syncCalendarsInBackground(
  signal?: AbortSignal,
): Promise<void> {
  if (calendarsInFlight) return calendarsInFlight
  const ac = signal ?? new AbortController().signal
  calendarsInFlight = (async () => {
    setModuleSyncing('calendar', true)
    try {
      const mem = getCalMemory()
      let cals = mem.calendars
      if (!cals) {
        cals = await listCalendars()
        if (ac.aborted) return
        patchCalMemory({ calendars: cals })
      }
      const live = cals.filter((c) => !c.isDeleted)
      await Promise.all(
        live.map((c) =>
          syncOneCalendar(c.uid, ac).catch((e) => {
            // Per-calendar failure flags the module but doesn't
            // abort the rest — partial freshness is better than none.
            setModuleSyncFailed('calendar', true)
            logSyncFailure('calendar', `${c.name}: ${msgOf(e)}`)
          }),
        ),
      )
      patchCalMemory({ warmed: true })
    } catch (e) {
      setModuleSyncFailed('calendar', true)
      logSyncFailure('calendar', msgOf(e))
    } finally {
      setModuleSyncing('calendar', false)
      calendarsInFlight = null
    }
  })()
  return calendarsInFlight
}

function mergeContacts(
  existing: ContactItem[],
  incoming: ContactItem[],
  removed: string[],
): ContactItem[] {
  const byUid = new Map(existing.map((c) => [c.itemUid, c]))
  for (const uid of removed) byUid.delete(uid)
  for (const it of incoming) byUid.set(it.itemUid, it)
  return [...byUid.values()]
}

async function syncOneBook(uid: string, signal: AbortSignal): Promise<void> {
  const mem = getContactMemory()
  let seed = mem.contactsByBook.get(uid) ?? []
  let fromStoken = mem.stokenByBook.get(uid)
  if (seed.length === 0 && !fromStoken) {
    const snap = await loadContactSnapshot(uid)
    if (snap && !signal.aborted) {
      seed = snap.contacts
      fromStoken = snap.stoken
      mem.contactsByBook.set(uid, seed)
      if (snap.lastSyncedAt) mem.lastSyncedAt.set(uid, snap.lastSyncedAt)
    }
  }
  const result = await listContactItems(uid, { signal, fromStoken })
  if (signal.aborted) return
  const merged = fromStoken
    ? mergeContacts(seed, result.items, result.removed)
    : result.items
  mem.contactsByBook.set(uid, merged)
  if (result.stoken) mem.stokenByBook.set(uid, result.stoken)
  const now = Date.now()
  mem.lastSyncedAt.set(uid, now)
  await saveContactSnapshot({
    version: 1,
    uid,
    contacts: merged,
    stoken: result.stoken,
    lastSyncedAt: now,
  })
}

export function syncContactsInBackground(
  signal?: AbortSignal,
): Promise<void> {
  if (contactsInFlight) return contactsInFlight
  const ac = signal ?? new AbortController().signal
  contactsInFlight = (async () => {
    setModuleSyncing('contacts', true)
    try {
      const mem = getContactMemory()
      let books = mem.addressBooks
      if (!books) {
        books = await listAddressBooks()
        if (ac.aborted) return
        patchContactMemory({ addressBooks: books })
      }
      const live = books.filter((b) => !b.isDeleted)
      await Promise.all(
        live.map((b) =>
          syncOneBook(b.uid, ac).catch((e) => {
            setModuleSyncFailed('contacts', true)
            logSyncFailure('contacts', `${b.name}: ${msgOf(e)}`)
          }),
        ),
      )
      patchContactMemory({ warmed: true })
    } catch (e) {
      setModuleSyncFailed('contacts', true)
      logSyncFailure('contacts', msgOf(e))
    } finally {
      setModuleSyncing('contacts', false)
      contactsInFlight = null
    }
  })()
  return contactsInFlight
}
