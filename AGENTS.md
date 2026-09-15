# AI agent rules for this repo

## Always fetch before implementing changes

This project is developed across multiple machines (tappaou is the primary
implementation machine; takoma and others run the app). Local checkouts go
stale silently.

Before writing or editing any code:

1. `git fetch origin`
2. Compare against the remote: `git rev-list --left-right --count
   main...origin/main` — anything other than `0	0` means the checkout is
   out of sync. Pull (or rebase) and understand the incoming changes first.
3. Never build on a stale checkout, and never assume your local `main` is
   what's on GitHub.

## Working tree etiquette

- Uncommitted work may exist on another machine's checkout. Don't run
  destructive git commands (checkout/restore/reset/clean) on uncommitted
  work — ever.
- Commit only the files relevant to your change; leave unrelated WIP alone.

## Commit discipline

This applies to every GitHub repo, not just this one.

- Split work into **sufficient commits to discern each change's function**:
  one logical change per commit (a fix, a feature, a refactor, a docs
  update), not one giant "did stuff" commit — and not noise-split either.
- Every commit gets a **descriptive title of at most 50 characters**
  (conventional commits: `fix(tasks): …`, `feat(sync): …`,
  `docs(keybindings): …`), **followed by a commit message body** explaining
  what the change does and why. `git commit` without a body is incomplete —
  write the body (heredoc, editor, or `-m -m`), never rely on the title
  alone.

## Branching for large work

- If the requested feature is very large or significantly deviates from
  the original project, **create a feature branch** instead of committing
  to `main` (e.g. `feat/<short-name>`). Small fixes and routine changes go
  straight to `main`.

## Testing

- Typecheck: `npx tsc -b`
- Lint: `npm run lint`
- The app runs in Tauri dev mode (`./start.sh`); verify UI-affecting changes
  in the running app before committing when practical.