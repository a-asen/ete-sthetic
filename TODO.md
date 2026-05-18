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

### 2. `Ctrl+→` while writing a subtask should follow the NEW task
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

### 4. Strictly hierarchical priority sort
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

### 5. Arrow keys in the delete confirm modal — ✅ done
**Task.** `ConfirmModal` only responds to `Tab`; `←/→` do nothing and focus
always starts on Cancel. Keep Tab, add `←/→` to move between buttons.
**Plan.**
- `src/components/ConfirmModal.tsx`: add a keydown handler mapping
  `ArrowLeft`/`ArrowRight` to focus Cancel / Confirm respectively (clamp, no
  wrap). Keep initial focus on the safe action (Cancel) for destructive.

### 6. Clear "writing mode" vs "navigation mode" indicator
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

### 9. Custom accent colour option
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
