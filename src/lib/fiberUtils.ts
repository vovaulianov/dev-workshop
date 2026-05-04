/**
 * React 19 dev-mode source-location helpers.
 *
 * React 19 removed `_debugSource` from Fibers. `_debugStack` exists but its
 * positions point at the *compiled* JS — not the original `.tsx`.
 *
 * Instead, `vite-plugin-jsx-source` injects a `data-devsource=
 * "<file>:<line>:<col>"` attribute on every host JSX element, carrying the
 * ORIGINAL source coordinates. We read that attribute directly.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ElementSource {
  /** Relative path from project root, e.g. "src/components/BookingCard.tsx" */
  file: string;
  /** 1-based */
  line: number;
  /** 0-based */
  column: number;
}

type Fiber = any;

/** Walk from a DOM node to its React Fiber (React 17+). */
export function getFiberFromDOM(el: Element): Fiber | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  return key ? (el as any)[key] : null;
}

/** Find the nearest ancestor fiber that represents a host (DOM) element. */
export function nearestHostFiber(fiber: Fiber | null): Fiber | null {
  let f: Fiber | null = fiber;
  while (f) {
    if (f.tag === 5 || (f.stateNode && f.stateNode.nodeType === 1)) return f;
    f = f.return ?? null;
  }
  return null;
}

function parseDevSource(attr: string): ElementSource | null {
  // format: "file:line:col" — file may contain colons on Windows so we split
  // from the right.
  const parts = attr.split(":");
  if (parts.length < 3) return null;
  const col = Number(parts.pop());
  const line = Number(parts.pop());
  const file = parts.join(":");
  if (!file || Number.isNaN(line) || Number.isNaN(col)) return null;
  return { file, line, column: col };
}

/**
 * Return the ElementSource for the clicked element by reading the
 * `data-devsource` attribute (injected by our Vite plugin). If the clicked
 * element has no attribute (e.g. it's inside a third-party component), walks
 * up to the nearest ancestor that does.
 */
export function sourceForElement(el: Element): ElementSource | null {
  let cur: Element | null = el;
  while (cur) {
    const attr = cur.getAttribute?.("data-devsource");
    if (attr) {
      const parsed = parseDevSource(attr);
      if (parsed) return parsed;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Re-locate a DOM element inside `root` whose fiber's source matches the
 * stored source. Used after HMR re-renders.
 */
export function findElementBySource(
  root: Element,
  target: ElementSource,
): Element | null {
  const candidates = [root, ...root.querySelectorAll("*")];
  for (const el of candidates) {
    const src = sourceForElement(el);
    if (src && src.file === target.file && src.line === target.line) {
      return el;
    }
  }
  return null;
}

/** Human-readable label for UI: "div.flex.gap-4 · BookingCard.tsx:32". */
export function describeElement(el: Element, src: ElementSource | null): string {
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute("class") || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join("");
  const loc = src ? ` · ${src.file.split("/").pop()}:${src.line}` : "";
  return `${tag}${cls}${loc}`;
}
