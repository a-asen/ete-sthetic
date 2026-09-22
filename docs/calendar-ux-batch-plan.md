# Calendar UX batch — implementation plan

Eight queued calendar items (TODO.md "Items"), ordered from small/
self-contained to larger, grouped by the files they touch so they can
land as independent commits. Each item: what the user sees today →
what to change → concrete steps with file:line anchors from a code
reconnaissance pass.

Suggested order (commit boundaries):

1. `fix(composer): Enter toggles ALL DAY` (item 5)
2. `fix(composer): calendar picker scroll follows highlight` (item 6)
3. `fix(calendar): Shift+arrow moves selected day with the page` (item 13/shift)
4. `fix(calendar): drag preview follows the real drop past midnight` (item 16)
5. `feat(calendar): stronger event colour markings in week view` (item 11)
6. `fix(theme): soften whole-app tinting sensitivity to accent` (item 12)
7. `feat(calendar): duplicate event to another calendar` (item 10)
8. `feat(calendar): drag-resize all-day events` (item 9)

---

## 1. Enter on the ALL DAY checkbox should check it

**Today:** the All day checkbox (`EventComposer.tsx:503-510`) is a
native checkbox — Enter does nothing while it's focused (only Space
toggles). There's no `<form>`, so the browser's implicit submit never
fires, and the composer's global handler (`EventComposer.tsx:287-312`)
only maps Ctrl/Cmd+Enter → submit.

**Change:** pressing Enter with the checkbox focused toggles it, like
Space does.

**Steps:**
- Add `onKeyDown` on the checkbox input: if `e.key === 'Enter'`,
  `e.preventDefault()` (stops any bubbling) and
  `setAllDay(!allDay)`.
- Keep Ctrl/Cmd+Enter → submit working: the global handler checks
  `e.ctrlKey || e.metaKey` first, and the field-level handler bails on
  modified Enters (`if (e.ctrlKey || e.metaKey) return`) so the two
  don't fight.
- Also guard against the date-picker popover being open
  (`EventComposer.tsx:294-296` pattern) — Enter is owned by the popover
  when one is open; the checkbox won't be focused then, so a plain
  check is enough.

**Test:** focus ALL DAY, press Enter → checked; press again →
unchecked; Ctrl+Enter anywhere still submits; the time inputs
appear/disappear in step.

---

## 2. Calendar picker scroll should follow the highlighter

**Today:** `CalendarSelect` (`EventComposer.tsx:1001-1152`) keeps an
`activeIdx` highlight moved by ↑/↓, but the `<ul role="listbox"
className="max-h-48 overflow-y-auto">` never scrolls — with many
calendars, the highlight runs off the visible area.

**Change:** the highlighted option stays in view, like the app's other
pickers.

**Steps:**
- Keep a ref array (`itemRefs`) or query by an
  `data-idx={i}` attribute on each option button.
- `useEffect` on `[activeIdx, q, open]`: scroll the active option into
  view — `el.scrollIntoView({ block: 'nearest' })`, the established
  pattern (GlobalSearchModal.tsx:130, MetaSearchModal.tsx:87,
  MoveTaskPicker.tsx:127).
- Include `q` (filter changes reset `activeIdx` to 0,
  `EventComposer.tsx:1031`) and `open` in the deps so re-opening the
  popup with a fresh filter also recentres.

**Test:** enough calendars to overflow 12rem; hold ↓ — the list scrolls
with the highlight; prefix-typing a deep calendar's name jumps there
and shows it.

---

## 3. Shift+←/→ should move the selected day to the next week

**Today:** Shift+arrow pages the *view* by a whole week
(`CalendarView.tsx:2230-2233` → `stepAnchor`, caldate.ts:85-98) but
leaves `selected` (the keyboard-cursor day, highlighted with a ring on
the day-header, TimeGrid.tsx:485-489) where it was — so the highlight
"doesn't follow the movement", and a subsequent plain ←/→ (which moves
`selected` by one day and pages only to keep it visible,
`CalendarView.tsx:2235-2250`) yanks you back to the old week.

**Change:** Shift+←/→ moves the *selected day* by the page step (a
week in week view, 3 days in 3-day view, a month in month view), with
the view following. Same for Shift+↑/↓ (±7 days) for consistency with
the existing arrow map (`CalendarView.tsx:2220-2226`).

**Steps:**
- In the Shift branch (`CalendarView.tsx:2230-2233`), replace the
  anchor-only step with: compute `next = stepDate(view, selected,
  dir)` — move `selected` by the view's natural unit (day ±1,
  3day ±3, week ±7, month ±1 month, year ±1 year — reuse the
  step-size logic from `stepAnchor`, or factor a shared
  `stepSizeFor(view)` into caldate.ts), then
  `setSelected(next)` + `setAnchor(next)` (anchoring on the stepped
  day lands the new week with the highlighted day in the same
  column/slot, matching what the user expects).
