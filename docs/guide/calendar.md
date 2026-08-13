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
