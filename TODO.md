# TODO

Roadmap / backlog for ete-sthetic. Newest asks at the top.
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

### More guidance hints — ✅ infrastructure + first cuts
Add discoverable hints (tooltips / inline tips / a first-run callout)
to surface the keyboard-first features that aren't obvious from looking
at the UI — e.g. `/` to search, `n` to create, `g t` / `g c` / `g k`
for module switching, `Ctrl+Enter` for the detail panel, etc.
**Resolution.** New `services/hints.ts` + `components/Hint.tsx`. The
service exposes `readHintsEnabled` / `setHintsEnabled` (global on/off
under `ete-sthetic.hints.enabled`, default on) and `dismissHint(id)` /
`isHintDismissed(id)` (per-hint under
`ete-sthetic.hints.dismissed.<id>`). Both fire a custom
`HINTS_CHANGED_EVENT` on `window` so subscribers update without
prop-drilling state. The `<Hint id="...">` component renders nothing
when either layer is off, otherwise wraps its children with a
dismiss-`×` that calls `dismissHint`. Two concrete uses landed: an
empty-list card in the tasks pane (`Ctrl+N` to add · `?` for
shortcuts) and an empty-detail card in contacts (`/` to search ·
`Ctrl+L/T/E` to switch zones). The earlier `n` / `g t/c/k` examples
in the original ask aren't wired — bare `n` was removed when shortcuts
were Ctrl-prefixed, and the module-switching chord doesn't exist yet.
Wiring more hints is a paint-by-numbers iteration when other features
need surfacing.

### Hint opt-out — ✅ done
Hints from the above must be possible to disable globally. A toggle in
the settings popover ("Show usage hints") that flips a persisted
boolean, plus a per-hint dismiss (the `×`) that remembers itself.
**Resolution.** Both layers landed with the hints infrastructure above.
"Show usage hints" appears in a new **Help** subsection in BOTH the
tasks `SettingsPopover` and `ContactsSettingsPopover` — toggling
either one fires `HINTS_CHANGED_EVENT` and the other popover's switch
mirrors via a `useEffect` listener, so the on/off state stays in
lockstep across modules. Per-hint `×` is built into the `<Hint>`
component and persists to localStorage so a one-off tip the user has
read doesn't come back next session.

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

### Visible sync status — ✅ done
Currently a tiny `↻` spinner appears on a syncing row and that's it.
Show more: per-book "last synced X ago", a global "all synced" / "1
syncing…" / "1 failed" line, and a clearer affordance after a sync
error (the toast hides quickly). Mirror the tasks sidebar's
sync-all + per-list cadence indicator pattern.
**Resolution (initial cut).** Active book's last-successful-sync time
shows in the contact-list header subtitle as "Synced HH:MM" (absolute
time, no drift). Cycles to "Syncing…" while a sync is in flight and
"Never synced" before the first one ever lands. Persisted via a
`lastSyncedAt: Map<string,number>` in `ContactMemory` so it survives
module switches.
**Resolution (this iteration).** Added `errorByBook: Map<string,
string>` so per-book sync failures linger instead of being clobbered
by the next transient error. The subtitle now appends global tallies:
`· Syncing N others…` (when books besides the active one are mid-
sync, derived from `syncing.size − active-is-syncing`) and
`· N failed` (`text-danger`, with a tooltip pointing the user at the
per-book ⚠ icons). Each book row carries a `⚠` button after its name
when `errorByBook.has(uid)` and it isn't currently syncing; clicking
the warning re-surfaces that book's failure in the main error banner
prefixed with the book name. The warning stays until that book's
next successful `syncBook` (which clears the map entry) — no more
silent failures behind newer ops. Sync-all button + per-book inline
"last synced N ago" stamp deferred (the global tally + active-book
"Synced HH:MM" cover the common cases; a future iteration can add
those if the user finds them missing in practice).

