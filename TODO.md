# TODO

Roadmap / backlog for ete-stethic. Newest asks at the top.
See also: [`docs/task-item-options.md`](docs/task-item-options.md) (VTODO field
coverage worksheet) and [`docs/calendar-contacts-plan.md`](docs/calendar-contacts-plan.md)
(unified-client plan).

## Shipped

- [x] Task list create / inline-rename / delete (sidebar + `n`/`F2`/`Del`).
- [x] Full VTODO field model + basic/advanced detail panel.
- [x] Priority `0–9` hotkeys + card priority tint.
- [x] Per-zone zoom (sidebar / tasks / details) with memory.
- [x] #3 Sort popover: `Enter` confirms and returns focus to the task list.
- [x] #5 `←/→` move focus between buttons in the confirm modal.
- [x] #7 `Ctrl/Cmd+A` on the selected task starts inline rename (F2 alias).
- [x] #8 Stronger fade for out-of-focus zones.
- [x] Visible "delete this list" button in the sidebar header (was
      keyboard-only via `Del`).
- [x] Entering a list (`→`/`Enter`/`t`) now selects the first task instead
      of landing selection-less.
- [x] ConfirmModal traps `Tab` focus between its two buttons.
- [x] `Ctrl+←/→` are a zone meta-navigator (sidebar ↔ tasks ↔ details);
      never expand/collapse the tree.
- [x] `Enter` cycles task status (same as `Ctrl+Enter`).
- [x] Saving a detail edit returns to the list immediately; the row shows
      a "saving…" marker until it syncs.
- [x] ConfirmModal buttons have a visible focus ring (keyboard focus was
      invisible — felt like arrows/Tab did nothing).
- [x] Fixed double task-list creation (Enter + unmount-blur double submit).
- [x] Sidebar icons disambiguated: eye = show/hide deleted, trash = delete.
- [x] ConfirmModal `←/→/Tab` cycle (toggle) between buttons — no dead state.
- [x] `Ctrl+Enter` opens the detail panel (Enter cycles status now).
- [x] Opening a sort popover focuses it + un-fades its zone.
- [x] Sidebar type-to-search: a–z/0–9 jump/cycle lists; alphanumeric
      task-view shortcuts no longer fire while the sidebar is focused.
- [x] Selection indicator is now a symmetric inset border (was an
      asymmetric inset ring).
- [x] `+` from "none" priority now goes to *low* first (then steps up),
      including phone mode (None→Low→Med→High).
- [x] Change a list's colour from the app (sidebar header palette popover:
      preset swatches, full RGB/hex picker, and "default"/clear).
- [x] Default-selected list is now the first in the *sorted* sidebar
      order (was raw server order).
- [x] #16 Completion timestamp shown read-only in the detail panel's
      Advanced section (data was already recorded by `updateVTodo`).
- [x] Malformed items are no longer silently dropped: lenient parse
      (strict → wrap bare VTODO → regex-recover), a "⚠ unreadable" row,
      and a raw-iCal editor (save bypasses the patch path) so a broken
      task can be viewed and hand-fixed instead of lost.
- [x] Confirmed: COMPLETED timestamp is already written on completion and
      cleared when cycled off (`updateVTodo`). Not yet shown in the UI —
      see queued #16.
- [x] Moving a parent carries its children: `buildTree` also resolves
      `RELATED-TO;RELTYPE=CHILD` (some clients write the hierarchy that
      way), so subtrees nest → `m`-move takes the whole subtree and
      priority sort stays hierarchical. Tree recursion is now cycle-safe.
      (Likely the real cause behind queued #4 & the "children don't move"
      report — a link-resolution gap, not a sort/move-logic bug.)
- [x] Detail panel is one notch less faded when unfocused (more visible
      while working in tasks); sidebar/tasks fades unchanged.
- [x] `Ctrl+←/→` in any text field is native word-jump (rename / inline
      create / detail inputs); zone meta-nav only fires outside fields.
- [x] Starting another create while one is in progress now auto-commits
      the in-progress one (blur=save path) instead of silently dropping
      it on unmount. (User chose auto-commit over a confirm modal, since
      the modal's focus-grab conflicts with blur=save.)
- [x] #9 Custom accent colour: toolbar popover (presets + RGB/hex +
      theme-default), persisted, applied pre-mount via inline
      `--color-accent` / derived `--color-accent-soft` (no flash).
- [x] #6 Writing-mode indicator: a fixed "✎ Editing — Esc/Enter to exit"
      pill appears whenever a text field is focused (EditModeIndicator).
