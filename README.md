# dev-workshop

Embedded component explorer for Vite + React projects. Discover stories,
inspect rendered elements, edit `style` props in source, and tweak
design-system CSS variables — all from inside your app at `/dev`.

## Setup

```bash
npm install dev-workshop
```

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { devWorkshop } from "dev-workshop/plugin";

export default defineConfig({
  plugins: [
    ...devWorkshop({ storiesGlob: "src/**/*.stories.tsx" }),
    react(),
  ],
});
```

Mount the page (lazy-loaded, dev-only):

```tsx
import { lazy, Suspense } from "react";

const DevWorkshop = import.meta.env.DEV
  ? lazy(() => import("dev-workshop/ui"))
  : null;

// Wherever you route /dev:
{DevWorkshop && (
  <Suspense fallback={null}>
    <DevWorkshop tokensCssFile="src/index.css" />
  </Suspense>
)}
```

## Story format

Each `*.stories.tsx` file exports a default object and one or more named
story exports:

```tsx
import { Button } from "./Button";

export default { title: "ui/Button", component: Button };

export const Primary = { args: { label: "Continue", variant: "primary" } };
export const Disabled = { args: { label: "Continue", disabled: true } };
```

Stories that match a Storybook CSF v3 file work out of the box — no
adapter needed.

## Configuration

### `devWorkshop(options)` — Vite plugin

| Option | Type | Default | Description |
|---|---|---|---|
| `storiesGlob` | `string` | `"src/**/*.stories.tsx"` | Glob for story files, resolved from project root. |

### `<DevWorkshop />` — React component

| Prop | Type | Default | Description |
|---|---|---|---|
| `tokensCssFile` | `string` | `"src/index.css"` | Path (from project root) to the CSS file containing your `:root` design-token block. The Tokens tab reads/writes this file. |

## Requirements

- **Vite** ≥ 5
- **React** ≥ 18 (tested on 19)
- **Tailwind CSS 4** — the workshop UI is styled with Tailwind utilities
  (including arbitrary-value classes like `text-[#101114]`). Without
  Tailwind 4 + preflight, the page will render unstyled.

## How it works

The plugin contributes three things:

1. **`virtual:dev-workshop/stories`** — a virtual module that runs
   `import.meta.glob(yourGlob, { eager: true })` in the consumer
   project's context. The page imports stories from this module.
2. **`data-devsource` injection** — a JSX transform that adds
   `data-devsource="file:line:col"` to every host element so the
   inspector can map DOM nodes back to source positions. Runs before
   `@vitejs/plugin-react` so the attribute survives the JSX transform.
3. **`/__dev/*` middleware** — `GET /__dev/read` and `POST /__dev/write`
   for direct file access from the browser, plus
   `POST /__dev/patch-style` for AST-aware edits to JSX `style` props.
   All paths are scoped to the project root.

Everything is dev-server only (`apply: "serve"`) — nothing ships to
production.

## Limitations

- Stories are loaded eagerly at startup. A few hundred is fine; a few
  thousand will hurt cold start.
- The style patcher only writes to JSX `style={{ ... }}` props with
  literal keys/values. Spreads and computed values are preserved but
  not editable.
- The Tokens tab assumes a single top-level `:root { ... }` block in
  the CSS file. Nested or scoped tokens are not picked up.
