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
  // Manual sort position, read from X-APPLE-SORT-ORDER (the de-facto
  // cross-client ordering key — Apple Reminders et al.). Synced via the
  // VTODO itself so a hand-arranged order follows the user across
  // devices. Undefined for tasks that have never been manually ordered;
  // the 'manual' comparator sends those to the bottom (created order).
  sortOrder?: number
  // Recurrence rule (the RRULE value, without the "RRULE:" prefix), stored
  // verbatim. Tasks use a regenerate-on-complete model: completing a
  // recurring task rolls its due/start forward to the next occurrence
  // rather than expanding occurrences as separate rows. See rrule.ts.
  rrule?: string
  // Convenience flag: true iff `rrule` is set.
  recurring: boolean
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
  // True when another item in the same list carries the same VTODO UID.
  // The tree keeps every such item as its own node (identity is itemUid),
  // but parent/child links — which reference VTODO UIDs — can only resolve
  // to one of them, so the nesting of the others is a best-effort guess.
  // Flagged in the UI so the ambiguity is visible and fixable.
  duplicateUid?: boolean
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

// ---- Task Blueprints ----------------------------------------------------
// A user-configured template that materialises a fresh parent task (plus a
// nested subtask tree) into a chosen task list on the days its schedule is
// active — but only ever for "today", and only on days the app is opened
// (no back-fill for missed days). Instances are ordinary VTODOs afterward;
// the blueprint only stamps identity markers so a given (blueprint, day) is
// created exactly once.
export interface BlueprintNode {
  // Stable local id — the React key in the editor AND the segment used to
  // build the deterministic per-day VTODO uid, so renaming/reordering
  // siblings never collides or re-spawns.
  key: string
  // Title template; supports the same date tokens as the parent title.
  title: string
  priority?: Priority
  children: BlueprintNode[]
}

export interface Blueprint {
  id: string
  name: string
  enabled: boolean
  // Task list (collection uid) the instances are created in.
  targetListUid: string
  // Recurrence anchor + rule, reusing the calendar/task RRULE model. An
  // empty rrule means "only on startDate" (one-shot).
  startDate: string // 'YYYY-MM-DD'
  rrule: string // e.g. 'FREQ=WEEKLY;BYDAY=MO' ('' = one-shot on startDate)
  // Parent task fields. `title` is a template with date tokens.
  title: string
  description?: string
  priority?: Priority
  categories?: string[]
  subtasks: BlueprintNode[]
  // Last local day (YYYY-MM-DD) we spawned this blueprint. Guards against
  // re-spawning the same day even if the user deleted today's instance.
  lastSpawnedKey?: string
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
  // App-specific handles / instant-messaging identifiers. Serialised as
  // RFC 6350 IMPP lines (with TYPE=service for the app), parsed from
  // both IMPP and X-SOCIALPROFILE so cards from other clients
  // round-trip. `type` carries the service name (e.g. "discord",
  // "slack", "matrix"); `value` is the handle / URI.
  messaging: VCardField[]
  addresses: VCardAddress[]
  // Raw BDAY value (e.g. "1990-05-15" or "19900515"), '' if none.
  birthday: string
  // Raw ANNIVERSARY value — same shape choices as BDAY (vCard 4.0
  // RFC 6350 §6.2.6). '' if none.
  anniversary: string
  // Optional nickname (vCard NICKNAME). The spec allows a comma-
  // separated list; in practice most cards have one, so we model it
  // as a single display string. Round-tripped verbatim either way.
  nickname: string
  // Related people (RFC 6350 §6.6.6). `type` carries the relationship
  // (spouse / parent / sibling / friend / colleague / …); `value` is
  // the linked person's name or a URI like `mailto:` / `urn:uuid:`.
  related: VCardField[]
  note: string
  categories: string[]
  // Contact photos, each a `data:` URI or http(s) URL usable as an <img>
  // src. Stored verbatim (never re-encoded). The FIRST entry is the
  // primary — rendered as the avatar; the rest are alternates the user can
  // promote in the editor. Serialized as repeating vCard PHOTO properties.
  photos: string[]
  // Normalised (lowercased) vCard KIND — 'group' for a group card
  // (KIND:group or Apple's X-ADDRESSBOOKSERVER-KIND:group), else the
  // stated kind ('individual'/'org'/'location') or undefined. Used to
  // detect group cards so they can be hidden from the person list. The
  // KIND/MEMBER lines themselves round-trip verbatim (never re-emitted).
  kind?: string
  // Parsed GEO property (RFC 6350 §6.5.2): a lat/lon pair. Undefined when
  // the card has no GEO or when the value isn't a usable `geo:lat,lon`
  // (the structural form `geo:48.85,2.35` is what we model; the older
  // `lat;lon` label form is left on the raw string). Round-tripped
  // verbatim via `raw` — the parsed field is display-only.
  geo?: { lat: number; lon: number }
  raw: string
}

export interface ContactItem {
  itemUid: string
  card: VCard
  // Last-modified timestamp from the etebase item meta (ms epoch), or
  // null when the item has no `mtime` field set (older clients didn't
  // always populate it). Used by the contacts sort dropdown for the
  // "Recently modified" axis. The contacts module also doubles this
  // as a proxy for "Recently added" — once etebase exposes a separate
  // creation timestamp, the sort can switch to that.
  mtime: number | null
}

export type TaskSort = 'priority' | 'due' | 'created' | 'summary' | 'manual'

export interface TaskSortSpec {
  sort: TaskSort
  reverse: boolean
  // Secondary tiebreaker applied when two items compare equal on the
  // primary `sort` (e.g. same priority). Always ascending; falls through
  // to created-then-title after it. Undefined behaves as 'created' (the
  // historical default). 'manual' is not offered as a secondary.
  then?: TaskSort
}

export const DEFAULT_TASK_SORT: TaskSortSpec = {
  sort: 'created',
  reverse: false,
  then: 'created',
}