- [x] Hardened move: after the source delete, verify via fresh
      `sourceIm.fetch` that each item is actually tombstoned (one retry,
      then throw a clear "move incomplete" error instead of assuming
      success). On success, invalidate the source snapshot/stoken so this
      app never re-shows moved items from a stale cache. (Phone clients
      still apply the deletions on their own sync cadence — out of our
      control — but a real delete failure is now caught, not silent.)
- [x] Root-caused the "moved here but still on phone" duplicates:
      handleMovePick's `catch`/`finally` started with
      `if (cancelledRef.current) return`, so if the source delete threw
      while the component was cancelled (e.g. list switched) it swallowed
      BOTH the rollback and the error — source items optimistically
      removed from view forever, dest copies created, server source
      never deleted → permanent cross-client ghost. Fixed: errors always
      surface; the source snapshot is ALWAYS invalidated in `finally`
      (fs op, unmount-safe) so the source re-syncs from the server and a
      half-completed move can never leave a silent ghost again.
- [x] Sidebar "sync all lists" button (bounded concurrency, spins +
      shows count while syncing) and a per-list syncing spinner in the
      sidebar that lights up whenever a list is being pulled — from any
      trigger (active refresh, prefetch, sync-all, post-move re-sync).
- [x] #14 ConfirmModal renders at the zoom of the zone it came from
      (task delete→tasks, list delete→sidebar, save-changes→details).
      (zoom-% readout still deferred until a settings panel exists.)
- [x] #13 Optimistic list create (placeholder row + "syncing" badge
      until the server confirms) and delete (row badged "syncing" until
      confirmed); reconciles on success, rolls back + errors on failure.
      Placeholders aren't selectable/renamable and don't affect keyboard
      nav/typeahead.
- [x] #10 Native-style right-click menus (ContextMenu component:
      keyboard-navigable, esc/click-away/scroll/blur close, viewport
      clamp). Wired on task rows (new subtask / move / priority /
      delete), sidebar list rows (new / rename / recolour / delete) and
      the sidebar blank area (new list); browser menu suppressed on
      those surfaces only (inputs keep native copy/paste).
- [x] #11 Drag a task row onto a sidebar list to move its whole subtree
      there. Task rows are draggable (carry the VTODO uid via a custom
      mime); valid list rows highlight on drag-over; drop reuses the
      hardened/verified move path (no picker modal). handleMovePick was
      refactored to share `performMove` with the drag drop. Invalid
      targets (same list / placeholder / tombstone) reject the drop.
- [x] #1 Root new-task input renders as a centred compose box
      (max-width, mx-auto, bordered surface) in the task pane; subtask
      creates stay inline at their indent.
- [x] Clicking the sidebar "Lists" header (or the collapsed chevron)
      focuses the list selection (focusZone='sidebar').
