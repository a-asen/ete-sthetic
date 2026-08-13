# Task item options — coverage worksheet

This is the full picture of what a VTODO *can* carry (RFC 5545 §3.6.2) vs. what
ete-sthetic does with it today. Use the **Want?** / **Notes** columns to mark
what's worth building — that's the input I'll turn into TODO items.

Legend:
- **Parsed** — read into the `VTodo` model (`src/types.ts`) by `parseVTodo`
  (`src/services/vtodo.ts`).
- **Editable** — changeable from the UI via `VTodoPatch` / `updateVTodo` +
  `DetailPanel.tsx`.
- **Round-trips** — even if we never touch it, `updateVTodo` rebuilds the whole
  component, so any property not explicitly handled is **preserved** as long as
  ical.js can re-serialize it (X- props, ATTACH, etc. survive edits).

## Currently supported

| Property | In model | Parsed | Editable | Notes |
|---|---|---|---|---|
| `UID` | `uid` | ✅ | — | Identity; never user-edited. |
| `SUMMARY` | `summary` | ✅ | ✅ | Title. |
| `DESCRIPTION` | `description` | ✅ | ✅ | Free text; clearable. |
| `STATUS` | `status` | ✅ | ✅ | NEEDS-ACTION / IN-PROCESS / COMPLETED / CANCELLED. |
| `PRIORITY` | `priority` | ✅ | ✅ | 0 = none (1 highest … 9 lowest). |
| `DUE` | `due` | ✅ | ⚠️ | **Date-only.** UI forces `YYYYMMDD`; time-of-day due is dropped on edit. |
| `CATEGORIES` | `categories` | ✅ | ✅ | Tags; full-list replace. |
| `RELATED-TO;RELTYPE=PARENT` | `parentUid` | ✅ | ✅ | Drives the tree. SIBLING/CHILD reltypes are preserved but ignored. |
| `CREATED` | `created` | ✅ | — | Used for sort; set on create. |
| `LAST-MODIFIED` | `lastModified` | ✅ | auto | Bumped on every edit. |
| `DTSTAMP` | — | — | auto | Bumped on every edit; not modeled. |
| `COMPLETED` | — | — | auto | Set when status→COMPLETED, cleared otherwise. Not shown. |
| `PERCENT-COMPLETE` | — | — | auto | Forced to 100 on complete; no partial-progress UI. |

## Not supported (gaps)

`Want?` legend: ✅ yes (worth scheduling), ◑ later (clearly useful but
not next), ⊘ skip (no clear payoff for this project). Recommendations
are mine — flip any one if you disagree.

| Property | What it's for | Effort | Want? | Notes |
|---|---|---|---|---|
| `DTSTART` | Start date/time — enables "starts vs due" and date ranges | Low | ✅ | Wedge win. `DetailPanel` already has a Start field (uses the same `CalendarPopover` Due does), so this is mostly wiring `dtstart` through `parseVTodo` / `buildPatch`. Lets you defer a task ("not actionable until Mon") instead of just "due Mon." |
| `DUE` w/ time | Time-of-day deadlines, not just a day | Low–Med | ✅ | Wedge win. `CalendarPopover` already commits `YYYY-MM-DD`; pair it with a time field (like the calendar composer) and stop forcing date-only on write. Treat tz the way the calendar module already does (floating local, mirror VEVENT defaults). |
| `PERCENT-COMPLETE` (manual) | Partial progress slider (0–100) | Low | ⊘ | Status (NEEDS-ACTION / IN-PROCESS / COMPLETED) already covers the practical states; a manual % almost never gets updated in personal task lists and adds a noisy field to the row. Reconsider only if someone actually asks. |
| `RRULE` / `RDATE` / `EXDATE` | **Recurring tasks** | High | ✅ | Phase it like the calendar shipped RRULE: preset dropdown (Daily / Weekly / Monthly / Yearly / Custom-preserved), no per-occurrence detach in v1. Calendar's `detectPreset` + ICAL.Recur.fromString round-trip is reusable. Defer EXDATE editor — round-trip is enough until a real dismissed-occurrence case shows up. |
| `VALARM` | **Reminders / notifications** | High | ◑ | Worth doing once Tauri's notification plumbing lands (it doesn't yet). Until then a VALARM in the model would be visible in the UI but silent at the OS level — false-promise UX. Round-trip preservation is fine until then. |
| `DURATION` | Duration instead of explicit DUE | Low | ⊘ | RFC says DUE / DURATION are mutually exclusive; tasks almost always want DUE. Round-trip is enough. |
| `LOCATION` | Where the task happens | Low | ⊘ | Tasks rarely "happen somewhere" the way events do. Skip unless someone asks. |
| `GEO` | Lat/long | Low | ⊘ | Follows LOCATION; skip. |
| `URL` | Link to a related resource | Low | ✅ | Wedge win. One-line input in DetailPanel, render as a clickable link in view mode. Common ask ("link to the PR / ticket / doc"). |
| `ATTACH` | Attachments / linked files | Med–High | ◑ | Needs a file picker + decisions on whether to inline-encode (bloats etebase items) vs link to a path (breaks across devices). Round-trip is fine; build only when there's a concrete ask. |
| `CLASS` | PUBLIC / PRIVATE / CONFIDENTIAL | Low | ⊘ | Etebase items are already private to the account; CLASS adds UX without a real-world distinction here. |
| `COMMENT` | Annotations distinct from DESCRIPTION | Low | ⊘ | DESCRIPTION already covers this. A separate COMMENT field invites the "which one do I write in" confusion. |
| `RESOURCES` | Required resources/people | Low | ⊘ | Meaningless in a single-user setup. |
| `ATTENDEE` / `ORGANIZER` | Assignment / shared tasks | Med | ◑ | Etebase shares whole collections, not items, so per-task assignment doesn't map cleanly. Revisit if multi-user task collections become a real use case. |
| `CONTACT` | Linked contact | Low | ✅ | Now that the contacts module is shipped, this becomes meaningful — "task X for contact Y" with a click-through into the contact card. Picker can be a small typeahead over the contact cache. Cheap and unblocks "follow up with N" workflows. |
| `RELATED-TO` SIBLING/CHILD | Non-parent links (dependencies) | Med | ◑ | The parent-child reltype already drives the tree (see [TODO.md](../TODO.md) "Moving a parent carries its children"). A real "blocks / depends-on" graph would need a new UI; do it when someone asks. |
| `SEQUENCE` | Revision counter for conflict detection | Low | ◑ | Worth it the day we build a sync-conflict UI; until then etebase's collection-level merge is what matters, and SEQUENCE round-trips without us touching it. |
| `X-*` custom props | Third-party extensions | n/a | ✅ | Already preserved on round-trip — keep it that way and don't regress when adding fields above. |

## Recommended next batch

If you want a concrete "ship this next" list out of the above, the four
**✅ low-effort** items are the cheapest payoff:

1. **`DTSTART`** — wire `dtstart` through `parseVTodo` / `buildPatch`;
   reuse the Start field already in DetailPanel.
2. **`URL`** — one-line input in DetailPanel; render as a link in view
   mode. Smallest possible task, common ask.
3. **`DUE` w/ time** — promote the existing date input to date+time,
   stop dropping time-of-day on write.
4. **`CONTACT`** — small contact-typeahead picker in DetailPanel,
   click-through to the contact card.

`RRULE` is the obvious **bigger** next step — high payoff but a full
composer surface; do it after the four above land so the wedge stuff
isn't blocked behind it. The calendar module's preset-RRULE work is
a usable template.

## Your call

Add anything below — themes, must-haves, explicit "skip forever":

>
>
>

