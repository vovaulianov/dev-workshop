import type { Plugin } from "vite";
import { jsxSourcePlugin } from "./jsx-source";
import { devApiPlugin } from "./dev-api";

export interface DevWorkshopOptions {
  /**
   * Glob pattern for story files, relative to the project root.
   * @default "src/**\/*.stories.tsx"
   */
  storiesGlob?: string;

  /**
   * Glob pattern for component files used by the "Generate stubs" button
   * in the empty-state UI. The button walks files matching this pattern,
   * skips ones that already have an adjacent `*.stories.tsx`, and writes
   * a stub story for each. Relative to the project root.
   * @default "src/components/**\/*.{tsx,jsx}"
   */
  componentsGlob?: string;
}

const VIRTUAL_STORIES = "virtual:dev-workshop/stories";
const RESOLVED_STORIES = "\0" + VIRTUAL_STORIES;

const VIRTUAL_COMPONENTS = "virtual:dev-workshop/components";
const RESOLVED_COMPONENTS = "\0" + VIRTUAL_COMPONENTS;

/**
 * One-call setup for the Dev Workshop.
 *
 * Add to vite.config.ts:
 * ```ts
 * import { devWorkshop } from 'dev-workshop/plugin'
 *
 * export default defineConfig({
 *   plugins: [...devWorkshop(), react()],
 * })
 * ```
 *
 * Then add the route in your app:
 * ```tsx
 * const DevWorkshopPage = import.meta.env.DEV
 *   ? lazy(() => import('dev-workshop/ui'))
 *   : null
 *
 * // in your router: if (path.startsWith('/dev')) return <DevWorkshopPage />
 * ```
 */
export function devWorkshop(options: DevWorkshopOptions = {}): Plugin[] {
  const {
    storiesGlob = "src/**/*.stories.tsx",
    componentsGlob = "src/components/**/*.{tsx,jsx}",
  } = options;

  const normalize = (g: string): string => "/" + g.replace(/^\//, "");

  const virtualPlugin: Plugin = {
    name: "dev-workshop:virtuals",
    apply: "serve",

    resolveId(id) {
      if (id === VIRTUAL_STORIES) return RESOLVED_STORIES;
      if (id === VIRTUAL_COMPONENTS) return RESOLVED_COMPONENTS;
    },

    load(id) {
      if (id === RESOLVED_STORIES) {
        // Eagerly evaluated — story modules need to be present in the bundle
        // for the workshop to render them.
        return `export default import.meta.glob(${JSON.stringify(normalize(storiesGlob))}, { eager: true })`;
      }
      if (id === RESOLVED_COMPONENTS) {
        // Lazy — we only need file paths (Object.keys) to drive the
        // "Generate stubs" flow. Importing components eagerly would force
        // the consumer to render every default export at startup, which is
        // both wasteful and likely to crash on context-dependent components.
        return [
          `const __components = import.meta.glob(${JSON.stringify(normalize(componentsGlob))});`,
          `export default __components;`,
          `export const componentsGlob = ${JSON.stringify(normalize(componentsGlob))};`,
        ].join("\n");
      }
    },
  };

  return [jsxSourcePlugin(), devApiPlugin(), virtualPlugin];
}
