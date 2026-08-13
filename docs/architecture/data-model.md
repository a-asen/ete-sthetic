# Data model

All shared types live in [`src/types.ts`](https://github.com/a-asen/ete-sthetic/blob/main/src/types.ts).
Each EteSync content type is parsed into a friendly interface (`VTodo`,
`VEvent`, `VCard`) that the UI works with, while the **`raw`** field on each
keeps the original iCalendar/vCard text so unmodelled data round-trips
untouched.

A recurring pattern across all three: an **`itemUid`** (the Etebase item
identity) wraps the parsed payload, because the payload's own `UID` is not
guaranteed unique within a collection.

```ts
interface TaskItem    { itemUid: string; todo: VTodo }
interface EventItem   { itemUid: string; event: VEvent; occId?: string }
interface ContactItem { itemUid: string; card: VCard; mtime: number | null }
```

## Collections

```ts
type ColType = 'etebase.vtodo' | 'etebase.vevent' | 'etebase.vcard'

interface CollectionInfo {
  uid: string
  name: string
  description?: string
  color?: string
  isDeleted?: boolean  // server-side tombstone, only when explicitly requested
}
```

## VTODO {#vtodo}

`VTodo` models a task. Highlights:

- **Hierarchy** — `parentUid` drives the tree; other `RELATED-TO` links are
  kept in `relatedTo` (`RelatedLink[]`, e.g. `CHILD`, `SIBLING`, RFC 9253
  dependency types).
- **Status & progress** — `status` (`NEEDS-ACTION` / `COMPLETED` /
  `IN-PROCESS` / `CANCELLED`), `priority` (`0–9`), `percentComplete` (`0–100`,
  independent of status).
- **Dates** — `due`, `dtStart`, `created`, `completed`, `lastModified` as raw
  iCal strings.
- **Manual order** — `sortOrder` from `X-APPLE-SORT-ORDER`, so a hand-arranged
  order syncs across clients.
- **Recurrence** — `rrule` (verbatim, no `RRULE:` prefix) with a
  regenerate-on-complete model; `recurring` is a convenience flag.
- **Recovery** — `broken: true` marks an item whose source couldn't be parsed;
  `raw` holds the original for the [raw editor](/guide/tasks#raw-ical-editor).

The tree wraps items as `TaskNode` (adds `children`, `depth`, and a
`duplicateUid` flag).

## VEVENT {#vevent}

`VEvent` models a calendar event: `summary`, `description`, `location`,
`dtStart`/`dtEnd` (raw), an `allDay` flag, resolved `start`/`end` JS `Date`s
(end exclusive per RFC 5545), `categories`, `rrule` + `recurring`, and
`alarms`.

`VAlarm` reduces a `VALARM` trigger to what the scheduler needs — a **relative**
offset (`relSeconds` from `start`/`end`) or an **absolute** instant (`at`).
`DISPLAY`/`AUDIO` fire OS notifications; `EMAIL` is kept but never fires.

`EventItem.occId` gives expanded recurrence instances a per-occurrence
identity for React keys, while edit/delete still act on the shared base
`itemUid`.

## vCard {#vcard}

`VCard` is the richest type. It models `fn`, structured `name` (`VCardName`),
`org`, `title`, typed `emails`/`phones`/`urls` (`VCardField`),
`messaging` (IMPP / X-SOCIALPROFILE), structured `addresses` (`VCardAddress`),
`birthday`, `anniversary`, `nickname`, `related`, `note`, `categories`,
`photos` (verbatim `data:`/URL, first = primary avatar), and normalised
`kind` (so group cards can be hidden).

Everything the parser doesn't model round-trips through `raw`. `ContactItem`
adds `mtime` (item last-modified, ms epoch) for the "recently modified" sort.

## Sorting

```ts
type TaskSort = 'priority' | 'due' | 'created' | 'summary' | 'manual'

interface TaskSortSpec {
  sort: TaskSort
  reverse: boolean
  then?: TaskSort   // secondary tiebreaker; falls through to created-then-title
}
```

Defaults to `{ sort: 'created', reverse: false, then: 'created' }`. The
comparators live in [`services/sort.ts`](/architecture/services).

## Related

- [Services layer](/architecture/services) — the parsers that produce these
  types
- [Tasks](/guide/tasks) · [Calendar](/guide/calendar) · [Contacts](/guide/contacts)
