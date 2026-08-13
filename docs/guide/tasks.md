# Tasks

The tasks module is the heart of ete-sthetic. It renders your VTODO
collections as a real parent/child tree and gives every common operation a
keyboard path.

## Layout

The tasks view (`MainView`) has three panes:

- **Lists sidebar** — your task collections (EteSync "lists"). Each syncs
  independently.
- **Task tree** (`TaskTree`) — the hierarchical task list for the active
  collection.
- **Detail panel** (`DetailPanel`) — full fields for the selected task; opens
  on demand.

## The task tree

Tasks nest via `RELATED-TO;RELTYPE=PARENT`. ete-sthetic builds the tree from
those links (see [`services/tree.ts`](/architecture/services#tree)) and keeps
the hierarchy intact rather than flattening it.

- **Create** — start an inline new task at the top of the active list
  (`Ctrl+N`). Creation is *optimistic*: the row appears immediately and
  reconciles when the write lands.
- **Rename** — edit the summary inline.
- **Complete** — toggling completion cascades a fade over the subtree. Tasks
  that recur roll their due/start date forward instead of expanding into
  separate rows (see [Recurring tasks](#recurring-tasks)).
- **Delete** — also optimistic, with the subtree handled sensibly.

### Reparenting

Move a task around the hierarchy without touching the mouse:

| Key       | Effect                                    |
| --------- | ----------------------------------------- |
| `Alt`+`←` | Outdent (promote to its parent's sibling) |
| `Alt`+`→` | Indent under the previous sibling         |
| `Alt`+`↑` | Move up among siblings                    |
| `Alt`+`↓` | Move down among siblings                  |

You can also **drag and drop** tasks, including **across lists** — a
cross-list move re-homes the task in the target collection.

::: warning Duplicate UIDs
If two items in the same list share a VTODO `UID`, parent/child links (which
reference UIDs) can only resolve to one of them, so the others' nesting is a
best-effort guess. Such nodes are flagged in the UI so the ambiguity is
visible and fixable.
:::

## Priorities

Tasks carry a priority `0–9` (iCalendar `PRIORITY`). With a task selected,
press a number key `0`–`9` to set it directly. Sorting and filtering can key
off priority.

## Sort & filter

- **Sort** (`Ctrl+S`) opens the sort popover for the active list. Comparators
  include due date, priority, creation order, and **manual** order.
  - Manual order is read from `X-APPLE-SORT-ORDER`, the de-facto cross-client
    ordering key (Apple Reminders and friends). It syncs *with the task*, so a
    hand-arranged order follows you across devices. Tasks never manually
    ordered sort to the bottom in creation order.
- **Filter** (`Ctrl+F`) opens the filter popover with its search box focused —
  narrow the current list by text and attributes.

## The detail panel

`Ctrl+E` opens the detail panel for the selected task. Beyond summary and
status it exposes description, due/start dates, priority, percent-complete,
categories, URL, location, classification, and more (see the
[data model](/architecture/data-model#vtodo)).

### Raw iCal editor

If a task's source iCalendar can't be parsed, ete-sthetic keeps the original
text and marks the task **broken**. Rather than lose data, it offers a **raw
iCal editor** so you can fix the underlying item by hand — the raw content is
written back verbatim.

## Recurring tasks

Recurring tasks use a **regenerate-on-complete** model rather than expanding
occurrences as separate rows: completing a recurring task rolls its `DUE`/
`DTSTART` forward to the next occurrence of its `RRULE`. The recurrence logic
lives in [`services/rrule.ts`](/architecture/services). Use the
[recurrence editor](/guide/calendar#recurrence) to set or change the rule.

## Related

- [Keybindings reference](/reference/keybindings)
- [Sync model](/guide/sync) — how list-level syncing is scheduled
- [Search](/guide/search) — find tasks across every list at once
