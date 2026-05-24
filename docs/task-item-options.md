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

| Property | What it's for | Effort | Want? | Notes (you write) |
|---|---|---|---|---|
| `DTSTART` | Start date/time — enables "starts vs due" and date ranges | Low | | |
| `DUE` w/ time | Time-of-day deadlines, not just a day | Low–Med | | needs datetime + tz handling |
| `PERCENT-COMPLETE` (manual) | Partial progress slider (0–100) | Low | | |
| `RRULE` / `RDATE` / `EXDATE` | **Recurring tasks** | High | | ical.js can expand; big UX surface |
| `VALARM` | **Reminders / notifications** | High | | needs OS notification plumbing (Tauri) |
| `DURATION` | Duration instead of explicit DUE | Low | | mutually exclusive with DUE |
| `LOCATION` | Where the task happens | Low | | |
| `GEO` | Lat/long | Low | | usually paired with LOCATION |
| `URL` | Link to a related resource | Low | | quick win for the detail panel |
| `ATTACH` | Attachments / linked files | Med–High | | currently round-trips but invisible |
| `CLASS` | PUBLIC / PRIVATE / CONFIDENTIAL | Low | | |
| `COMMENT` | Annotations distinct from DESCRIPTION | Low | | |
| `RESOURCES` | Required resources/people | Low | | |
| `ATTENDEE` / `ORGANIZER` | Assignment / shared tasks | Med | | only meaningful with multi-user lists |
| `CONTACT` | Linked contact | Low | | ties into the contacts module (see plan) |
| `RELATED-TO` SIBLING/CHILD | Non-parent links (dependencies) | Med | | preserved today, not surfaced |
| `SEQUENCE` | Revision counter for conflict detection | Low | | useful for sync-conflict UX later |
| `X-*` custom props | Third-party extensions | n/a | | already preserved on round-trip |

## Your call

Add anything below — themes, must-haves, explicit "skip forever":

>
>
>
