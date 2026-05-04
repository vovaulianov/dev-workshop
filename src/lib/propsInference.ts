import type { StoryVariant } from "./storyLoader";

export type Control =
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "select"; options: string[] }
  | { kind: "json" }
  | { kind: "node" };

export interface PropDescriptor {
  key: string;
  control: Control;
  defaultValue: unknown;
  /** Values seen across variants (for hints / select options). */
  seen: unknown[];
}

const IDENTIFIER_RE = /^[a-z][a-z0-9-]*$/i;

function isReactNodeLike(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return false;
  if (Array.isArray(v)) return true;
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    return "$$typeof" in rec || "type" in rec || "props" in rec;
  }
  return false;
}

function inferControl(values: unknown[]): Control {
  const defined = values.filter((v) => v !== undefined);
  if (defined.length === 0) return { kind: "string" };

  if (defined.some(isReactNodeLike)) return { kind: "node" };

  const types = new Set(defined.map((v) => (v === null ? "null" : typeof v)));
  if (types.size === 1 && types.has("boolean")) return { kind: "boolean" };
  if (types.size === 1 && types.has("number")) return { kind: "number" };

  if (types.size === 1 && types.has("string")) {
    const uniq = [...new Set(defined as string[])];
    const allIdentifier = uniq.every((s) => IDENTIFIER_RE.test(s) && s.length <= 32);
    if (uniq.length >= 2 && uniq.length <= 8 && allIdentifier) {
      return { kind: "select", options: uniq };
    }
    return { kind: "string" };
  }

  if (types.has("object")) return { kind: "json" };
  return { kind: "string" };
}

export function inferPropDescriptors(
  variants: StoryVariant[],
  currentArgs: Record<string, unknown>,
): PropDescriptor[] {
  const keys = new Set<string>();
  for (const v of variants) for (const k of Object.keys(v.args)) keys.add(k);
  for (const k of Object.keys(currentArgs)) keys.add(k);

  const descriptors: PropDescriptor[] = [];
  for (const key of keys) {
    const seen: unknown[] = [];
    for (const v of variants) {
      if (key in v.args) seen.push((v.args as Record<string, unknown>)[key]);
    }
    const control = inferControl(seen);
    descriptors.push({
      key,
      control,
      defaultValue: (currentArgs as Record<string, unknown>)[key],
      seen,
    });
  }

  descriptors.sort((a, b) => {
    const rank = (c: Control) =>
      c.kind === "node" ? 3 : c.kind === "json" ? 2 : c.kind === "string" ? 1 : 0;
    const d = rank(a.control) - rank(b.control);
    if (d !== 0) return d;
    return a.key.localeCompare(b.key);
  });

  return descriptors;
}
