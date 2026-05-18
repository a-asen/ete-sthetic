# Plan: unified EteSync client (calendar + contacts)

Goal: extend ete-stethic from a tasks-only client into one window that also
handles **calendars (VEVENT)** and **contacts (vCard)** — the original
motivation (one nice client instead of juggling Thunderbird/web per data type).

This doc is an overview + a thorough evaluation of *how* to build it. TL;DR
recommendation is at the bottom of the "Evaluation" section.

---

## 1. What we already have working for us

EteSync stores everything as opaque, end-to-end-encrypted **collections** of
**items**. The plumbing we built for tasks is almost entirely data-type-agnostic:

| Layer | File | Reusable as-is? |
|---|---|---|
| Auth / session | `services/etebase.ts`, `services/store.ts` | ✅ Fully. |
| Collection handles + item cache | `services/etebase.ts` | ✅ Keyed by uid, type-agnostic. |
| Incremental sync (stoken) + snapshots | `services/snapshots.ts` | ✅ Keyed by collection uid; no VTODO assumptions. |
| Optimistic-mutation + rollback pattern | `MainView.tsx` | ✅ Pattern, not code — copy the shape. |
| Keyboard-first nav, focus rings, popovers, modals | `components/*` | ✅ Strong asset; carry across modules. |

**The one hard coupling:** `etebase.ts` hardcodes
`TASK_COLLECTION_TYPE = 'etebase.vtodo'`. Calendars are `etebase.vevent`,
contacts `etebase.vcard`. `listCollections` calls `cm.list(TASK_COLLECTION_TYPE)`.

## 2. The two modules are NOT equal in cost

### Calendar (VEVENT) — medium, mostly a UI lift
- **Parsing is nearly free.** `ical.js` is already a dependency and parses
  VEVENT with the same `ICAL.Component` shape `parseVTodo` uses. A `parseVEvent`
  is a near-copy of `parseVTodo`.
- **Real work is the calendar itself**, not the data:
  - **Recurrence (`RRULE`/`RDATE`/`EXDATE`).** ical.js ships
    `ICAL.Event` + `ICAL.RecurExpansion` — expansion is solved; the design
    question is *windowing* (expand only the visible range, cache, re-expand on
    navigation) and editing semantics (this / this-and-future / all).
  - **Time zones (`VTIMEZONE`, `TZID`).** ical.js has `ICAL.Timezone` +
    a tz registry. Tasks dodged this by forcing date-only DUE; calendar can't.
  - **Grid UI.** Month/week/day views with overlap layout — net-new component
    work; the task `focusZone` model doesn't transfer (calendar wants 2-D grid
    navigation).

### Contacts (vCard) — larger, a new format
- **`ical.js` does NOT parse vCard.** vCard is RFC 6350, a different grammar.
  Options evaluated below.
- vCard 3.0 (`urn:ietf:params:jscontact`-era clients) vs 4.0 differences,
  structured `N`/`ADR`, `PHOTO` (base64 or URI), multi-valued `TEL`/`EMAIL`
  with TYPE params. More fiddly than VEVENT, less algorithmically hard than
  recurrence.
- UI is a list + search + a contact card — closer to the existing
  sidebar/detail shape than calendar is.

#### vCard library options

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `vcard4` | RFC 6350 (v4) correct, typed | v4-focused; many servers emit v3 | Viable if we normalize v3→v4 on read |
| `vcf` | Handles v3 + v4, simple API | Looser spec fidelity, less maintained | Good pragmatic default |
| `ical.js` | Already in tree | **Does not do vCard** | ✗ |
| Hand-roll | Zero deps, full control | vCard line-folding/escaping/structured values are a tar pit | ✗ unless scope shrinks to read-only display |

Recommendation: start with **`vcf`** for read + simple edits; revisit if we
hit fidelity bugs against the user's real data.

## 3. Architecture decision: module shell, not a bigger MainView

`MainView.tsx` is already ~2k lines and task-shaped (its `focusZone` is
`'sidebar' | 'tasks' | 'details'`). Three evaluated paths:

