# Project instructions: dev-workshop

Embedded component explorer for Vite + React projects. Mounts at
`/dev` in the consumer app, discovers `*.stories.tsx` files, and lets
the user inspect, edit `style` props, and tweak design tokens — all
writing back to the consumer project's source files.

## Source of truth

- **[README.md](README.md)** — public-facing setup + usage. If a
  behavior changes, update README too.
- **[package.json](package.json)** — exports map. The four entry
  points (`.`, `./plugin`, `./ui`, `./context`) are the public API.
  Don't break them.

## Core rule

**The package must stay portable.** The whole point is "drop into any
Vite + React project". Anything that couples it to a specific consumer
(hardcoded paths, project-local imports, assumed file names) is a
regression — even if it works in one test project.

## Where to look

| You want to… | Go to |
|---|---|
| Combined Vite plugin entry (`devWorkshop()`) | [`src/plugin/index.ts`](src/plugin/index.ts) |
| `data-devsource` JSX attribute injector | [`src/plugin/jsx-source.ts`](src/plugin/jsx-source.ts) |
| `/__dev/{read,write,patch-style}` middleware | [`src/plugin/dev-api.ts`](src/plugin/dev-api.ts) |
| Client-side fetch wrappers + token utils | [`src/lib/devApi.ts`](src/lib/devApi.ts) |
| Story discovery (pure func over modules map) | [`src/lib/storyLoader.ts`](src/lib/storyLoader.ts) |
| Source-location resolver (DOM → file:line:col) | [`src/lib/fiberUtils.ts`](src/lib/fiberUtils.ts) |
| Props inference from story `args` | [`src/lib/propsInference.ts`](src/lib/propsInference.ts) |
| 3-panel layout, default export | [`src/ui/DevWorkshopPage.tsx`](src/ui/DevWorkshopPage.tsx) |
| Component list (left) | [`src/ui/ComponentSidebar.tsx`](src/ui/ComponentSidebar.tsx) |
| Canvas + ⌘-click select / ⌥-hover distance | [`src/ui/ComponentPreview.tsx`](src/ui/ComponentPreview.tsx) |
| Right panel: Props / Tokens / Code / Element | [`src/ui/StylePanel.tsx`](src/ui/StylePanel.tsx) |
| `style` prop editor for selected element | [`src/ui/ElementInspector.tsx`](src/ui/ElementInspector.tsx) |
| Selection outline overlay | [`src/ui/SelectionOverlay.tsx`](src/ui/SelectionOverlay.tsx) |
| Distance-to-siblings overlay | [`src/ui/DistanceLayer.tsx`](src/ui/DistanceLayer.tsx) |
| Token-autocompleting input | [`src/ui/SmartInput.tsx`](src/ui/SmartInput.tsx) |
| Portal target context (sheet rerouting) | [`src/context/PortalTargetContext.tsx`](src/context/PortalTargetContext.tsx) |
| Virtual module type | [`src/virtual.d.ts`](src/virtual.d.ts) |

## Hard rules

1. **No imports from consumer projects.** All package code lives under
   `src/`. If a piece of logic needs project-specific data (story
   files, CSS file path), pass it via plugin options, virtual modules,
   or React props — never hardcode.
2. **Plugin code is Node.js, UI code is browser.** Files under
   `src/plugin/` may use `node:fs`, `node:path`, `@babel/parser`. Files
   under `src/ui/`, `src/lib/`, `src/context/` must not. The
   `tsconfig.json` includes both, but the boundary is real at runtime.
3. **`apply: "serve"` on every plugin.** Nothing this package
   contributes should ship to production builds.
4. **All file paths route through `inRoot()`** in `dev-api.ts`. Never
   accept a path from the client without verifying it stays inside the
   project root.
5. **Stories are CSF v3 compatible.** A `*.stories.tsx` with
   `export default { title, component }` + named story exports must
   keep working without an adapter. Don't invent a custom format.
6. **`virtual:dev-workshop/stories` is the only way the page gets
   stories.** Adding a direct `import.meta.glob` somewhere bypasses
   the consumer-configurable glob and breaks portability.
7. **The `data-devsource` attribute survives the JSX transform.** The
   plugin must run with `enforce: "pre"` so the attribute is in place
   before `@vitejs/plugin-react` rewrites the tree.
8. **Element selection is ref-stable across HMR.** `DevWorkshopPage`
   re-resolves `selectedEl.element` via the `data-devsource` selector
   when the DOM changes — preserve that behavior.

## Adding a feature

Decision tree:

- **New tab in the right panel** (e.g. "A11y", "Network")? → add to
  `StylePanel.tsx`. Each tab is a self-contained section; copy the
  pattern of the existing ones.
- **New element-level interaction** (e.g. "show grid")? → new overlay
  component under `src/ui/`, mounted from `ComponentPreview.tsx`. Don't
  pile more state into Preview itself.
- **New file operation** (e.g. rename, search)? → endpoint in
  `src/plugin/dev-api.ts` + matching client wrapper in
  `src/lib/devApi.ts`. Always validate the path with `inRoot()`.
- **New story metadata** (e.g. parameters, decorators)? → extend
  `buildComponentEntries()` in `src/lib/storyLoader.ts`. Keep it a
  pure function — easy to test, no Vite coupling.

When extracting a new public surface:

- Add it to `package.json` `exports` AND `files`.
- Update README + this file's "Where to look" table in the same change.

## Things that look like config but aren't

- The `:root { ... }` CSS block parser in `StylePanel`'s Tokens tab
  assumes a single top-level block. Nested or scoped tokens are not
  picked up. If you need that, change the parser deliberately — don't
  silently extend it.
- `patchStyle()` in `dev-api.ts` only writes literal keys/values into
  JSX `style={{ ... }}`. Spreads and computed values are preserved
  but not editable. Don't try to "fix" that without a real plan.

## Tech stack reminders

- **Vite 5+** for the plugin API (`resolveId`/`load`/`transform` and
  middleware via `configureServer`). Don't depend on Vite 6-only APIs
  unless we bump the peer range.
- **React 19** in dev (the package uses `useCallback`/`useEffect`
  patterns); declared peer is `>=18` so consumers on 18 still work.
- **Tailwind 4** in the consumer — the workshop UI uses utility
  classes (`fixed inset-0`, `text-[#101114]`, etc.). Without Tailwind
  the page renders unstyled. Documented in README.
- **`@babel/parser` + `@babel/types`** are runtime deps of the
  plugin (Node.js side). Keep them in `dependencies`, not
  `devDependencies`.
- **No build step.** Consumers import `.tsx` source directly; their
  bundler does the work. Don't add a build pipeline unless we decide
  to ship to npm with compiled output.

## Verification workflow

When you change package code:

- `npm run typecheck` — type-checks both browser and plugin code.
- For runtime: `npm install /abs/path/to/this` in a separate
  Vite + React + Tailwind project, wire up `devWorkshop()` and the
  `/dev` route, write a `*.stories.tsx`, navigate to `/dev`. Click
  through Props / Tokens / Code / Element flows.
- Touch tests:
  - Sidebar shows your component → preview renders → ⌘+click selects
    → right panel switches to "Element" tab.
  - Edit `style` value → file on disk gets patched.
  - Tokens tab → change a `--color-*` → `:root` block in the CSS file
    updates.

## What's out of scope

- Writing a CLI (`npx dev-workshop init`). Setup is two lines of
  config; a CLI would be more code to maintain than to skip.
- Bundling stories from outside the consumer project (e.g. from
  another package's source). Stays single-project for now.
- Production-mode component browsing. The whole package is dev-only
  on purpose; security model assumes a trusted local machine.
