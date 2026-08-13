# Keybindings

ete-sthetic is keyboard-first. Two ideas keep that from getting in the way:

- **Bare-letter typeahead** — typing plain letters jumps around the active
  list (type-to-find). Command shortcuts are therefore **`Ctrl`-prefixed** so
  they never collide with typeahead.
- **A rebindable registry** — the `Ctrl`-prefixed *actions* live in a registry
  ([`services/keybindings.ts`](/architecture/services)) and can be remapped in
  the [keybinding editor](/guide/settings#keybindings). The
  values below are the **defaults**.

## Command actions (rebindable)

| Default        | Action              | Description                                         |
| -------------- | ------------------- | --------------------------------------------------- |
| `Ctrl`+`L`     | Focus lists sidebar | Move focus to the lists pane                         |
| `Ctrl`+`T`     | Focus task pane     | Move focus to the task tree                          |
| `Ctrl`+`E`     | Open detail panel   | Open the detail panel for the selected task          |
| `Ctrl`+`F`     | Open filter         | Open the filter popover and focus its search box     |
| `Ctrl`+`Shift`+`F` | Search every list | Open the cross-list global search modal            |
| `Ctrl`+`S`     | Open sort           | Open the sort popover for the active list            |
| `Ctrl`+`Shift`+`S` | Sync active list | Force a sync of the active list                     |
| `Ctrl`+`N`     | New task            | Start an inline new task at the top of the active list |
| `Ctrl`+`M`     | Move task           | Open the move-task picker                            |

::: tip
Open the [keybindings modal](/guide/settings#keybindings) in the app for the
live, up-to-date bindings — including any you've customised.
:::

## Task-tree keys

These operate on the selected task and are not part of the rebindable command
registry.

| Key           | Action                              |
| ------------- | ----------------------------------- |
| `0`–`9`       | Set task priority directly          |
| `Alt`+`←`     | Outdent (reparent up)               |
| `Alt`+`→`     | Indent under previous sibling       |
| `Alt`+`↑`     | Move up among siblings              |
| `Alt`+`↓`     | Move down among siblings            |
| *letters*     | Typeahead — jump to a matching item |

## View / zoom

| Key                        | Action                        |
| -------------------------- | ----------------------------- |
| `Ctrl`/`Cmd`+`+`           | Zoom the focused pane in       |
| `Ctrl`/`Cmd`+`-`           | Zoom the focused pane out      |
| `Ctrl`/`Cmd`+`0`           | Reset the focused pane's zoom  |

Zoom is remembered **per zone**, so each pane keeps its own level.

## Related

- [Settings › Keybindings](/guide/settings#keybindings) — how to rebind
- [Tasks](/guide/tasks) — where most of these keys apply