| Path | Description | Pros | Cons |
|---|---|---|---|
| **A. Incremental + thin refactor** *(recommended)* | Extract a generic collection/sync core from `etebase.ts`; add a top-level **module switcher** (Tasks / Calendar / Contacts); each module is its own `*View` reusing the core + shared UI primitives. | Ships value per-module; low blast radius; tasks keep working throughout; matches how the data layer is already factored. | Some upfront refactor of `etebase.ts`'s hardcoded type. |
| B. Generic "everything" view | One mega-component parameterized by collection type. | DRY in theory. | `MainView` is already strained; calendar's grid + contacts' card don't share a layout with the tree. High risk, hard to test. |
| C. Separate apps | Three Tauri apps. | Total isolation. | Defeats the "one window" goal entirely. ✗ |

### Path A, concretely

1. **Generalize the data core (prerequisite, also unblocks list create/rename
   in `TODO.md`).**
   - `listCollections(type)` / `createCollection(type, …)` take a collection
     type instead of the hardcoded constant. Internals (`getCollection`,
     `getItem`, snapshots) are already type-agnostic.
   - Introduce `ColType = 'etebase.vtodo' | 'etebase.vevent' | 'etebase.vcard'`.
2. **Top-level module switcher.** A slim chrome above the sidebar
   (Tasks / Calendar / Contacts), keyboard-switchable (e.g. `g t` / `g c` /
   `g k`, consistent with the existing keyboard discipline). App state machine
   gains a `module` axis above the current per-module state.
3. **Calendar module** (do this *before* contacts — lower risk, reuses ical.js):
   - `services/vevent.ts` (mirror `vtodo.ts`), `services/recurrence.ts`
     (windowed expansion + cache), `CalendarView.tsx` (month/week/day).
   - Start read-only, then add create/edit (non-recurring first, recurrence
     editing last — it's the riskiest UX).
4. **Contacts module:**
   - Add `vcf`. `services/vcard.ts` (parse/serialize, v3→normalized model),
     `ContactsView.tsx` (list + search + card). Read → simple-field edit →
     structured fields (`ADR`, `PHOTO`) last.
5. **Cross-cutting niceties:** `CONTACT` on a task and `ATTENDEE` linking can
   reference the contacts module once it exists (see task-options worksheet).

## 4. Suggested sequencing & rough effort

| Phase | Scope | Effort | Risk |
|---|---|---|---|
| 0 | Generalize `etebase.ts` collection type; also delivers list create/rename | S | Low |
| 1 | Module switcher + app state refactor | S–M | Low |
| 2 | Calendar read-only (parse + month/week/day, no recurrence edit) | M | Med (tz, layout) |
| 3 | Calendar create/edit non-recurring | M | Med |
| 4 | Recurrence: display expansion, then edit (this/future/all) | L | **High** |
| 5 | Contacts read-only (vcf, list + card) | M | Med (vCard fidelity) |
| 6 | Contacts edit (simple → structured fields) | M | Med |

Phases 0–2 are the high-value, low-risk core and prove the architecture before
committing to recurrence (the genuine hard part).

## 5. Open questions for you

- Priority order: **calendar first** (recommended — lower risk, reuses ical.js)
  or contacts first?
- Recurrence editing scope — is read-only expansion of recurring events
  acceptable for v1, deferring "edit this/future/all"?
- Are your contacts vCard **3.0 or 4.0** (affects library choice / normalization)?
- Notifications/reminders (`VALARM`) — in scope for calendar v1, or later with
  the task-reminder work?

## 6. Bottom line

**Recommended path: A (incremental + thin refactor), calendar before contacts.**
The data/sync layer already generalizes cheaply; the real cost is UI
(calendar grid) and one genuinely hard problem (recurrence editing), which Path
A lets us defer behind shippable milestones. Contacts is a separate-format add
gated on a vCard lib choice (`vcf`), best done after calendar proves the shell.