### Adaptive (relative) sync for address books — ✅ done
Contacts currently syncs the active book on open + on the manual
refresh button. Match the tasks module's adaptive cadence: the active
book on a fast interval, other books on a slow one, opening a book
triggers a delta sync only if its snapshot is older than a freshness
window. Configurable from a contacts settings popover.
**Resolution.** Three persisted prefs (`ete-sthetic.contacts.{active,
bg,switchFresh}SyncMin`) with the same option grids the tasks module
uses (active `0,1,5,15,30,60`min · other `0,30,60,240,720,1440`min
· freshness `0,15,30,60,240`min) and the same defaults (5 / 240 / 60).
Two periodic effects run alongside the existing on-mount sync: one
refreshes the active book on the fast cadence, another scans the
other books on the slow cadence and re-syncs any whose `lastSyncedAt`
is older than the window. Both read from `getContactMemory()` rather
than closure state so they don't restart on every `lastSyncedAt`
update. `selectBook` now gates its delta sync on the freshness window
(special-casing "Always" = 0min, cold-cache loads, and the post-
snapshot stamp) so cycling between books doesn't hammer the server
when they're all already fresh. Three labelled selects landed in the
ContactsSettingsPopover under a new "Sync" subsection — widened the
popover from `w-64` to `w-72` to fit them comfortably.

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

### Resizable / zoomable contact panes — ✅ done
The contacts view has fixed widths for the address-book sidebar (w-52)
and the contact list (w-80). Port the tasks/calendar pattern: drag-to-
resize handles between panes, plus per-zone `Ctrl/Cmd +/-/0` zoom with
localStorage persistence. Each of the three zones (address-books /
contact-list / detail) should carry its **own independent** zoom
factor — including the contact list itself — and each should be a
labelled +/-/reset row in a contacts settings popover (mirroring the
matching tasks-pane request under the 2026-05-23 polish block).
**Resolution.** Three independent zoom factors per zone (books / list /
detail), persisted under `ete-sthetic.contacts.zoom.<zone>`, applied
via CSS `zoom` on each pane. `Ctrl/Cmd +/-/0` while the corresponding
zone is focused steps / resets that zone's factor (honored even from
text inputs, like the tasks module). Drag-to-resize handles sit on
the right edge of the books and contact-list panes — accent strip on
hover, solid while dragging, clamps `[140,360]px` for books and
`[220,600]px` for the list (defaults `208px` / `320px` to match the
former `w-52` / `w-80`); detail fills the remaining space. The handle
`stopPropagation`s its `onMouseDown` so it doesn't trip the zone's own
focus-zone click. New `ContactsSettingsPopover` (gear button in the
contact-list header) holds the three +/-/reset zoom rows — a narrow
component for now, designed to grow when adaptive-sync cadence lands.
Owns its own Esc / click-away dismissal mirroring the tasks
`SettingsPopover`.

### Zone meta-navigation + cross-zone fade — ✅ done
Ctrl+←/→ (or even bare ←/→ from the address-book list) should walk
between the three zones (address-books ↔ contacts ↔ detail), and the
out-of-focus zones should fade like they do in the tasks module. Today
the contacts view has no `focusZone` concept and all three panes stay
fully opaque regardless.
**Resolution.** Added `ContactsFocusZone = 'books' | 'list' | 'detail'`
to `ContactsView`. State persists under `ete-sthetic.contacts.focusZone`
so a module switch or remount lands where the user left off. The same
Ctrl-prefixed shortcuts the tasks module uses now work here:
`Ctrl+L`/`Ctrl+T`/`Ctrl+E` jump directly to a zone, `Ctrl+→` and
`Ctrl+←` step through them (clamping at the ends and yielding to native
word-jump inside text fields). The address-books arrow-nav was wired up
too — when `focusZone === 'books'`, `↑/↓` page through books via
`selectBook`; otherwise they walk the contact list as before. Each
zone applies an `opacity-{100|30|40}` class with a 300ms transition
(`opacity-30` for books/list, `opacity-40` for detail — same numbers as
MainView/DetailPanel). Each zone's outermost element catches
`onMouseDown` and sets the focus zone, so click-to-focus works without
hijacking inner controls. Bare `←/→` from the books pane was
intentionally skipped — `Ctrl+→` is the unambiguous path and adding a
bare-arrow stepper would have to fight with the future left-arrow
"collapse" semantics tracked under the tree-UX backlog.

## Polish & fixes (queued 2026-05-23)

