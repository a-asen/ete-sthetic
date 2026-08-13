# Contributing

ete-sthetic is a personal hobby project, but the setup is standard.

## Getting set up

Follow [Install & run](/guide/getting-started) for the toolchain
(Node 22+, Rust 1.77+, Linux WebKit deps) and:

```bash
npm install
npm run tauri dev
```

## Before you push

```bash
npm run lint     # ESLint
npm run build    # tsc -b + vite build (type-check the whole app)
```

::: warning Verify with the real bundler
`tsc` can pass while Vite's `oxc` parser rejects the same JSX. If you change
components, confirm the change under `npm run tauri dev` (or `npm run build`),
not `tsc` alone.
:::

## Keeping the knowledge graph current

This repo carries a [graphify](https://github.com/) knowledge graph in
`graphify-out/`. After changing code, refresh it:

```bash
graphify update .   # AST-only, no API cost
```

For code questions, prefer `graphify query "<question>"` over broad grep — it
returns a scoped subgraph. See `CLAUDE.md` for the project conventions.

## Where things live

| You want to…                     | Look at                                    |
| -------------------------------- | ------------------------------------------ |
| Change UI                        | `src/components/`                           |
| Change sync / parsing / logic    | `src/services/` ([Services](/architecture/services)) |
| Add an OS capability             | `src-tauri/capabilities/default.json` ([Tauri shell](/architecture/tauri-shell)) |
| Understand a type                | `src/types.ts` ([Data model](/architecture/data-model)) |
| Track the backlog                | [`TODO.md`](https://github.com/a-asen/ete-sthetic/blob/main/TODO.md) |

## Documentation {#documentation}

The docs are a [VitePress](https://vitepress.dev/) site under `docs/`.

```bash
npm run docs:dev      # local preview, hot reload
npm run docs:build    # build into docs/.vitepress/dist
npm run docs:preview  # serve the production build
```

### Structure

```
docs/
├── .vitepress/config.ts   # nav, sidebar, theme, base path
├── index.md               # home page
├── guide/                 # user-facing guides (one per module + cross-cutting)
├── architecture/          # how it's built
├── reference/             # keybindings, FAQ
└── *.md                   # design notes (calendar/contacts plans, roadmap)
```

### Publishing

Pushing to `main` runs `.github/workflows/deploy-docs.yml`, which builds the
site and deploys it to **GitHub Pages** at
<https://a-asen.github.io/ete-sthetic/>. There's nothing to do by hand.

::: tip One-time Pages setup
In the GitHub repo, go to **Settings → Pages → Build and deployment** and set
**Source** to **GitHub Actions**. The workflow does the rest.
:::

When you add a page, wire it into the sidebar in
`docs/.vitepress/config.ts`. The `base` there is `/ete-sthetic/` because Pages
serves this as a project site — don't remove it.
