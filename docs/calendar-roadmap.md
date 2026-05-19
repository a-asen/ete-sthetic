# Calendar roadmap (post phase A–E)

Follow-on plan for the calendar module once the initial five phases shipped
on `worktree-calendar` (view modes, sidebar, instant-load/in-memory cache,
click-to-add, edit + whole-item conflict prompt). Companion to
`calendar-contacts-plan.md`; that doc set the architecture, this one
prioritizes what's "nice and relevant" to add next.

**Chosen order (decided 2026-05-18): polish first, then recurrence, then
the unified-client task overlay, then editing depth + timezones.**

---

## Status baseline

Working today: day/3-day/week/month/year views, sidebar mini-month +
per-calendar show/hide, JSON-snapshot instant load + process-lifetime
in-memory retention, click-to-add, click-to-edit/delete, save-time
whole-item sync-conflict prompt.

Intentionally deferred so far: recurrence expansion (events show once at
base DTSTART, flagged `↻`), timezones (floating local time), field-level
conflict merge.

## Tiers

### Big rocks — correctness

| # | Item | Why | Effort | Risk | Touches |
|---|---|---|---|---|---|
| R1 | Recurrence display expansion (RRULE/RDATE/EXDATE), windowed over the visible range + cached | Recurring events are most real events; biggest fidelity gap. ical.js ships `ICAL.Event` + `RecurExpansion`. Display-only first; editing is E3. | L | M–H | new `services/recurrence.ts`, `caldate.bucketByDay`, `CalendarView` range memo |
| R2 | Timezones (VTIMEZONE / TZID) | Events authored in other clients with TZID currently render at wrong wall-clock. | M | M | `vevent.ts` parse/build, `caldate` |

### Tier 1 — high-value, low-risk polish (do first)

| # | Item | Note | Effort |
|---|---|---|---|
| P1 | Current-time line + auto-scroll in day/week | `TimeGrid` already has `HOUR_PX`; absolutely-positioned line + `scrollIntoView` | S |
| P2 | Multi-day / all-day as spanning bars (week/month) | Today they render as per-day chips | M |
| P3 | Keyboard nav & shortcuts (`1–5` views, `n` new, `t` today, `←/→` step, arrows move selection, `Esc`) | App is keyboard-first (`KeybindingsModal`); calendar has none | M |
| P4 | Event quick-popover (click → popover; Edit → full modal) | Lighter than always opening the modal | M |
| P5 | Month "+N more" expansion + go-to-date jump | Month overflow currently truncates silently | S |

### Tier 2 — editing depth

| # | Item | Effort | Risk |
|---|---|---|---|
| E1 | Drag to create / move / resize in time grid | L | M |
| E2 | Move event between calendars in the editor (select is locked now) | S | Low |
| E3 | Recurrence editing: this / this-and-future / all — depends on R1 | L | H |
| E4 | Background-sync conflict (offline-edit queue + reconcile); optional field-level merge | M–L | M |

### Tier 3 — unified-client integration (strong product fit)

| # | Item | Why | Effort |
|---|---|---|---|
| U1 | Overlay tasks-with-due-dates on the calendar (read-only → quick-complete) | The project's whole reason for existing ("one window"). `vtodo.ts` already parses `due`/`dtStart`; `listTaskItems` exists. High differentiation, low risk. | M |
| U2 | VALARM reminders → Tauri OS notifications | A trusted calendar needs reminders | M |
| U3 | ICS import / export | Interop / backup | M |

## Sequence

1. **Tier 1: P1 → P3 → P2 → P4 → P5.** Fast visible improvement, low
   risk, tiny merge surface against concurrent task work.
2. **R1 recurrence expansion.** Headline correctness fix. Do before E1/E3
   since both interact with occurrence identity.
3. **U1 task overlay.** Biggest product win for this app; reuses existing
   task code.
4. **Tier 2 editing depth + R2 timezones.** Once the data model is solid.

## Status (2026-05-19)

Done on `worktree-calendar` (not yet merged to main): **Tier 1 P1–P5**,
**R1**, **Tier 2 E1/E2/E3/E4**, **R2**, **U1**.

- **U2 (VALARM reminders)** and **U3 (ICS import/export)** are
  **deferred until after the merge**. Both need Tauri native config
  (`plugin-notification` / `plugin-dialog`/`plugin-fs`) — `package.json`
  + `src-tauri/` capabilities/permissions, which is the task worker's
  territory. Doing them post-merge keeps native-config changes
  coordinated in one place and preserves the zero-merge-risk discipline
  everything else has held to.

## Notes / constraints

- Keep shared-file edits (`etebase.ts`, `types.ts`, `vtodo.ts`)
  additive/append-only — the task worker is concurrently on `main`.
- Recurrence (R1) is the one genuinely hard problem; gate it behind
  shippable polish so value lands continuously.
- U1 should treat tasks as a read-only overlay first; mutating tasks from
  the calendar reuses `updateTask`/`toggleComplete`, no new sync model.