- Plain arrows keep their current behaviour (move by 1 day, page only
  when leaving the visible range) — unchanged.
- Toolbar ‹/› buttons (`CalendarView.tsx:1971-1974`) should get the
  same treatment: they currently step the anchor only; move `selected`
  along so the ring follows the page. This makes toolbar paging and
  Shift+arrow consistent.

**Watch:** `pickDay`/`goToday`/year-picker flows already set both
`selected` and `anchor` — follow the same convention.

**Test:** in week view, Shift+→ → the view pages one week AND the
highlighted day is the same weekday in the new week; plain ← after that
moves within the new week, no jump back.

---

## 4. Extended day view: show the real drop position past midnight

**Today:** with a day window whose `endH` exceeds 24 (the past-midnight
extension band, `CalendarView.tsx:149-159`, `extendH` at 1878), dragging
an event past midnight *commits* to the next day (the move commit
clamps to the full extended span, `TimeGrid.tsx:402-421`) but the
*drag ghost* clamps to a hard 24:00 (`TimeGrid.tsx:1141-1149` —
`Math.min(…, 24 * 60 - d.durMin)`). So the hover appears stuck at
00:00 while the drop actually lands on the next day — the reported
"cannot see that it moved".

**Change:** the ghost renders where the drop will land — into the
extension band, crossing the dashed midnight rule.

**Steps:**
- In the ghost math (`TimeGrid.tsx:1134-1157`, move branch), replace
  the `24 * 60 - drag.durMin` clamp with the same clamp the commit
  uses: `const totalMin = totalH * 60;
  Math.min(newStart, Math.max(0, totalMin - drag.durMin))` (and keep
  the `Math.max(0, …)` floor).
- The ghost's `top`/`height` positioning uses column-local minutes
  already (per-day loop, same coordinate space as the committed
  `base + clamped*60000` math), so minutes > 24*60 position it inside
  the extension band — the band is part of the same column height
  (`totalH = 24 + extendH`, TimeGrid.tsx:206).
- Ghost label: `hhmm(a)–hhmm(b)` must format minutes past 24:00 as
  next-day times (e.g. `01:30`, not `25:30`). If `hhmm` doesn't already
  wrap (`TimeGrid.tsx:24-36` area), wrap: `min % (24*60)` for the
  display, optionally with a `+1d` suffix like the hour gutter
  (TimeGrid.tsx:858-866) to disambiguate. Match whatever the borrowed
  next-day events show (they render dimmed in the band,
  TimeGrid.tsx:888-897).
- Resize ghost (if separate branch, `TimeGrid.tsx:1134-1157` resize
  case) — check the same clamp applies so resizing past midnight
  previews correctly too.

**Test:** day window 06:00–26:00; drag a 1h event from 23:30 across
the dashed line — ghost follows to 00:30 in the band, label reads
`00:00–01:00` (or `+1d`), drop lands on the next day at the same spot.

---

## 5. Stronger colour markings in the weekly view

**Today:** timed event blocks in the week/3-day/1-day grid use the
calendar colour *only as a 2px left border* — the fill is always
`var(--accent-soft)` (TimeGrid.tsx:1104-1113, `borderLeftColor:
colorFor(item)`, `backgroundColor: 'var(--color-accent-soft)'`). The
all-day row already fills with the calendar colour (TimeGrid.tsx:662),
so timed events read much weaker than all-day bars.

**Change:** timed blocks carry the calendar colour more strongly —
fill tinted with the calendar colour (not the accent), plus a stronger
colour edge — while staying readable in both themes and keeping the
current accent-soft look for calendars with no custom colour.

**Steps:**
- In TimeGrid, derive per-item styles from `colorFor(item)`:
  - background: the calendar colour at low alpha (e.g. 18-22%) —
    compute `rgba(r,g,b,alpha)` from the hex the same way
    `applyAccent` derives `--color-accent-soft` (theme.ts:111-126);
    for the `ACCENT` fallback (no custom colour) keep
    `var(--color-accent-soft)` so the default look is unchanged.
  - border: widen the left border 2px → 3px, and add a
    `borderBottom` (or full border at lower alpha) so the block's
    whole silhouette carries the colour.
- Implementation shape: a small helper in TimeGrid (or caldate)
  `eventBlockStyle(color: string): React.CSSProperties` computing
  `{ backgroundColor, borderLeftColor, borderBottomColor }` from the
  hex, with the accent-fallback case handled by the caller.
- Keep selection/active styling working: the block's existing
  hover/selected classes shouldn't be drowned by the fill; verify
  against both themes and a light + a dark calendar colour.
- **Scope decision:** apply to week/3-day (the request) and the 1-day
  view for consistency (they share the same render path,
  TimeGrid.tsx:1104-1113); leave MonthGrid chips (already
  colour-dotted, MonthGrid.tsx:221) and the all-day row as-is.

