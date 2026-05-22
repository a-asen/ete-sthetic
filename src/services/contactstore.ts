import type { CollectionInfo, ContactItem } from '../types'

// Process-lifetime in-memory cache of the contacts module's state.
// Survives ContactsView unmount/remount (switching modules) so returning
// to contacts is instant — no spinner, no refetch. Disk snapshots
// (contactsnapshot.ts) cover a cold app start; this covers warm
// navigation. Mirrors calstore.ts.
//
// Deliberately not reactive: ContactsView owns the React state and mirrors
// it here on change, then re-seeds from here on mount.

export interface ContactMemory {
  addressBooks: CollectionInfo[] | null
  contactsByBook: Map<string, ContactItem[]>
  stokenByBook: Map<string, string>
  // Last successful sync time per book (ms epoch). Survives module
  // switches so the sidebar header doesn't lose its "Synced …" stamp.
  lastSyncedAt: Map<string, number>
  activeBook: string | null
  selectedContact: string | null
  // True once a network sync has completed at least once this session, so
  // remounts can skip straight to a background delta sync.
  warmed: boolean
}

const mem: ContactMemory = {
  addressBooks: null,
  contactsByBook: new Map(),
  stokenByBook: new Map(),
  lastSyncedAt: new Map(),
  activeBook: null,
  selectedContact: null,
  warmed: false,
}

export function getContactMemory(): ContactMemory {
  return mem
}

export function patchContactMemory(patch: Partial<ContactMemory>): void {
  Object.assign(mem, patch)
}

// Wipe on logout.
export function resetContactMemory(): void {
  mem.addressBooks = null
  mem.contactsByBook = new Map()
  mem.stokenByBook = new Map()
  mem.lastSyncedAt = new Map()
  mem.activeBook = null
  mem.selectedContact = null
  mem.warmed = false
}
