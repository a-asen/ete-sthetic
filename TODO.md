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

## Polish & fixes (queued 2026-05-18)

### 1. Centre the "add task" affordance
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

### 10. Native-style context menus (replace browser menu)
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

### 11. Drag a task onto a list to move it there
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

### 12. Calendar popover for due / start dates
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

### 13. Optimistic list create/delete with a "syncing" badge
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

### 14. Modal zoom parity + zoom % in settings
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
- [ ] Unified EteSync client (calendar + contacts) —
      [`docs/calendar-contacts-plan.md`](docs/calendar-contacts-plan.md).
- [ ] Tree-UX backlog: cascading completed-fade, per-branch reveal of
      completed subtasks.