**Test:** two calendars, one red and one default; the red one's timed
events read clearly as red-tinted with a red edge; the default one
looks identical to today.

---

## 6. Less sensitive whole-app tinting

**Today:** `applyAccent` (theme.ts:111-126) sets
`--color-accent` *and* derives `--color-accent-soft` at a fixed 0.14-0.16
alpha from the raw accent RGB. `--color-accent-soft` is used ~60
places, so a saturated accent hue visibly re-tints large surfaces —
the "super sensitive to the choice" complaint.

**Change:** accent picks remain vivid where accents belong (buttons,
rings, focus, the pill) but large soft surfaces shift less — the tint
stays closer to neutral across accent choices.

**Steps (pick one; a + b recommended):**
- **a. Lower + desaturate the soft derivation.** In `applyAccent`,
  derive `--color-accent-soft` not from raw accent RGB but from a
  desaturated/darkened variant (e.g. HSL: reduce saturation ~50%,
  then alpha 0.12-0.14). Implementation: small hex→HSL→hex helper in
  theme.ts; no call-site changes (all ~60 usages read the variable).
  This alone removes most of the "whole app re-tints" effect.
- **b. Fix the default too.** The default `--color-accent-soft` values
  in `index.css:16,41` should be recomputed with the same formula so
  default-vs-custom stays consistent.
- **c. (Optional, larger)** Migrate high-impact surfaces away from
  accent-soft toward a theme-neutral `--color-surface-soft` (new token,
  same value in both themes), starting with the biggest areas (module
  switcher, settings sections, selected rows). Only if a+b isn't
  enough; it touches many files and should be its own commit.

**Watch:** the ring/highlight usages (`bg-accent-soft` on the active
switcher tab, the day-header `ring-accent`) should still feel
"active" — verify a few of those specifically after the change, both
themes, several accents (the 8 presets cover hue space well).

**Test:** cycle through the 8 accent presets (GlobalSettings →
Appearance); the overall page tint should barely change while buttons
and focus rings clearly do.

---

## 7. Right-click "Duplicate …" on an event

**Today:** right-clicking an event opens the EventPopover (same as
left-click) — TimeGrid.tsx:1086-1090 (timed), 648-652 (all-day),
MonthGrid chips/bars 207-211/325-329 all call `onOpenEvent(item, {x,
y})`. There is no duplicate functionality anywhere, and no ContextMenu
on events. A reusable `ContextMenu` component exists
(ContextMenu.tsx:24-118) already used by tasks
(MainView.tsx:3751-3795), contacts, and calendar sidebar rows.

**Change:** right-clicking an event opens a context menu with at least
**Duplicate → (calendar picker)** plus the existing Edit/Delete
shortcuts; the duplicate is created on the chosen calendar (which may
differ from the source).

**Steps:**
- **Service:** add `duplicateEvent(srcCollectionUid, itemUid,
  destCollectionUid): Promise<EventItem>` in etebase.ts, next to
  `createEvent` (763-775) / `createEventRaw` (885-899). Simplest
  correct approach: take the source item's parsed `event` (VEvent model
  from vevent.ts) and call `createEvent(dest, { summary, start, end,
  allDay, description, location, rrule? })` — but the source may
  carry fields the NewVEventArgs doesn't cover (attendees, alarms,
  X-*). Preferred: clone the source item's **raw** with a **fresh UID**
  — read the raw (already available as `event.raw`), regenerate the
  `UID:` line (buildVEvent shows the uid is a plain `UID:` property,
  vevent.ts:199-228 — either regex-replace `^UID:.*$` in the raw or
  re-serialise via parse + build with `uid` preserved-then-swapped),
  then `createEventRaw(dest, newRaw)`. A fresh UID is mandatory —
  same-UID copies are a sync hazard.
- **UI — menu:** in CalendarView, add `const [dupMenu, setDupMenu] =
  useState<{ item: CalendarItem; x: number; y: number } | null>(null)`
  and a `duplicate` handler. Change the four event `onContextMenu`
  sites to call a new `onContextMenuEvent(item, x, y)` prop (thread
  through TimeGrid + MonthGrid props) instead of `onOpenEvent`.
  Menu items: **Edit** (→ `openEvent`), **Duplicate to…** (→ opens the
  calendar picker below), **Delete** (→ existing delete path, danger
  styling) — matching the tasks menu's shape.
- **UI — calendar picker for the destination:** a small modal/popover
  listing live calendars (the `calendars` state minus `isDeleted`,
  minus locked ones; colour dot + name; same row style as
  CalendarSelect) + Cancel. Pick → `duplicateEvent(src, itemUid,
  dest)` → optimistically insert the returned item into
  `eventsByCal` for dest (same shape as `handleCreate`,
  CalendarView.tsx:2266-2292). Preselect the source calendar.
