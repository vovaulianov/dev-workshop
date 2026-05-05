declare module "virtual:dev-workshop/stories" {
  const modules: Record<string, unknown>;
  export default modules;
}

declare module "virtual:dev-workshop/components" {
  /** Map of component file paths → lazy import functions. We only use the
   *  keys (file paths) — the workshop never actually imports user
   *  components from this map; it's just a discovery list. */
  const modules: Record<string, () => Promise<unknown>>;
  export default modules;

  /** Original glob pattern (e.g., `/src/components/**\/*.{tsx,jsx}`),
   *  exposed for user-facing messaging. */
  export const componentsGlob: string;
}