### Make all keyboard shortcuts Ctrl-prefixed — ✅ done
Bare-letter shortcuts (`n` new, `f` filter, `s` sort, `m` move, `t` jump
to tasks, etc.) collide with the sidebar/task-list typeahead — typing a
letter is ambiguous between "shortcut" and "jump to the item whose name
starts with that letter." Standardise: every command shortcut becomes
`Ctrl/Cmd+<letter>`, freeing bare letters entirely for typeahead. The
existing typeahead in `MainView` (`taskTypeaheadRef`, `listTypeaheadRef`)
already works — just stop competing with it. Update `KeybindingsModal`
to reflect the new bindings.
**Resolution.** `MainView` now exposes `Ctrl+L` (focus lists), `Ctrl+T`
(focus tasks), `Ctrl+E` (open details) alongside the already-existing
`Ctrl+N` / `Ctrl+M` / `Ctrl+S` / `Ctrl+F`; the bare-letter handlers
(`l/t/e/m/s/n/f`) were removed. `CalendarView` converts `t` (today) and
`n` (new event) to their Ctrl counterparts (the digit 1–5 view switcher
stays — digits don't compete with typeahead). `ContactsView` converts
`n` (new contact) to `Ctrl+N`, kept `/` for search and Enter for opening
a contact; the contact list also moved its `typing` bail-out below the
Ctrl+N handler so the shortcut works even when the search box has
focus. Tooltips ("New list (n)", "Focus list selection (l)", "Filter
(f)", "New contact (n)") updated; the "Select a contact … press n" hint
on the empty contact pane was changed to `Ctrl+N`. `KeybindingsModal`
rewritten: every command row is now Ctrl-prefixed, a new "Tasks" group
calls out typeahead in both zones, and a navigation row documents
`Ctrl+E` / `Ctrl+→` / `Ctrl+Enter` / `Ctrl+←` zone-stepping. Unblocks
the `Ctrl+M` stay vs `Ctrl+Shift+M` follow split below.

### Move shortcut: `Ctrl+M` moves, `Ctrl+Shift+M` moves + follows — ✅ done
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
**Resolution.** Added `follow: boolean` to `MovePayload` and gated the
post-success `setActiveUid(destUid) + setSelectedTaskUid(rootVtodoUid)`
on it. Stay mode clears `selectedTaskUid` rather than leaving the now-
gone uid dangling — arrow nav recovers cleanly from there. The
destination's in-memory items still get spliced in either way, so the
list is pre-warmed when the user does switch over manually. Keyboard:
the existing Ctrl+M handler reads `e.shiftKey` (already reaches with
shift held since the modifier bail-out runs later in the effect). Other
callers: the right-click "Move to another list…" defaults to stay (the
common case); drag-to-list keeps follow because the user's pointer
destination *is* the goal. `KeybindingsModal` now lists both as
separate rows.

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
  slice, its own `ete-sthetic.zoom.<zone>` localStorage key, and the
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
- **Follow-up done.** `SettingsPopover` now has a "Zoom" subsection
  with three labelled +/-/reset rows — Sidebar zoom, Task pane zoom,
  Detail zoom — wired through `onSidebarZoom` / `onZoom` /
  `onDetailZoom` to `adjustZoom(<zone>, …)`. The previous standalone
  "Task card size" row was retired; its function lives in the new
  three-row block.

### Alt+←/→ to indent / outdent a task — ✅ done
**Task.** Either Alt or Shift on the arrow keys should reparent a task
in the tree: Alt+→ indents (becomes a child of the previous sibling),
Alt+← outdents (becomes a sibling of the current parent). Alt+↑/↓
sibling reorder is intentionally deferred since it needs the per-list
manual-order store tracked elsewhere.
**Resolution.** Modifier scoped to **Alt only** (Shift stays free for
future selection-extension bindings). New `findParentAndSiblings`
helper in [`src/services/tree.ts`](src/services/tree.ts) returns
`{ parent, siblings, index }` for any uid in the tree (parent=null for
a root). The keybindings effect in
[`MainView.tsx`](src/components/MainView.tsx) handles Alt+← /
Alt+→ on the selected task: outdent computes the grandparent and
saves `{ parentUid: grandparent?.uid ?? null }`; indent reads the
previous visible sibling and saves `{ parentUid: prevSibling.uid }`.
Both reuse `handleSaveDetails`'s optimistic + rollback path. No-ops
gracefully (already root for outdent, first sibling for indent).
Scoped to the tasks zone and skipped inside text fields so it doesn't
fight native Alt+arrow word-jump.
**Implementation note.** `handleSaveDetails` is defined after the
keybindings effect, so a `handleSaveDetailsRef` forward-ref bridges
them (synced via an effect after `handleSaveDetails` lands). Avoids
both a TDZ ReferenceError and a re-subscription on every
`handleSaveDetails` identity change.

### Alt+↑/↓ to reparent across adjacent branches — ✅ done
**Task.** Under priority sort, Alt+↑/↓ on a subtask should move it to
the previous/next *parent* in the tree, changing only the hierarchy
(not the priority that drives sort order). Sibling reorder remains
deferred behind the manual-order store.
**Resolution.** Added a third arm to the existing Alt+arrow block in
[`MainView.tsx`](src/components/MainView.tsx). For the selected task
it looks up its parent's location via `findParentAndSiblings`, then
re-points `parentUid` at `parentLoc.siblings[parentLoc.index ± 1]`
— last child of the previous branch on Alt+↑, first child of the
next branch on Alt+↓. No-ops for a root (no parent to step) and at
the ends of the parent's sibling row. Position within the destination
is decided by the active sort comparator, so under priority sort the
moved row slots in by its existing priority — the hierarchy changes,
the sort key doesn't. UX caveat shared with Alt+→: if the destination
parent is collapsed in TaskTree, the moved row disappears until the
user expands it.

### Ctrl+Shift+S to force sync every list — ✅ done
**Task.** A keyboard equivalent of the sidebar "sync all lists"
button: force a sync of every list now, bypassing the per-list
staleness/freshness windows.
**Resolution.** `Ctrl+Shift+S` calls `syncAll()` directly. The
existing `Ctrl+S` handler (sort popover) now gates on `!e.shiftKey`
so the Shift variant doesn't fall through. The same spinners as the
toolbar sync-all button light up (per-row + aggregate count).

## Backlog (queued 2026-05-23 — batch 2)

### Ctrl+←/→ should not exit an in-progress task name — ✅ done
**Task.** After `Ctrl+N` opens the inline new-task input, pressing
`Ctrl+←` or `Ctrl+→` while typing the name jumps the focus zone
(meta-nav) instead of staying inside the input. The user should
have to commit (`Enter`) or cancel (`Esc`) the create first; zone
meta-nav should only fire once writing is done.
**Resolution.** Root cause wasn't the global `inTextField` check —
that was already correctly catching `HTMLInputElement` and bailing
out. The culprit was `InlineCreate`'s own keydown handler in
[`TaskTree.tsx`](src/components/TaskTree.tsx):
- The Ctrl+→ commit-and-follow branch fell through to `onCancel()`
  when the input was empty, destroying the draft.
- The bare ArrowLeft branch had no modifier guard, so
  Ctrl+ArrowLeft on an empty input also triggered `onCancel()`.
Both made the input vanish + selection shift, which read as a zone
jump from the user's seat. Fix: Ctrl+→ no-ops on an empty input
(lets native word-jump handle it instead of cancelling), and the
ArrowLeft cancel branch now gates on `!e.ctrlKey && !e.metaKey` so
Ctrl/Cmd-ArrowLeft is always native word-jump regardless of input
contents. QuickAdd was already correct (no cancel on empty Ctrl+→,
no ArrowLeft branch at all).

### Open `.ics` files in ete-sthetic → one-click add to calendar
**Task.** Register ete-sthetic as a handler for `.ics` /
`text/calendar` files so a double-click anywhere (file manager,
browser download, "Open with" from a mail client) opens the app
with an "Add to calendar" prompt instead of dropping the file in
some other calendar app or doing nothing.
**Plan.**
- Tauri side:
  - Linux: ship a `.desktop` file with
    `MimeType=text/calendar;` + `%f`/`%U` argv and a handler
    binary entry. Optional helper for `xdg-mime default` on first
    run (with the user's consent).
  - macOS: `Info.plist` `CFBundleDocumentTypes` claiming the
    `com.apple.ical.ics` UTI.
  - Windows: registry `HKCR\.ics` + `HKCR\ete-sthetic.ics\shell\
    open\command` entries written by the installer (or a one-off
    "Set as default" button in settings).
- App side: parse the first argv (or the `tauri://file-open`
  event) for an `.ics` path on launch. Read the file, run it
  through the same `ical.js` import path the future Mail
  Accept-invite flow uses, then show a small confirm dialog:
  "Add 'Sprint planning' to <calendar dropdown>?" → writes the
  VEVENT via `services/etebase.ts::createCalendarItem` and
  navigates to the day so the user sees the result.
- Multi-event `.ics` (full calendar export, not a single invite):
  prompt "1 event" vs "N events — import all to <calendar>?" so
  a 500-event export doesn't import silently.
- If a VEVENT with the same UID already exists, replace it (this
  is the iTIP UPDATE semantic) rather than duplicate; surface
  "Updated existing event" in the confirm.

### Quick-add VEVENTs from mail invites (without the full Mail module)
**Task.** Even before the proposed Mail module lands, give users
a fast path to drop an invite into the calendar from whatever
mail client they're already using. Mail invites are by far the
most common source of VEVENTs and worth a shortcut today.
**Plan.** Three lightweight surfaces, any of which can land
independently of the Mail module:
- **Drag-and-drop target.** The calendar view becomes a drop
  target for `.ics` files (HTML5 DnD `dataTransfer.files`).
  Reuses the same import path as the `.ics` association above.
- **Paste-to-import.** A "Paste invite (.ics)" item in the
  calendar new-event popover that opens a textarea — paste the
  raw VCALENDAR block (right-click → "View source" in most mail
  clients, or copy from the `.ics` attachment), Import button
  parses and writes. Cheaper than DnD for headless / SSH'd
  Linux setups.
- **OS share / "Open with" handler.** Falls out of the
  `.ics`-association work above for free on macOS/Linux; on
  Windows the installer entry covers it.
- All three converge on the same import helper
  (`services/icsImport.ts`?) so the Mail module's Accept-invite
  flow can reuse it 1:1 when that lands. De-dupe on VEVENT UID
  the same way (an invite UPDATE replaces; a fresh REQUEST
  inserts).

### Custom Etebase server URL
**Task.** Let users point ete-sthetic at their own Etebase server
instead of the hard-coded default (self-hosted Etebase forks /
non-etebase.com deployments).
**Plan.**
- Add a "Server" field to the login screen (already the natural
  surface — users hit it before any URL is needed). Default is the
  current hard-coded host shown as a placeholder.
- Persist under `ete-sthetic.etebase.serverUrl`; read it in
  `services/etebase.ts` instead of the constant when constructing
  `Account.login` / `Account.signup`.
- Validate `URL` parsing + `http(s)` scheme client-side before
  submit; surface server errors inline on auth failure.
- One-time migration: if no key is set, write the current default
  on first login so existing users see it pre-filled.

### Disable individual modules
**Task.** Some users only want a subset (tasks only, or
tasks + contacts but no calendar, etc.). Let each module be turned
off so its switcher button hides and its background sync stops
running.
**Plan.**
- Four booleans `ete-sthetic.modules.{tasks,calendar,contacts,mail}
  .enabled` (default on). Toggle row per module in a new "Modules"
  subsection of the global settings popover.
- `App.tsx` reads the flags and conditionally renders each switcher
  button + lazy module. The active module stays selected if its flag
  goes off mid-session — fall back to the first enabled one (or an
  empty-state if none).
- Disabled modules don't run their adaptive sync timers (gate the
  effects in each `*View` on the flag). The on-disk snapshot stays
  put so re-enabling is instant.

### Move logout to the settings menu — ✅ done
**Task.** Logout currently sits at a high-visibility surface
(bottom-left of the sidebar). Move it into the settings popover so
the persistent sidebar real estate goes to navigation only.
**Resolution.** `onLoggedOut` is now passed through `App.tsx` to all
three module views (`MainView` / `CalendarView` / `ContactsView`);
each owns its own `handleLogout` that calls `etebase.logout()` then
`onLoggedOut()`. All three settings popovers
(`SettingsPopover` / `ContactsSettingsPopover` /
`CalendarSettingsPopover`) gained an `onLogout` prop and render an
"Account" subsection (separator + uppercase header) with a full-width
"Sign out" button at the bottom — so logout is reachable from any
module's settings. The sidebar logout button + its containing footer
div in `MainView` are gone, freeing that real estate.

### Module: Mail (proposed)
**Task.** A minimal mail client whose **primary job is surfacing
iTIP invitations** (`.ics` attachments with `METHOD:REQUEST`) so
they can be accepted straight into the calendar module in one
click. Reading regular mail is a bonus; rich features
(threading, search, HTML rendering, attachments beyond `.ics`)
are explicitly **out of scope for v1**.

**Compatibility.** Standard IMAP (read) + SMTP (send REPLY) so it
works with any provider that exposes them — Gmail (app password),
iCloud, Fastmail, self-hosted Dovecot/Postfix, Outlook /
Office365 (app password or basic IMAP; OAuth is v2). Outlook *the
desktop client* isn't a server — what we're really matching is
"any IMAP-reachable mailbox", which Outlook.com mailboxes are.

**Plan (v1 — minimum useful).**

*Storage / transport.*
- Tauri Rust backend gains two crates: `async-imap` (read) and
  `lettre` (send). Expose Tauri commands:
  `mail_login(account_id)`, `mail_list_folders(account_id)`,
  `mail_fetch_envelopes(account_id, folder, limit, since_uid?)`,
  `mail_fetch_body(account_id, folder, uid)`,
  `mail_send(account_id, raw_mime)`,
  `mail_set_flag(account_id, folder, uid, flag, set)`.
- Credentials stored in OS keychain via the `keyring` Rust crate
  (never localStorage). Account metadata (host, port, username,
  display name) in a JSON file in the app data dir — small enough
  not to need etebase round-tripping.
- Frontend `services/mail.ts`: thin wrappers around the Tauri
  commands; cold-cache snapshot of envelopes per folder
  (`mailsnapshot.ts`) mirroring `calendarsnapshot.ts`.

*iTIP detection.*
- When fetching a message body, walk MIME parts for
  `text/calendar` or `application/ics`. Parse with the `ical.js`
  already used by the calendar/contacts modules.
- Tag the envelope in the snapshot: `kind: 'invite' | 'reply' |
  'cancel' | 'normal'` based on the inner VCALENDAR's METHOD
  property.

*UI module.*
- New `MailView.tsx` modelled after `ContactsView`: three-pane
  layout (accounts/folders sidebar · message list · message
  detail), per-zone zoom + drag-resize + focus zone, same
  Ctrl+L/T/E navigation.
- List header has a filter chip defaulting to **"Invitations"**
  so the v1 use case is one click away; "All" shows everything.
- Invite detail pane shows organizer / time / location /
  description + **Accept / Decline / Tentative** buttons.
  Accept: writes the VEVENT into the user's default calendar via
  `services/etebase.ts::createCalendarItem`, updates the
  invite's PARTSTAT, sends a METHOD:REPLY back to the ORGANIZER
  via SMTP, and marks the mail `\Seen`.
- Reuse `Hint`, `ContextMenu`, drag-resize handles, settings
  popover patterns from the existing modules.

*Auth UX.*
- Per-account login flow: server (autodetected from email domain
  via well-known autoconfig endpoints for common providers,
  fallback to manual host/port + TLS toggle) + username +
  password / app password.
- **OAuth (Gmail / Microsoft Identity) is v2.** v1 ships
  IMAP/SMTP + app passwords only, keeps the surface small, and
  defers Office365 modern-auth restrictions to that round.

*Settings.*
- "Mail" subsection in the global settings popover: add /
  remove accounts, set the **default calendar** that Accept
  writes to, poll interval (mirrors the contacts adaptive-sync
  prefs grid: 0/1/5/15/30/60 min active, etc.).

*Out of scope for v1.*
- Compose (beyond the auto-generated METHOD:REPLY for RSVP),
  drafts, threading, search, HTML rendering, non-`.ics`
  attachments, multi-account merged inbox, IMAP IDLE push
  (polling on the contacts cadence is fine).

*Open questions / risks.*
- **Keychain on Linux.** The `keyring` crate uses Secret Service
  / DBus which works on most desktops but not in headless /
  remote setups. Document fallback: env-var or one-shot
  passphrase prompt that doesn't persist.
- **Office365 basic-auth deprecation.** Many orgs disable
  password-based IMAP. v1 explicitly says "needs an app
  password; OAuth in v2."
- **Duplicate VEVENT on Accept.** If the user already imported
  the `.ics` manually before clicking Accept, the calendar would
  get two. Mitigation: de-dupe by VEVENT `UID` before insert —
  iTIP invitations carry the canonical UID, and idempotent
  inserts already exist in the calendar module's helpers.
- **Sent-folder write.** SMTP doesn't append to Sent; we'd need
  to IMAP-APPEND the sent REPLY into the configured Sent folder
  (autodetect via the IMAP `SPECIAL-USE` extension, fallback to
  the literal "Sent" name).

**Dependency on the other batch-2 items.** "Disable individual
modules" is a prerequisite if shipping Mail by default — users
who never wanted a mail client should be able to turn it off.

## Backlog (queued 2026-05-24)

### Moved/indented task: highlight follows to the parent when the row is hidden
**Task.** When a task is reparented (Alt+→ indent, Alt+↑/↓ cross-branch
reparent, drag/move-pick into a collapsed branch) and the moved row
ends up hidden — destination parent is collapsed, or the moved item
is now a child under a collapsed ancestor — the selection silently
drops because `selectedTaskUid` points at an invisible row. Instead,
the highlight should walk up to the nearest *visible* ancestor (the
new parent, or its visible ancestor) so the user still has a clear
"this is where it went" anchor and arrow-nav has a sensible home.

### Shift+Tab in the confirm modal escapes instead of cycling — ✅ done
**Task.** `ConfirmModal` traps `Tab` between Cancel and Confirm, but
`Shift+Tab` exits the modal entirely (focus lands somewhere behind
it). It should mirror `Tab` — cycle backward between the two buttons.
Also covered: `←/→` already cycle, so this is purely the reverse-Tab
case in the keydown handler.
**Resolution.** The toggle logic already covered both directions
(`e.key === 'Tab'` matches Shift+Tab too, and with two buttons "toggle
= cycle"), but the listener was registered in the bubble phase so
the browser's native Tab focus-move (the keydown's default action)
could win on platforms where focus advances mid-dispatch. Switched
the `window.addEventListener('keydown', …)` to capture phase
(`{ capture: true }`) so `preventDefault` runs before any other
handler in the chain and focus stays trapped between Cancel/Confirm
in both directions.

### Global "Synced Xs ago" status in the top-right
**Task.** The design mock shows a small "● Synced 14s ago" line in the
top-right of the window — a single at-a-glance indicator that the
whole app is up to date. We already track per-list sync timestamps
(`lastSuccessfulSyncAt` in taskstore / `lastSyncedAt` in
ContactMemory) and per-list spinners; this would be the global rollup.
**Plan sketch.**
- Pick the *oldest* successful sync across all visible collections
  (tasks lists + calendars + address books) → that's the "synced N
  ago" age. If anything is currently syncing, show "Syncing…" instead;
  if anything failed since its last success, show "N failed" in the
  danger colour with a tooltip pointing at the offending sidebar row.
- Mounts in the top toolbar (window-level, not per-module) so it's
  the same widget whether the user is on Tasks / Calendar / Contacts.
- Updates the relative time on a 30s tick (use the same pattern as
  the contacts header subtitle, but relative — "14s ago" / "3m ago"
  — rather than absolute "HH:MM"). Hovering shows the absolute
  timestamp.
- Clicking the indicator triggers a sync-all across every module
  (reuse the existing `syncAll()` in tasks; mirror in calendar /
  contacts).

### Remember per-list cursor position when switching lists — ✅ done
**Task.** Today, switching away from a list and back resets the
selection (typically to the first task). Persist the
`selectedTaskUid` per collection so returning to e.g. "Dailies"
lands on the row the user was last on. Forget the entry if that uid
no longer exists in the list (deleted / moved away) — fall back to
the first task in that case. Probably a `Map<collectionUid, uid>`
in `MainView` state, persisted to localStorage under
`ete-sthetic.tasks.lastSelected`.
**Resolution.** Added `lastSelectedByCollection: Map<string, string>`
to `TaskMemory` (`taskstore.ts`), persisted to localStorage under
`ete-sthetic.tasks.lastSelected` (JSON-serialised
`Object.fromEntries`). New `rememberLastSelected(colUid, taskUid)`
helper flushes the in-memory map + storage on each save; `null`
forgets the entry. `MainView` adds two effects gated on a
`prevActiveUidRef`: on `activeUid` change, restore the saved
selection from the map; on `selectedTaskUid` change while
`activeUid` is stable, persist the current selection. The save
effect skips null selections so a deleted-task-then-list-switch
doesn't wipe out the saved position. Stale uids (task deleted in
another session) fall through to the existing `focusTasks` validation
which already falls back to the first visible task. `resetTaskMemory`
clears both the in-memory map and the localStorage key on logout.

## Contacts polish (queued 2026-05-24)

### BDAY rendered as raw `YYYYMMDD` — ✅ done
**Task.** The contact card shows `BIRTHDAY 19991022` — the raw vCard
`BDAY` value (`YYYYMMDD`, no separators) is being printed as-is.
Format it the same way other dates are shown elsewhere in the app
(e.g. `1999-10-22` or `22 Oct 1999`). Likely a `formatVcardDate`
helper in `services/vcard.ts` or inline in `ContactsView.tsx` where
BDAY is rendered. Be tolerant of vCard 3.0 `YYYY-MM-DD` *and*
vCard 4.0 `YYYYMMDD` / partial dates (`--MM-DD` for "month + day,
no year") — the parser already preserves the raw value, the display
just needs to normalise it.

### Ctrl+F focuses the contacts search bar — ✅ done
**Task.** The tasks module's `Ctrl+F` focuses the filter input; the
contacts module should mirror this and focus the contact-list search
bar. Today `Ctrl+F` either does nothing or hits the browser find
dialog. Add a keydown handler in `ContactsView` that calls
`preventDefault` + focuses the search input ref (the `/` shortcut
already does this — Ctrl+F just needs to share the path).
**Resolution.** New handler in `ContactsView`'s keydown effect that
catches `(Ctrl|Cmd)+F`, calls `preventDefault`, focuses the
`searchRef`, and selects its current text (so the user can replace
the filter in one keystroke). Honored even from inside text fields
so jumping back to the search bar from the editor works.

### Detail / contact-list fade too aggressive when not focused — ✅ done
**Task.** Today the inactive-zone fade in contacts is `opacity-30`
(books / list) and `opacity-40` (detail) — the same numbers the
tasks module uses. The contacts panes contain dense text (emails,
phones, addresses) where 30 % is too washed-out to read while
keyboard-driving from another zone. Bump the inactive opacities
up a notch — try `opacity-60` for the list and `opacity-70` for
the detail card, keeping books at 30 since it's a low-information
strip. Apply the same easing already on the class.
**Resolution.** Contact list `opacity-30 → opacity-60`; detail
`opacity-40 → opacity-70`; books left at `opacity-30` per the plan
(it's a thin strip of book names, not dense content).

### Bigger resize-handle hit area — ✅ done
**Task.** The drag-to-resize edges between contact panes (and the
sidebar in tasks) are `w-1.5` (6 px) wide, which is fiddly to grab
with a mouse. Bump the hit area to `w-2.5` or `w-3` (10–12 px) so
it's easier to find, while keeping the *visible* line a single
1 px stroke (the inner `<div className="w-px ...">` stays). Apply
to all four handles: tasks-sidebar, contacts-books, contacts-list,
and the detail panel's left edge.
**Resolution.** `w-1.5 → w-2.5` (6 → 10 px) across all five sites:
tasks sidebar (`MainView.tsx`), tasks detail (`DetailPanel.tsx`),
contacts books + contacts list (`ContactsView.tsx`), and the
calendar sidebar (`CalendarSidebar.tsx`) — caught the calendar one
too since it shares the pattern. Inner `w-px` stroke unchanged.

## Known issues

Things that have been observed misbehaving but haven't been root-caused
yet. These get tracked here (not in the polish queue) so they're visible
without committing to a specific fix.

### Tasks pane stuck at "Loading tasks…" until manual refresh — ✅ defensive fix shipped
Observed 2026-05-23, intermittent. After certain sessions (likely
following an HMR reload while developing other modules, e.g. contacts),
the tasks pane sits on "Loading tasks…" indefinitely and only loads
after the user clicks a per-list / sync-all refresh button — and when
it does load, it reads from etebase rather than the local snapshot, so
the local cache benefit is lost for that session.

**Where the gate lived.** The trigger in
[`MainView.tsx`](src/components/MainView.tsx) (`fetchCollection` trigger
effect, gated on `!hydrated || !activeUid`) only fires after the
disk-hydration effect's `finally` block runs `setHydrated(true)`. If
that `setHydrated(true)` didn't land for the current mount, the
trigger never fired and only a manual sync recovered (it calls
`fetchCollection` directly, bypassing the gate).

**Likely cause (unconfirmed).** Vite/Tauri HMR + React strict-mode
interaction with the hydration IIFE's `cancelled` flag, where the
`if (!cancelled) setHydrated(true)` guard skipped on a mount that had
been logically replaced. Possibly something else upstream — the
contacts module changes that preceded the observation don't touch this
path (lazy-loaded, separate snapshot prefix, no taskstore mutation), so
the contacts work didn't introduce it but may have exposed it via
extra HMR churn.

**Defensive fix.** Added a 2-second safety timeout in the hydration
effect that force-sets `hydrated = true` if the disk pass hasn't
finished by then. Happy path unchanged (the `finally` clears the
timer; the cleanup return also clears it on unmount). When the safety
timer does fire, we skip the cold-cache optimisation for that session
and fall through to a normal network sync — the "Loading tasks…" line
clears within 2s no matter what, and `fetchCollection` populates the
items the same way a manual refresh would. Root cause not pinpointed,
but the symptom can no longer leave the pane stuck.