- **Recurrence:** duplicating a recurring master copies the RRULE
  (fine — a parallel series). Duplicating a detached instance
  (`item.occId`-style data) should copy only that occurrence as a
  standalone event (strip RECURRENCE-ID; keep the raw-clone approach
  and drop the `RECURRENCE-ID:` line). Keep v1 simple: duplicate the
  underlying VEVENT item; if the source is a detached instance, its
  raw already is a standalone-able occurrence after stripping
  RECURRENCE-ID.
- Wire Escape/click-away via the ContextMenu component's built-ins;
  the picker popover reuses its own local dismiss handling.

**Test:** right-click a timed event in week view → menu; Duplicate to
a different calendar → event appears there (server sync + optimistic
insert), with a different UID; recurring master duplicated → series
duplicates; Delete from the menu still works.

---

## 8. Drag-resize all-day / multi-day events in week & 3-day view

**Today:** the all-day row supports only whole-bar day-shift dragging
(`mode: 'allday'`, grab/cur day indices, TimeGrid.tsx:280-290,
632-647, commit 422-435 — duration preserved). There is no resize:
clicking an all-day bar's edge can't change its span. Timed events
resize via a bottom-8px hot zone + a `cursor-ns-resize` handle
(TimeGrid.tsx:1048-1058, 1127) and commit with
`onMoveResize(item, start, end)`.

**Change:** dragging an all-day bar's left/right edge changes its
start/end day; the bar previews live, snaps per day, can't invert, and
commits through the existing `onMoveResize` path.

**Steps:**
- **Edge detection:** in the all-day bar's `onPointerDown`
  (TimeGrid.tsx:632-647), hit-test the pointer against the bar's
  bounding box: within 6-8px of the left/right edge (or
  `e.offsetX`) → start an `allday-resize` drag; else the existing
  `allday` move. Add `cursor-ew-resize` styling on the edge zones
  (two absolutely-positioned strips like the timed resize handle at
  1127).
- **Drag state:** extend the `Drag` union (TimeGrid.tsx:252-290) with
  `{ mode: 'allday-resize'; item; edge: 'start' | 'end'; origStartIdx;
  origEndIdx; curDayIdx; moved }` (indices into `days`).
- **Pointermove:** reuse the window listeners (TimeGrid.tsx:357-465);
  update `curDayIdx` via the existing `allDayDayIdxAt()` (331-344).
  Clamp: `start` edge can't pass `endIdx` (min span 1 day); `end` edge
  can't pass `startIdx`; also clamp to the visible `days` range.
- **Preview:** during resize, render the bar with
  `grid-column: startIdx+1 / span (endIdx - startIdx + 1)` updated
  live (the bars are absolutely-positioned/lane-packed via
  `layoutBars`, caldate.ts:223-271 — simplest: compute the preview
  start/end from the drag state and override that one bar's rendered
  segment instead of re-running layoutBars).
- **Commit:** on pointerup, if `moved`:
  `onMoveResize(d.item, days[newStartIdx], addDays(days[newEndIdx], 1))`
  — matching the existing all-day commit's exclusive-end convention
  (the move branch uses `newEnd = addDays(end, delta)` on the
  *exclusive* end, TimeGrid.tsx:422-435; keep all-day DTSTART/DTEND as
  VALUE=DATE with DTEND exclusive, as `buildVEvent` writes them,
  vevent.ts:199-228).
- **Recurrence:** v1 mirrors the existing move branch's behaviour —
  whatever the move commit does with recurring events (the allday move
  commits `onMoveResize(d.item, …)` directly, so a recurring source
  edits its series the same way). Keep parity; refinements out of
  scope.
- **Cursor + hint:** `cursor-ew-resize` on the edge strips; during the
  drag, `cursor-ew-resize` on the body (the move drag already does a
  body-cursor swap — follow its pattern).

**Test:** a 3-day all-day event in week view; drag its right edge to
Friday → bar grows live, commits as Mon–Fri; drag left edge past the
right edge → no inversion (clamps); drag an edge in 3-day view clamps
to the 3 visible days; move-drag (bar middle) still works.

---

## Out of scope / notes

- Item 13 (Shift+arrows) is fixed by moving `selected` with the page;
  plain-arrows keep their keep-visible paging. If the user instead
  wants plain ←/→ to *never* jump weeks, that's a separate tweak to
  `CalendarView.tsx:2247-2250` — flagged, not planned.
- The resize-past-midnight commit path already works (TimeGrid.tsx:
  436-445); item 16 is purely the preview/label honesty.
- All-day bar right-click currently opens the EventPopover too —
  item 7's `onContextMenuEvent` threading covers all four sites
  including bars, so the duplicate menu works there as well.