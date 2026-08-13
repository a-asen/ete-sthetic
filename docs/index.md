---
layout: home

hero:
  name: ete-sthetic
  text: An aesthetic, keyboard-first EteSync client
  tagline: >-
    Tasks, calendar, and contacts in one small native window — with a task
    tree that stays a tree.
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: Install & run
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/a-asen/ete-sthetic

features:
  - icon: ✅
    title: Tasks that nest
    details: >-
      A faithful parent/child VTODO tree with inline rename, optimistic
      create/delete, cross-list drag, Alt-arrow reparenting, and priority
      hotkeys. No flattening.
    link: /guide/tasks
    linkText: Tasks guide
  - icon: 📅
    title: Full calendar
    details: >-
      Month, week, day, and year views with recurring events (RRULE),
      scope-aware edits, conflict resolution, alarms, and ICS import.
    link: /guide/calendar
    linkText: Calendar guide
  - icon: 👤
    title: Contacts done right
    details: >-
      Address books with a hand-rolled vCard 3.0/4.0 parser that preserves
      unmodelled fields verbatim across an edit — photos and X-props included.
    link: /guide/contacts
    linkText: Contacts guide
  - icon: 🔁
    title: Adaptive sync
    details: >-
      The active collection syncs on a fast cadence, others slow; opening a
      stale collection delta-syncs it. Cold-start reads come from a disk cache.
    link: /guide/sync
    linkText: How sync works
  - icon: ⌨️
    title: Keyboard-first
    details: >-
      Bare-letter typeahead that Ctrl-prefixed shortcuts never fight, plus a
      fully rebindable action registry.
    link: /reference/keybindings
    linkText: Keybindings
  - icon: 🦀
    title: Small native shell
    details: >-
      Tauri 2 + React 19 + TypeScript. A ~10 MB binary instead of a bundled
      browser, with an encrypted local session.
    link: /architecture/overview
    linkText: Architecture
---
