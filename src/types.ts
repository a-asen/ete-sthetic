export type Priority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type TaskStatus =
  | 'NEEDS-ACTION'
  | 'COMPLETED'
  | 'IN-PROCESS'
  | 'CANCELLED'

export type Classification = 'PUBLIC' | 'PRIVATE' | 'CONFIDENTIAL'

// A RELATED-TO link that is *not* the parent link (parent drives the tree
// and lives in `parentUid`). reltype is upper-cased; common values are
// CHILD, SIBLING, and the RFC 9253 dependency types (DEPENDS-ON, …).
export interface RelatedLink {
  uid: string
  reltype: string
}

export interface VTodo {
  uid: string
  summary: string
  description?: string
  status: TaskStatus
  priority: Priority
  // Raw VTODO date/date-time strings, e.g. "20260520" or "20260520T140000Z".
  due?: string
  dtStart?: string
  created?: string
  // COMPLETED timestamp (set when status → COMPLETED, cleared otherwise).
  completed?: string
  lastModified?: string
  parentUid?: string
  categories: string[]
  // 0–100. Independent of STATUS, though COMPLETED implies 100.
  percentComplete?: number
  url?: string
  location?: string
  geo?: { lat: number; lon: number }
  classification?: Classification
  comment?: string
  resources?: string[]
  relatedTo?: RelatedLink[]
  // True when the source iCal couldn't be parsed and this is a
  // best-effort recovery. Most fields are defaults; `raw` holds the
  // original content for the raw editor. Not normally editable via
  // VTodoPatch — use the raw passthrough.
  broken?: boolean
  raw: string
}

export interface TaskItem {
  itemUid: string
  todo: VTodo
}

export interface TaskNode extends TaskItem {
  children: TaskNode[]
  depth: number
}

export interface CollectionInfo {
  uid: string
  name: string
  description?: string
  color?: string
  // True if this collection is a server-side tombstone (deleted in some
  // other client but not yet hard-purged). Only set when the caller
  // explicitly asked for deleted collections.
  isDeleted?: boolean
}

// ---- Calendar (VEVENT) ----

// EteSync collection content types. Tasks already exist; calendar/contacts
// are the unified-client expansion (docs/calendar-contacts-plan.md).
export type ColType = 'etebase.vtodo' | 'etebase.vevent' | 'etebase.vcard'

// A VALARM trigger reduced to what the in-app reminder scheduler needs.
// Either relative (offset in seconds from the event start or end) or
// absolute (a fixed instant). EMAIL alarms are kept but never fire an OS
// notification (no mail transport); DISPLAY/AUDIO do.
export interface VAlarm {
  action: string
  // Relative trigger: signed seconds (negative = before). `relTo` says
  // whether the offset is from DTSTART or DTEND.
  relSeconds?: number
  relTo?: 'start' | 'end'
  // Absolute trigger instant (TRIGGER;VALUE=DATE-TIME).
  at?: Date
  description?: string
}

export interface VEvent {
  uid: string
  summary: string
  description?: string
  location?: string
  // Raw iCalendar strings, e.g. "20260520" or "20260520T140000Z".
  dtStart?: string
  dtEnd?: string
  // True when DTSTART is a VALUE=DATE (no time-of-day).
  allDay: boolean
  // Resolved to JS Date for grid placement. `end` is exclusive per
  // RFC 5545 (DTEND is non-inclusive).
  start?: Date
  end?: Date
  status?: string
  categories: string[]
  // Present verbatim when the event recurs. v1 does NOT expand occurrences
  // (calendar-contacts-plan.md phase 4 — high risk); we surface the base
  // event and flag it so the grid can mark it.
  rrule?: string
  recurring: boolean
  alarms: VAlarm[]
  created?: string
  lastModified?: string
  raw: string
}

export interface EventItem {
  itemUid: string
  event: VEvent
  // Set on expanded recurrence instances: a per-occurrence identity
  // (`${itemUid}@${startMs}`) used for React keys / dedupe. The real
  // itemUid is shared by every occurrence of the series, so edit/delete
  // still act on the base event.
  occId?: string
}

// ---- Contacts (vCard) ----

// A typed, single-valued vCard property (EMAIL / TEL / URL). `type` is the
// lower-cased TYPE token chosen for display (home / work / cell / …), '' if
// none.
export interface VCardField {
  value: string
  type: string
}

// Structured N property — the five RFC 6350 components.
export interface VCardName {
  family: string
  given: string
  additional: string
  prefixes: string
  suffixes: string
}

// Structured ADR property — the seven RFC 6350 components plus the chosen
// TYPE token. pobox / ext are modelled (so they round-trip) but the editor
// only surfaces street…country.
export interface VCardAddress {
  type: string
  pobox: string
  ext: string
  street: string
  locality: string
  region: string
  postal: string
  country: string
}

export interface VCard {
  // vCard UID property (distinct from the Etebase item uid). Synthesised
  // if the source card omits it.
  uid: string
  // Formatted display name (FN). Always present — derived from N / an
  // email when the card has no FN.
  fn: string
  name: VCardName
  org: string
  title: string
  emails: VCardField[]
  phones: VCardField[]
  urls: VCardField[]
  addresses: VCardAddress[]
  // Raw BDAY value (e.g. "1990-05-15" or "19900515"), '' if none.
  birthday: string
  note: string
  categories: string[]
  // Display-only: a `data:` URI or http(s) URL usable as an <img> src.
  // Preserved verbatim on save (never re-encoded).
  photo?: string
  raw: string
}

export interface ContactItem {
  itemUid: string
  card: VCard
}

export type TaskSort = 'priority' | 'due' | 'created' | 'summary'

export interface TaskSortSpec {
  sort: TaskSort
  reverse: boolean
}

export const DEFAULT_TASK_SORT: TaskSortSpec = {
  sort: 'created',
  reverse: false,
}
