# Search

ete-sthetic has search at two scopes: within the module you're in, and across
everything at once.

## In-module search

- **Tasks** — the [filter popover](/guide/tasks#sort-filter) (`Ctrl+F`)
  narrows the active list as you type.
- **Contacts** — the contact list filters live as you type.

## Global search (within a module)

`Ctrl+Shift+F` opens the **global search modal** (`GlobalSearchModal`) — it
searches **every list in the current module** at once, not just the active
one. For contacts, the equivalent is the cross-book contact search
(`ContactSearchModal`).

## Meta search (across modules)

The **meta search modal** (`MetaSearchModal`, backed by
[`services/metasearch.ts`](/architecture/services)) reaches across **all three
modules** — tasks, events, and contacts — from a single prompt, so you can
jump straight to a result regardless of which module owns it.

## Summary

| Scope                 | Opens                     | Searches                    |
| --------------------- | ------------------------- | --------------------------- |
| Active list           | Filter popover (`Ctrl+F`) | Current list only           |
| Whole module          | Global search (`Ctrl+Shift+F`) | Every list in the module |
| Everything            | Meta search               | Tasks + events + contacts   |

::: tip
Shortcuts are rebindable — the defaults above come from the
[keybindings registry](/reference/keybindings).
:::
