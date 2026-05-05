export interface ReadFileResponse {
  content: string;
  absPath: string;
}

export async function readFile(file: string): Promise<ReadFileResponse> {
  const res = await fetch(`/__dev/read?file=${encodeURIComponent(file)}`);
  if (!res.ok) {
    throw new Error(`read failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function writeFile(
  file: string,
  content: string,
): Promise<{ ok: true; absPath: string }> {
  const res = await fetch("/__dev/write", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, content }),
  });
  if (!res.ok) {
    throw new Error(`write failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function patchStyle(args: {
  file: string;
  line: number;
  column: number;
  /** `null` value = remove that property. */
  styleUpdates: Record<string, string | null>;
}): Promise<{ ok: true; absPath: string }> {
  const res = await fetch("/__dev/patch-style", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error(`patch-style failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface GenerateStubsResponse {
  created: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/** Walks the supplied component file paths and writes a `<Component>.stories.tsx`
 *  next to each one (skipping files that already have stories). The server
 *  parses each component for a default export to derive the story title. */
export async function generateStubs(files: string[]): Promise<GenerateStubsResponse> {
  const res = await fetch("/__dev/generate-stubs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!res.ok) {
    throw new Error(`generate-stubs failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface TokenInfo {
  name: string;
  value: string;
  group: "color" | "radius" | "shadow" | "motion" | "gradient" | "other";
  kind: "color" | "size" | "time" | "text";
}

const TOKEN_PREFIXES = ["--color-", "--radius-", "--shadow-", "--motion-", "--gradient-"];

function inferGroup(name: string): TokenInfo["group"] {
  if (name.startsWith("--color-")) return "color";
  if (name.startsWith("--radius-")) return "radius";
  if (name.startsWith("--shadow-")) return "shadow";
  if (name.startsWith("--motion-")) return "motion";
  if (name.startsWith("--gradient-")) return "gradient";
  return "other";
}

function inferKind(name: string, value: string): TokenInfo["kind"] {
  const trimmed = value.trim();
  if (name.startsWith("--color-")) return "color";
  if (name.startsWith("--gradient-")) return "text";
  if (name.startsWith("--shadow-")) return "text";
  if (name.startsWith("--motion-") || /^\d+m?s$/.test(trimmed)) return "time";
  if (/^-?\d+(\.\d+)?(px|rem|em|%)?$/.test(trimmed)) return "size";
  if (/^#([0-9a-f]{3,8})$/i.test(trimmed) || trimmed.startsWith("rgb")) return "color";
  return "text";
}

export function readAllTokens(): TokenInfo[] {
  const tokens: TokenInfo[] = [];
  const seen = new Set<string>();

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    if (!rules) continue;

    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (rule.selectorText !== ":root") continue;

      const style = rule.style;
      for (let i = 0; i < style.length; i++) {
        const name = style.item(i);
        if (!name.startsWith("--")) continue;
        if (!TOKEN_PREFIXES.some((p) => name.startsWith(p))) continue;
        if (seen.has(name)) continue;
        seen.add(name);

        const inline = document.documentElement.style.getPropertyValue(name);
        const value = (inline || style.getPropertyValue(name)).trim();
        tokens.push({
          name,
          value,
          group: inferGroup(name),
          kind: inferKind(name, value),
        });
      }
    }
  }

  const order: TokenInfo["group"][] = ["color", "radius", "shadow", "motion", "gradient", "other"];
  tokens.sort((a, b) => {
    const ai = order.indexOf(a.group);
    const bi = order.indexOf(b.group);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return tokens;
}

export interface TextStyle {
  /** The class name without the leading dot (e.g. `text-h1`). */
  className: string;
  /** Friendly label — `text-h1` becomes `h1`. */
  name: string;
  /** Sorted map of CSS declarations defined inside the rule. */
  declarations: Record<string, string>;
}

const TEXT_STYLE_FONT_PROPS = [
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "font-family",
  "text-transform",
];

/**
 * Walks the document's style sheets for plain `.text-*` class rules. Filters
 * out single-property Tailwind-style utilities (like `.text-red-500`,
 * `.text-sm`, `.text-center`) by requiring (a) at least two declarations
 * AND (b) at least one font-related declaration.
 *
 * Returns a deduplicated, sorted list — the first definition of a class wins.
 */
export function readAllTextStyles(): TextStyle[] {
  const seen = new Map<string, TextStyle>();

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try { rules = sheet.cssRules; } catch { continue; }
    if (!rules) continue;

    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const sel = rule.selectorText;
      // Only simple class selectors of the form `.text-foo`.
      if (!/^\.text-[a-zA-Z0-9_-]+$/.test(sel)) continue;
      const className = sel.slice(1);
      if (seen.has(className)) continue;

      const declarations: Record<string, string> = {};
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style.item(i);
        declarations[prop] = rule.style.getPropertyValue(prop).trim();
      }

      const propCount = Object.keys(declarations).length;
      const hasFont = TEXT_STYLE_FONT_PROPS.some((p) => p in declarations);
      if (propCount < 2 || !hasFont) continue;

      seen.set(className, {
        className,
        name: className.replace(/^text-/, ""),
        declarations,
      });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function applyTokenOverride(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

export function clearTokenOverrides(names: string[]) {
  for (const n of names) {
    document.documentElement.style.removeProperty(n);
  }
}

/**
 * Patches the `:root { }` block in a CSS text, replacing values for
 * the provided variables in place. Variables not present are appended.
 */
export function patchRootBlock(
  css: string,
  overrides: Record<string, string>,
): string {
  const rootRegex = /(:root\s*\{)([\s\S]*?)(\n\})/;
  const match = css.match(rootRegex);
  if (!match) {
    throw new Error("Could not locate `:root { ... }` block in CSS");
  }
  const [, head, body, tail] = match;

  let patched = body!;
  const leftovers: Record<string, string> = {};

  for (const [name, value] of Object.entries(overrides)) {
    const varRegex = new RegExp(
      `(\\s*${name.replace(/[-]/g, "\\-")}\\s*:\\s*)[^;]*(;)`,
      "m",
    );
    if (varRegex.test(patched)) {
      patched = patched.replace(varRegex, `$1${value}$2`);
    } else {
      leftovers[name] = value;
    }
  }

  const leftoverLines = Object.entries(leftovers)
    .map(([n, v]) => `  ${n}: ${v};`)
    .join("\n");

  if (leftoverLines) {
    patched = `${patched.replace(/\s*$/, "")}\n${leftoverLines}\n`;
  }

  return css.replace(rootRegex, `${head}${patched}${tail}`);
}