- [x] Settings menu: new SettingsPopover (gear button) consolidates the
      low-frequency view controls — hide completed, phone-friendly
      priority, dark/light theme, accent colour (presets+hex+default),
      task card size — removed from the crowded task header. (Also a
      natural home for the deferred #14 zoom-% readout — now shown.)
- [x] Offline collection-list cache: persist the list; on a failed
      listCollections fall back to it (no snapshot prune offline) so the
      sidebar still renders, with a prominent persistent "Offline …
      changes won't sync" top banner + Retry.
- [x] Click anywhere in the list pane focuses it (not just the title).
- [x] Sync is staleness-gated + background-continuing (switching lists
      no longer restarts/aborts a sync).
- [x] Adaptive sync: per-list sync button on every sidebar row; active
      list refreshes on a fast cadence, other lists on a slow one, and
      opening a list background-syncs it only if older than a freshness
      window. All three intervals configurable in the settings menu
      (Active list every / Other lists every / On open if older than).
- [x] Sidebar settings menu (gear) for the list view: sort lists +
      reverse + show-deleted, decluttered out of the sidebar header.
      Per-list delete/recolour buttons removed (already in the row
      right-click menu); sync-all + new-list stay inline.

## Polish & fixes (queued 2026-05-18)

### 1. Centre the "add task" affordance — ✅ done
**Task.** The inline new-task input currently renders flush at the top-left
of the task pane; make it visually centred in the task view so it reads as a
deliberate "compose" surface, not a list row.
**Plan.**
- `InlineCreate` in `src/components/TaskTree.tsx` is the row; root creation is
  injected at the top of the list by `handleStartCreateRoot` in MainView.
- Centre horizontally (max-width + `mx-auto`) and lift it visually (border /
  surface-2 background) when it's a *root* create; keep child creates inline
  at their indent so the tree still reads.
- Confirm it doesn't break the depth-based `paddingLeft` for subtask creates.

### 2. `Ctrl+→` while writing a subtask should follow the NEW task — ✅ done
**Task.** Creating a subtask then pressing `Ctrl+→` opens the *parent's*
detail panel instead of the subtask being written.
**Plan.**
- MainView's `Ctrl/Cmd+ArrowRight` handler enters details for
  `selectedTaskUid`, which is still the parent during an open `InlineCreate`.
- On `Ctrl+→` while a create is in progress (`creating` state set): commit the
  inline create first (reuse `handleConfirmCreate`, which already selects the
  new task via `setSelectedTaskUid(newItem.todo.uid)`), then enter details for
  that new uid. If the input is empty, cancel instead of creating.

### 3. Sort popover: `Enter` confirms and returns to the task items — ✅ done
**Task.** In sort (`s`), confirming a sort with `Enter` should close the
popover and move focus back to the task list. Today it stays open.
**Plan.**
- `src/components/SortPopover.tsx` + the `s` handler / `sortOpen` state in
  MainView. On `Enter` (commit) call `onClose()` and `setFocusZone('tasks')`.
- Mirror for the sidebar sort popover for consistency.

### 4. Strictly hierarchical priority sort — ⚠ investigated, no code bug
**Task.** A low-priority parent is being pulled into the high-priority group
because it has a high-priority subtask. Sorting must be *per-sibling-group*:
a node's position among its siblings depends only on its own priority;
descendants only reorder within their own sub-branch.
**Plan.**
- Audit `buildTree` (`src/services/tree.ts`) + `comparatorFor`
  (`src/services/sort.ts`): `sortRecursive` should sort each `children`
  array by the node's own key, never bubbling a descendant's priority up.
- Reproduce with a low parent + high child; if the regression is in the
  visible flatten (`flattenVisible`) or a grouped view, fix there. Add the
  case to any sort reasoning notes.
**Finding (investigated):** `buildTree` already sorts roots by each
root's *own* priority and `sortRecursive` sorts each node's `children`
by *their own* keys; `comparatorFor('priority')` reads only
`node.todo.priority` — no descendant aggregation anywhere. So the sort
is already strictly per-sibling-group. The reported symptom is therefore
**not a sort bug** but almost certainly a parent/child *link-resolution*
issue: if a subtask's `RELATED-TO;RELTYPE=PARENT` doesn't resolve (parent
in another list, non-PARENT reltype, or — post broken-item work — a
parent that got a synthetic `broken-…` uid the child can't match), the
subtask becomes an orphan **root** and sorts by its own (high) priority,
appearing away from its low-priority parent. Next step is to look at the
actual offending items (raw `RELATED-TO`) rather than change correct sort
code. Left open pending that data.

### 5. Arrow keys in the delete confirm modal — ✅ done
**Task.** `ConfirmModal` only responds to `Tab`; `←/→` do nothing and focus
always starts on Cancel. Keep Tab, add `←/→` to move between buttons.
**Plan.**
- `src/components/ConfirmModal.tsx`: add a keydown handler mapping
  `ArrowLeft`/`ArrowRight` to focus Cancel / Confirm respectively (clamp, no
  wrap). Keep initial focus on the safe action (Cancel) for destructive.

### 6. Clear "writing mode" vs "navigation mode" indicator — ✅ done
**Task.** When an input is capturing keys (new task, rename, sidebar
create/rename, detail fields) it isn't obvious the keyboard is "locked" into
text entry vs tree navigation.
**Plan.**
- Add a shared visual: strong accent ring on the active capturing input
  **plus** a small global mode pill (e.g. bottom-right "✎ EDITING — Esc/Enter
  to exit") shown whenever a tracked text input is focused.
- Drive it off focus/blur of the known inputs (TaskTree `InlineCreate` &
  rename, sidebar create/rename, DetailPanel fields). One small
  `EditModeIndicator` component fed by a focus listener.

### 7. `Ctrl+A` on a task item enters rename (same as `F2`) — ✅ done
**Task.** Add `Ctrl/Cmd+A` as an alias for `F2` (start inline rename) on the
selected task.
**Plan.**
- The TaskTree key handler bails on modifier chords; MainView owns Ctrl
  combos. Add `Ctrl/Cmd+A` in MainView's global handler: when
  `focusZone === 'tasks'` and a task is selected, trigger rename.
- Needs a way to start editing from MainView — add an `onRequestRename`
  imperative/prop or a `renameRequestUid` prop TaskTree watches to set
  `editingUid`. `preventDefault` so it doesn't select-all.

### 8. Stronger fade for out-of-focus zones — ✅ done
**Task.** Inactive zones (sidebar `opacity-80`, tasks `opacity-60`, detail
`opacity-60/80`) are still too visible; deepen the de-emphasis.
**Plan.**
- Lower the inactive opacities in MainView (`<aside>`, `<main>`) and
  `DetailPanel` (collapsed/unfocused states) — try ~`opacity-40` for the
  task/detail panes and ~`opacity-50/60` for the sidebar; keep transitions.

### 9. Custom accent colour option — ✅ done
**Task.** Let the user pick their preferred contrast/accent colour (presets +
custom hex), persisted, applied app-wide.
**Plan.**
- Extend `src/services/theme.ts`: store an accent value; on apply set
  `--color-accent` and a derived `--color-accent-soft` (hex → `rgba(...,0.14)`)
  on `document.documentElement` (synchronous pre-mount, like theme, to avoid
  flash).
- UI: a small swatch row + custom hex input near the theme / phone-priority
  toggles. A few curated presets so it stays "aesthetic".

### 10. Native-style context menus (replace browser menu) — ✅ done
**Task.** Right-click should show app-relevant menus, not the webview default.
Sidebar empty area → "New list"; on a list → Rename / Delete. Task pane → the
task actions (new, rename, delete, move, priority).
**Plan.**
- New lightweight `ContextMenu` component: absolute-positioned at the cursor,
  closes on click-away / `Esc` / scroll, arrow-key navigable.
- `onContextMenu` handlers (with `preventDefault`) on sidebar rows + empty
  area and task rows; build the item list from existing handlers
  (`startCreateList`, `startRenameList`, `setDeletingList`,
  `handleDeleteRequest`, `setMoving`, `handleChangePriority`).
- Medium effort; do the menu primitive once, reuse per surface.

### 11. Drag a task onto a list to move it there — ✅ done
**Task.** Drag a task (and its subtree) from the task pane onto a sidebar
list to move it to that collection.
**Plan.**
- HTML5 DnD: task rows `draggable`, sidebar list rows as drop targets;
  highlight the hovered target list.
- On drop: `moveTasksToCollection(activeUid, targetUid,
  collectDescendantItemUids(node))` — reuse the `handleMovePick` path; VTODO
  uids are preserved so the subtree's parent/child links survive.
- Independent of the deferred *intra-list* manual-order DnD (this is a
  cross-list move and needs no ordering store).

### 12. Calendar popover for due / start dates — ✅ done
**Task.** When setting a due (or start) date in the detail panel, offer a
month calendar grid the user can navigate with the arrow keys instead of the
raw native date input. Bias selection toward near-future dates (the common
case for a task deadline).
**Plan.**
- New `CalendarPopover` component: month grid, `←/→/↑/↓` move by day/week,
  `PageUp/PageDown` by month, `Enter` selects, `Esc` closes; opens anchored
  to the Due/Start field in `DetailPanel.tsx`.
- Initial focus = current value if set, else today (so "future" dates are
  one keystroke away). Keep the existing `<input type=date>` as a fallback /
  for typing; the popover is an enhancement layered on top.
- Reuse the `splitIcalDateTime` / `toDateValue` helpers already in
  `DetailPanel` so the time-of-day field and date-only vs date-time
  semantics are unaffected.
- Note: overlaps conceptually with the calendar (VEVENT) module being built
  in the `worktree-calendar` branch — check whether a shared month-grid
  primitive should come from there before duplicating.
**Outcome.** New `src/components/CalendarPopover.tsx`: a 6×7 month grid
with `←/→/↑/↓` (day/week), `PageUp/Dn` (month, `Shift` = year), `Home/End`
(week edges), `t` (today), `Enter`/click to commit, `Esc` to close. The
calendar (VEVENT) module's `MonthGrid` is too event-specific to reuse, but
its `caldate.ts` date helpers (`monthGridDays`, `addDays`, `sameDay`, …)
are shared. A calendar-icon toggle sits next to each Due/Start date input;
the popover is `absolute`-anchored to the field row, `scrollIntoView`s on
open (the Start field sits low in the scrolling panel), and commits the
same `YYYY-MM-DD` string the native input would — so `buildPatch` /
date-only-vs-date-time semantics are untouched. Cursor lands on the
current value or today. `role="dialog"` makes MainView's & DetailPanel's
global key handlers stand down while it's open.

### 13. Optimistic list create/delete with a "syncing" badge — ✅ done
**Task.** Creating a list should show it in the sidebar immediately with a
"syncing…" indicator until the server confirms; deleting one should likewise
show "syncing…" on that row until the server confirms.
**Plan.**
- `createCollection`/`deleteCollection` currently await the server before the
  sidebar refreshes. Add an optimistic overlay: a `syncingListUids` set (+ a
  pending-create placeholder `CollectionInfo` with a temp uid) merged into
  `sortedCollections` for render.
- On success, `refreshCollections()` reconciles (replace temp uid / drop
  deleted). On failure, remove the optimistic entry and surface `listError`.
- Reuse the row layout; show the same "saving…"-style badge used on task
  rows. Watch the load effect's orphan-prune so it doesn't nuke the
  optimistic placeholder mid-flight.

### 14. Modal zoom parity + zoom % in settings — ◑ modal-zoom done; % deferred (no settings panel)
**Task.** The confirm/delete modal should render at the same zoom as the zone
it was triggered from. Also expose the current zoom level as a % (a future
settings menu).
**Plan.**
- Pass a `zoom` prop to `ConfirmModal` and apply CSS `zoom` to its inner box;
  the caller passes the relevant zone factor (task delete → tasks zoom, list
  delete → sidebar zoom, save-changes → details zoom).
- Settings menu doesn't exist yet — defer the % readout to that. When built:
  small panel listing the three zone zooms with +/-/reset and a numeric %.

### 15. Discoverable task-card size control (PRIORITY) — ✅ done
**Task.** Make resizing the task cards as discoverable as the
sidebar/detail. Card size today = the tasks-zone zoom (focus tasks, then
`Ctrl/Cmd +/-/0`); the user wants an obvious affordance, not just a hotkey.
**Plan.**
- Confirm tasks-zone zoom is working (it is: CSS `zoom` on `<main>`, persisted).
- Add a visible control: a small "A−/A+" (or zoom) cluster in the task-pane
  header that calls `adjustZoom('tasks', …)`, mirroring how the sidebar has a
  drag handle. Optionally a drag handle / +/- on each pane for parity.
- Decide: keep keyboard `Ctrl+±` as the power path, header buttons as the
  discoverable one. (Marked PRIORITY by the user.)

### 16. Show the completion timestamp in the detail panel — ✅ done
**Task.** The `COMPLETED` time is already stored (and cleared on cycle-off);
surface it read-only in the detail panel when the task is completed.
**Plan.**
- `parseVTodo` doesn't read `COMPLETED` into the model yet — add
  `completed?: string` to `VTodo`, parse it, and render it (read-only,
  "Completed: <date>") in DetailPanel's Advanced/Basic section when present.
- No write path needed; `updateVTodo` already manages the property.

## Tracked elsewhere

- [ ] Manual ordering + `Shift+↑/↓` reorder + drag-to-position / `Shift+←/→`
      indent-outdent — blocked on the per-list manual-order store; see the
      tree-UX backlog memory for the design sketch.
- [ ] Fill in [`docs/task-item-options.md`](docs/task-item-options.md) — which
      remaining VTODO fields (recurrence, alarms, …) are worth adding.
- [x] Unified EteSync client (calendar + contacts) —
      [`docs/calendar-contacts-plan.md`](docs/calendar-contacts-plan.md).
      Calendar shipped earlier; contacts module added 2026-05-22 (see the
      "Contacts module" entry below). All three EteSync data types are now
      handled in one app — the original "one window" goal.
- [x] Tree-UX: coordinated subtree fade. Completing tasks under Hide-done
      no longer blinks each row out on its own 5s timer. A completed task
      lingers solid for the grace window, then fades over `FADE_MS`; a
      completed parent's fade is staggered `CASCADE_STEP_MS` after its
      completed children's, so a finished branch clears bottom-up.
      `recentlyCompleted` (kept rows) + `fadingUids` (rows mid-fade, armed
      by precise per-uid timers) in `MainView.tsx`; `TaskTree` takes
      `activelyFading` for the fade visual. `markRecentlyCompleted` builds
      the tree via `buildTree` (PARENT+CHILD reltypes, cycle-safe) and is
      subtree-status-aware: a completed task with an open descendant isn't
      scheduled to fade (it stays via the surviving-descendant rule) and
      is pulled into the cascade only once that last descendant completes
      — so a completed parent no longer fades-and-pops or blinks out
      ungracefully. `clearRecentlyCompleted` un-cascades: un-completing a
      task also cancels every ancestor that was fading on the assumption
      the branch was done.
- [x] Tree-UX: per-branch reveal of completed subtasks. Under Hide-done, a
      parent with hidden completed descendants shows a check-count control
      on its row; clicking it expands the parent and reveals that branch's
      completed tasks inline (to inspect/uncheck them) without un-hiding
      completed tasks anywhere else. Structural, not a sticky keep-set:
      `applyFilter` takes `revealedBranches` and carries an `underRevealed`
      flag down the walk so completed nodes under a revealed parent pass
      the filter. `revealedBranches` state in `MainView` (transient — reset
      on list switch / Hide-done off); `branchDoneHidden` counts each
      row's hidden-completed descendants. Reveal and the fade cascade are
      kept mutually exclusive: `markRecentlyCompleted` skips a fade for a
      task pinned by a revealed ancestor, and a branch cascading out drops
      its reveal so it can actually leave.
- [x] Contacts module (vCard) shipped 2026-05-22 — `ContactsView` + a
      hand-rolled `services/vcard.ts` parser/serializer (no new deps;
      handles vCard 3.0 + 4.0, preserves unmodelled properties like PHOTO
      and X-* verbatim across an edit). Mirrors the calendar module's
      architecture: `etebase.ts` gains `listAddressBooks` /
      `listContactItems` / `createContact` / `updateContact` /
      `deleteContact` + `createAddressBook`; `contactsnapshot.ts` for
      cold-start disk cache; `contactstore.ts` for warm-remount in-memory
      cache. UI: address-book sidebar (create / rename / delete via
      right-click context menu), searchable contact list, view card with
      avatar (photo fallback → coloured initials), full editor for FN /
      N / ORG / TITLE / emails / phones / URLs / addresses / BDAY / NOTE /
      categories. Keyboard: `n` new, `/` search, ↑/↓ navigate, Del
      delete, Esc cancel. `App.tsx` lazy-loads the module behind the
      bottom-left switcher alongside Tasks and Calendar.

## Polish & fixes (queued 2026-05-22)

### Detail-panel breadcrumb wording — ✅ done
The trailing "› this task" in the detail panel's ancestor breadcrumb
reads weirdly — the user is already in the detail, so labelling the
current item "this task" is redundant. Decide between dropping the
trailing chip entirely (just show ancestors), bolding the parent's name,
or replacing "this task" with the actual task title.
**Resolution.** Dropped the trailing chip + separator entirely
(`DetailPanel.tsx`). The Title input directly below the breadcrumb is
already the current task's name, so the chip was pure redundancy.

### Ellipsis should scale with width — ✅ done
Long task titles truncate with `…`, which is fine — but the truncation
cutoff is the same regardless of pane width. Make the `text-truncate`
cap responsive to the available width so a wider task pane shows more
characters before clipping.
**Resolution.** Breadcrumb ancestor chips changed from `max-w-[10rem]`
(a fixed 160px) to `max-w-[60%]` of the breadcrumb container, so each
chip scales with the detail pane's width as the user resizes it.

### "Editing" indicator placement + dismissibility — ✅ done
The fixed "✎ Editing — Esc/Enter to exit" pill (`EditModeIndicator`)
currently sits at the bottom of the screen, where it overlaps / sits
above the detail panel's Cancel / Save footer. Two changes:
- Move it to a less-conflicting position — the user suggests **centred
  horizontally** so it's out of the way of action bars.
- Give it an `×` close button so the user can dismiss it for the
  remainder of the session if it's in the way.
**Resolution.** Moved to bottom-centre (`bottom-3 left-1/2
-translate-x-1/2`) so it stays out of the way of zone footers in the
corners; added an `×` close button (and dropped `pointer-events-none`
so it's clickable) that dismisses the pill for the session, persisted
via `sessionStorage` so a quick reload doesn't bring it back. The
durable opt-out belongs to the "Hint opt-out" item below.

### More guidance hints
Add discoverable hints (tooltips / inline tips / a first-run callout)
to surface the keyboard-first features that aren't obvious from looking
at the UI — e.g. `/` to search, `n` to create, `g t` / `g c` / `g k`
for module switching, `Ctrl+Enter` for the detail panel, etc.

### Hint opt-out
Hints from the above must be possible to disable globally. A toggle in
the settings popover ("Show usage hints") that flips a persisted
boolean, plus a per-hint dismiss (the `×`) that remembers itself.

## Contacts polish (queued 2026-05-22)

Targeted feedback against the freshly-shipped contacts module.

### Discoverable address-book rename — ✅ done
Rename exists today but is right-click-only — the user didn't realise it
was there. Surface it with a visible affordance: e.g. an inline F2 alias
on the focused row, a hover-only pencil icon, or a small per-book
settings popover (mirroring the tasks sidebar's gear). Keep the
right-click path as the secondary route.
**Resolution.** Added a hover-revealed pencil button on each book row
(`opacity-0 group-hover:opacity-100` so it stays out of the way until
the row is hovered or focused). Click → enters inline rename mode for
that book. The right-click "Rename" menu item is unchanged. The book
row's outer element was changed from `<button>` to a
`<div role="button" tabIndex={0}>` with Enter / Space handlers so the
pencil can be a real nested `<button>` without invalid-HTML
button-in-button nesting.

### Visible sync status — ◑ partly done
Currently a tiny `↻` spinner appears on a syncing row and that's it.
Show more: per-book "last synced X ago", a global "all synced" / "1
syncing…" / "1 failed" line, and a clearer affordance after a sync
error (the toast hides quickly). Mirror the tasks sidebar's
sync-all + per-list cadence indicator pattern.
**Resolution (in progress).** Active book's last-successful-sync time
now shows in the contact-list header subtitle as "Synced HH:MM"
(absolute time, no drift). Cycles to "Syncing…" while a sync is in
flight and "Never synced" before the first one ever lands. Persisted
via a new `lastSyncedAt: Map<string,number>` in `ContactMemory` so it
survives module switches; seeded from the snapshot's `lastSyncedAt`
on disk hydration / book switch and updated on every successful
`syncBook`. **Still pending:** the global "all / 1 syncing / 1
failed" summary, a per-book inline stamp (the current one is only
for the active book), and a stickier error affordance.

### Adaptive (relative) sync for address books
Contacts currently syncs the active book on open + on the manual
refresh button. Match the tasks module's adaptive cadence: the active
book on a fast interval, other books on a slow one, opening a book
triggers a delta sync only if its snapshot is older than a freshness
window. Configurable from a contacts settings popover.

### Enter on a contact opens the detail — ✅ done
Today ↑/↓ moves the selection and the detail card on the right updates
live, but Enter does nothing on a row. Two reasonable interpretations:
either (a) Enter starts edit mode for the selected contact (matches
"open" as in "open for editing"), or (b) Enter moves keyboard focus
into the detail pane so its Edit / Delete buttons become reachable.
Pick one — probably (a), matching how the tasks list cycles status on
Enter and Ctrl+Enter opens detail.
**Resolution.** Picked (a) — pressing Enter on the selected contact
calls `startEdit()`, so the detail pane swaps into the editor for that
contact. The keyboard effect's deps array picks up `startEdit`.

### Richer hover preview in the contact list — ✅ done
The list pane shows avatar + name + a one-line subtitle, leaving lots
of empty horizontal space. On hover (or for the focused row), show
more — e.g. all emails, all phones, an org line — either inline (the
row expands a little) or as a side preview. The pane is wider than the
content needs; use it.
**Resolution.** Picked "always show more inline" over a hover popover —
mouse jitter / chasing-target reflow makes hover-expand awkward, and
the user's underlying ask ("there is not much else to use the space
for") fits an always-on layout better. Each contact row now shows up
to three lines: name, then **org or title** when present, then a
compact **first email · first phone** line. Lines are skipped when
their underlying field is empty, so bare contacts still render
compactly — no fixed reserved height. Avatar bumped 32→36px to balance
the multi-line text column. `subtitleOf` helper retired since it
collapsed all of this into one line.

### Resizable / zoomable contact panes
The contacts view has fixed widths for the address-book sidebar (w-52)
and the contact list (w-80). Port the tasks/calendar pattern: drag-to-
resize handles between panes, plus per-zone `Ctrl/Cmd +/-/0` zoom with
localStorage persistence. Each of the three zones (address-books /
contact-list / detail) should carry its **own independent** zoom
factor — including the contact list itself — and each should be a
labelled +/-/reset row in a contacts settings popover (mirroring the
matching tasks-pane request under the 2026-05-23 polish block).

### Zone meta-navigation + cross-zone fade
Ctrl+←/→ (or even bare ←/→ from the address-book list) should walk
between the three zones (address-books ↔ contacts ↔ detail), and the
out-of-focus zones should fade like they do in the tasks module. Today
the contacts view has no `focusZone` concept and all three panes stay
fully opaque regardless.

## Polish & fixes (queued 2026-05-23)

### Make all keyboard shortcuts Ctrl-prefixed
Bare-letter shortcuts (`n` new, `f` filter, `s` sort, `m` move, `t` jump
to tasks, etc.) collide with the sidebar/task-list typeahead — typing a
letter is ambiguous between "shortcut" and "jump to the item whose name
starts with that letter." Standardise: every command shortcut becomes
`Ctrl/Cmd+<letter>`, freeing bare letters entirely for typeahead. The
existing typeahead in `MainView` (`taskTypeaheadRef`, `listTypeaheadRef`)
already works — just stop competing with it. Update `KeybindingsModal`
to reflect the new bindings.

### Move shortcut: `Ctrl+M` moves, `Ctrl+Shift+M` moves + follows
Today `m` opens the move-task picker; after picking a destination the
task is moved. Split that into two:
- **`Ctrl+M`** — move the task (and its subtree) to the picked list,
  but **stay in the current list** (no follow). The common case is "get
  this off my plate," not "go look at it where it landed."
- **`Ctrl+Shift+M`** — move **and** switch the active list to the
  destination so the user can keep working on the moved task there.

Implementation note: the existing `performMove` already returns the
created destination items; the follow-vs-stay distinction is just
whether `setActiveUid(destUid)` runs after the move resolves. Surface
both in `KeybindingsModal`.

### Help modal: scrollable, more visible, smoother — ✅ done
The `KeybindingsModal` is cramped (overflows without scrolling), blends
into the background, and has sharp corners. Three tweaks:
- Make the body **scrollable** (`overflow-y-auto` + a `max-h`), so long
  shortcut lists stay reachable as the catalogue grows.
- Bump visual prominence: a slightly translucent dark backdrop
  (`bg-black/60` or similar), a higher-contrast surface inside, maybe
  a small drop-shadow elevation.
- **Rounded corners** (`rounded-2xl` or `rounded-xl`) on the modal box
  to match the softer aesthetic the rest of the app is moving toward.
**Resolution.** Modal restructured as a flex-column: a fixed header
("Keyboard shortcuts" + ×), a scrolling body (`min-h-0 flex-1
overflow-y-auto`) capped at `max-h-[85vh]`, and the "Customizable
bindings…" footer pinned at the bottom. Visual lift: `rounded-2xl`,
`shadow-2xl`, a thin `ring-1 ring-border/60`, `max-w-lg`, and the
backdrop bumped to `bg-black/60 backdrop-blur-sm`.

### Independent zoom for the task-list pane — ✅ done (already shipped)
The task-list (middle) pane should carry its own persisted zoom level
that's **fully independent** of the sidebar and detail zooms, both for
`Ctrl+=`/`Ctrl+-`/`Ctrl+0` (when the task pane is the focused zone) and
as an explicit control in the settings popover. Per-zone zoom already
exists in `MainView` (`adjustZoom('tasks', …)` + CSS `zoom` on
`<main>`), but verify nothing's piggy-backing tasks zoom on another
zone's factor, and surface the current `tasks` zoom as a labelled
+/-/reset row in `SettingsPopover` alongside the existing readouts.
**Resolution.** Audited — both halves of the request were already
shipped:
- **Independence verified.** Each zone has its own `zoom.<zone>` state
  slice, its own `ete-stethic.zoom.<zone>` localStorage key, and the
  Ctrl+/-/0 handler in `MainView` only touches `zoom[focusZone]`. The
  tasks zone applies its factor to `<main>` exclusively
  ([MainView.tsx:3595](src/components/MainView.tsx#L3595)); the
  sidebar and detail zones apply theirs to their own `<aside>`s. No
  shared factor anywhere.
- **Settings exposure already present.** `SettingsPopover` has a "Task
  card size" row with A−/A+ buttons + a clickable percentage (which
  resets on click), wired through `taskZoomPct` and `onZoom` to
  `adjustZoom('tasks', …)`. Renaming the label to "Task pane zoom" is
  arguably clearer but is a bikeshed; left as-is.
- Sidebar and detail zooms remain Ctrl+/-/0-only (no settings rows).
  If desired, adding matching rows under "View" is a small follow-up,
  but not part of this TODO's scope.

## Known issues

Things that have been observed misbehaving but haven't been root-caused
yet. These get tracked here (not in the polish queue) so they're visible
without committing to a specific fix.

### Tasks pane stuck at "Loading tasks…" until manual refresh
Observed 2026-05-23, intermittent. After certain sessions (likely
following an HMR reload while developing other modules, e.g. contacts),
the tasks pane sits on "Loading tasks…" indefinitely and only loads
after the user clicks a per-list / sync-all refresh button — and when
it does load, it reads from etebase rather than the local snapshot, so
the local cache benefit is lost for that session.

**Where the gate lives.** The trigger in
[`MainView.tsx`](src/components/MainView.tsx) (`fetchCollection` trigger
effect, gated on `!hydrated || !activeUid`) only fires after the
disk-hydration effect's `finally` block runs `setHydrated(true)`. If
that `setHydrated(true)` doesn't land for the current mount, the
trigger never fires and only a manual sync recovers (it calls
`fetchCollection` directly, bypassing the gate).

**Likely cause (unconfirmed).** Vite/Tauri HMR + React strict-mode
interaction with the hydration IIFE's `cancelled` flag, where the
`if (!cancelled) setHydrated(true)` guard skips on a mount that's
been logically replaced. Possibly something else upstream — the
contacts module changes that preceded the observation don't touch this
path (lazy-loaded, separate snapshot prefix, no taskstore mutation), so
the contacts work didn't introduce it but may have exposed it via
extra HMR churn.

**Defensive fix sketch.** Add a 2-second safety timeout in the
hydration effect that force-sets `hydrated = true` if the disk pass
hasn't finished by then. Happy path unchanged (the `finally` clears
the timeout); only fires when hydration genuinely stalls. Worst case:
the cold-cache optimisation is skipped and the app falls through to a
normal network sync.
