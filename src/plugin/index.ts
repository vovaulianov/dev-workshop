import type { Plugin } from "vite";
import { jsxSourcePlugin } from "./jsx-source";
import { devApiPlugin } from "./dev-api";

export interface DevWorkshopOptions {
  /**
   * Glob pattern for story files, relative to the project root.
   * @default "src/**\/*.stories.tsx"
   */
  storiesGlob?: string;
}

const VIRTUAL_STORIES = "virtual:dev-workshop/stories";
const RESOLVED_VIRTUAL = "\0" + VIRTUAL_STORIES;

/**
 * One-call setup for the Dev Workshop.
 *
 * Add to vite.config.ts:
 * ```ts
 * import { devWorkshop } from '../packages/dev-workshop/src/plugin'
 * // or, after publishing: import { devWorkshop } from 'dev-workshop/plugin'
 *
 * export default defineConfig({
 *   plugins: [devWorkshop()],
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
  const { storiesGlob = "src/**/*.stories.tsx" } = options;

  const storiesPlugin: Plugin = {
    name: "dev-workshop:stories",
    apply: "serve",

    resolveId(id) {
      if (id === VIRTUAL_STORIES) return RESOLVED_VIRTUAL;
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL) return;
      // This `import.meta.glob` call is resolved by Vite in the consumer
      // project's context — glob is relative to the project root.
      return `export default import.meta.glob(${JSON.stringify("/" + storiesGlob.replace(/^\//, ""))}, { eager: true })`;
    },
  };

  return [jsxSourcePlugin(), devApiPlugin(), storiesPlugin];
}
