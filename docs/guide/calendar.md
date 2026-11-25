# Calendar

The calendar module (`CalendarView`) renders your VEVENT collections across
four zoom levels and handles the awkward parts of iCalendar — recurrence,
alarms, and conflicting edits.

## Views

| View  | Shows                                             |
| ----- | ------------------------------------------------- |
| Month | A month grid (`MonthGrid`) with event chips       |
| Week  | A time grid (`TimeGrid`) for the week             |
| Day   | The same time grid scoped to a single day         |
| Year  | A compact year overview (`YearGrid`)              |

The **calendar sidebar** (`CalendarSidebar`) lists your calendars and lets you
toggle visibility per calendar.

## Creating & editing events

- **Event composer** (`EventComposer`) — create or edit an event: title,
  times, all-day toggle, location, description, calendar, recurrence, and
  alarms.
- **Day popover** (`DayPopover`) — a quick look at everything on a given day.
- **Event popover** (`EventPopover`) — details and quick actions for a single
  event.

Arrow-key modifiers in the composer let you nudge times from the keyboard.

## Timezones

Timed events carry a **Timezone** field in the composer (type-ahead IANA
names like `Asia/Tokyo`; empty = floating local time, stored without a
zone). This is how you set travel times correctly: a flight leaving
Tokyo at 14:30 keeps `DTSTART;TZID=Asia/Tokyo` — the grid shows it
converted to your display zone, and the event popover appends the origin
zone in parentheses.

The zone fields take more than canonical names — the suggestion list
mixes, side by side: broad names (`Pacific Time`, `Central European
Time`), abbreviations (`PST`, `CET`, `JST`), cities that have no zone of
their own (`Seattle`, `Tromsø`, `Bangalore`) and fixed offsets
(`UTC+02:00`), each with its current offset (and abbreviation when
known). Selecting a row stores the canonical IANA zone.

A journey can **end in a different zone than it starts**: set **End
timezone** (empty = same as start) and the landing time is entered as
wall clock there — `DTSTART;TZID=Asia/Tokyo` +
`DTEND;TZID=Europe/Oslo`. The popover notes it as
"(Asia/Tokyo → Europe/Oslo)". Drags move the absolute instants and
leave both zones alone; a DTEND that merely mirrors the start's zone
follows start-zone changes, an explicit end zone does not.

- **Per-event zones** are stored as proper iCalendar `TZID` +
  `VTIMEZONE` pairs, so other clients (and other devices) see the same
  absolute instants. Events you edit in place keep their zone; dragging
  moves the absolute instant.
- **Display timezone** (Settings › Timezone) re-projects the whole grid
  — day buckets, labels, the now-line — into any zone, e.g. keep the
  calendar on home time while travelling. It's a local view setting and
  never touches stored data. Leave it empty to follow the system zone.
- Floating events (no zone) keep their wall time in every display zone —
  a 09:00 home event reads 09:00 wherever you view it from.
- Foreign events that reference an IANA zone without an embedded
  `VTIMEZONE` are resolved via a synthesized zone definition
  ([`services/vtimezone.ts`](/architecture/services)), so imports place
  correctly too.

## Recurrence

Recurring events use standard `RRULE` expansion — occurrences are computed
from the rule (see [`services/recurrence.ts`](/architecture/services)). When
you edit a recurring event, ete-sthetic asks for the **scope** via the
recurrence scope modal:

- **This event** — split off a single overridden occurrence.
- **This and following** — change from here forward.
- **All events** — change the whole series.

The scope-aware edit logic lives in
[`services/recurrence-edit.ts`](/architecture/services).

## Alarms

`VALARM` triggers are reduced to what the in-app scheduler needs and fire as
**desktop notifications** via the Tauri notification plugin
([`services/alarms.ts`](/architecture/services)):

- **Relative** triggers fire a signed offset before/after `DTSTART` or
  `DTEND`.
- **Absolute** triggers fire at a fixed instant.
- `DISPLAY` and `AUDIO` actions notify; `EMAIL` alarms are preserved but never
  fire (there is no mail transport).

The composer's **Reminders** section adds and removes reminders on any event,
recurring or not: pick a preset offset (at start, 5/10/15/30 min, 1/2 h, 1
day, 1 week before) or `Custom…` for any other offset, with several reminders
per event. A reminder is written as a start-relative `DISPLAY` VALARM so it
syncs to other clients (Tasks.org, DAVx5, …). Saving always rewrites the
alarms from the rows, so a drag-resize or field edit keeps them. Imported
alarms the editor can't express (absolute, `RELATED=END`, `EMAIL`) are hidden
from the list but carried through unchanged rather than dropped. When you
split a recurring series (edit/delete *this* or *this-and-following*), the
new detached event / series inherits the original's alarms.

## Conflict resolution

If an event changes on the server while you're editing it, the **conflict
modal** (`ConflictModal`) surfaces the divergence so you can resolve it
deliberately instead of silently clobbering the remote copy.

## Importing events

ete-sthetic can bring events in from `.ics` sources:

- **Import `.ics`** (`ImportIcsModal`) — import events from a file. `.ics`
  files can also be opened with the app directly.
- **Paste `.ics`** (`PasteIcsModal`) — paste raw iCalendar text.
- **ICS subscriptions** — subscribe to a remote read-only `.ics` URL
  (`services/icsSubscriptions.ts`). Subscribed calendars are cached
  (`icsSubscriptionSnapshot.ts`) and refreshed in the background; their events
  render alongside your own.

## Overlays

Two derived layers can appear on the calendar without living in an EteSync
collection:

- **Birthdays** — `BDAY` values from your [contacts](/guide/contacts) are
  projected onto the calendar (`services/birthdays.ts`).
- **Weather** — an experimental weather layer (`services/weather.ts`). This is
  still evolving; treat it as a preview.

## Related

- [Data model › VEVENT](/architecture/data-model#vevent)
- [Contacts](/guide/contacts) — source of birthday overlays
- [Keybindings](/reference/keybindings)
