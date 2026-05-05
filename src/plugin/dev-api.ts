import type { Plugin } from "vite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, basename, dirname, join } from "node:path";
import { parse } from "@babel/parser";
import type { ParseResult } from "@babel/parser";
import type { File } from "@babel/types";

function inRoot(root: string, file: string): string | null {
  const absPath = isAbsolute(file) ? file : resolve(root, file);
  const rel = relative(root, absPath);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return absPath;
}

interface PatchStyleRequest {
  file: string;
  line: number;
  column: number;
  styleUpdates: Record<string, string | null>;
}

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function literal(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseStyleObject(source: string, obj: any): { entries: Array<[string, string]>; nonLiteralPresent: boolean } {
  const entries: Array<[string, string]> = [];
  let nonLiteral = false;
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty") { nonLiteral = true; continue; }
    let key: string | null = null;
    if (prop.key.type === "Identifier") key = prop.key.name;
    else if (prop.key.type === "StringLiteral") key = prop.key.value;
    if (key == null) { nonLiteral = true; continue; }
    entries.push([key, source.slice(prop.value.start, prop.value.end)]);
  }
  return { entries, nonLiteralPresent: nonLiteral };
}

function buildObjectSource(entries: Array<[string, string]>): string {
  if (entries.length === 0) return "{}";
  return "{ " + entries.map(([k, v]) => `${k}: ${v}`).join(", ") + " }";
}

function findOpeningElement(ast: ParseResult<File>, line: number, column: number): any | null {
  let match: any = null;
  let bestDelta = Infinity;
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement" && node.loc) {
      const delta = node.loc.start.line === line ? Math.abs(node.loc.start.column - column) : Infinity;
      if (delta < bestDelta) { bestDelta = delta; match = node; }
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === "object") {
        if (Array.isArray(v)) for (const item of v) visit(item);
        else if ("type" in v) visit(v);
      }
    }
  };
  visit(ast.program);
  return bestDelta <= 4 ? match : null;
}

function patchStyle(source: string, req: PatchStyleRequest): string {
  const ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true });
  const openEl = findOpeningElement(ast, req.line, req.column);
  if (!openEl) throw new Error(`Could not locate JSX element at ${req.file}:${req.line}:${req.column}`);

  const existingAttr = (openEl.attributes as any[]).find((a) => a.type === "JSXAttribute" && a.name?.name === "style");
  const normalizedUpdates: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(req.styleUpdates)) normalizedUpdates[kebabToCamel(k)] = v;

  if (!existingAttr && Object.values(normalizedUpdates).every((v) => v === null)) return source;

  let entries: Array<[string, string]> = [];
  let nonLiteralPresent = false;

  if (existingAttr) {
    const value = existingAttr.value;
    if (value?.type === "JSXExpressionContainer" && value.expression?.type === "ObjectExpression") {
      const parsed = parseStyleObject(source, value.expression);
      entries = parsed.entries; nonLiteralPresent = parsed.nonLiteralPresent;
    } else if (value?.type === "JSXExpressionContainer") {
      entries.push(["$spread$", `...${source.slice(value.expression.start, value.expression.end)}`]);
    }
  }

  for (const [key, val] of Object.entries(normalizedUpdates)) {
    const idx = entries.findIndex(([k]) => k === key);
    if (val === null) { if (idx >= 0) entries.splice(idx, 1); }
    else if (idx >= 0) entries[idx] = [key, literal(val)];
    else entries.push([key, literal(val)]);
  }

  const objSource = buildObjectSource(entries.map(([k, v]) => k === "$spread$" ? ["", v] : [k, v]) as Array<[string, string]>);
  const shouldRemove = entries.length === 0 && !nonLiteralPresent;

  if (existingAttr) {
    if (shouldRemove) {
      let cutStart = existingAttr.start;
      if (source[cutStart - 1] === " ") cutStart -= 1;
      return source.slice(0, cutStart) + source.slice(existingAttr.end);
    }
    return source.slice(0, existingAttr.value.start) + `{${objSource}}` + source.slice(existingAttr.value.end);
  }

  const tagEnd = openEl.end;
  const insertPos = openEl.selfClosing ? tagEnd - 2 : tagEnd - 1;
  return source.slice(0, insertPos) + ` style={${objSource}}` + source.slice(insertPos);
}

/* ─────────────── Generate stub stories ─────────────── */

interface StubResult {
  created: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Walks a Babel AST looking for an exported React component. Returns
 * `{ name, isDefault }` where `isDefault` controls how the stub imports it
 * (default vs. named). Returns null if no plausible component export exists.
 *
 * Heuristic order:
 *   1. `export default Foo` (function, class, or identifier)
 *   2. `export function Foo` / `export class Foo` / `export const Foo`
 *      where Foo starts with a capital letter
 *   3. If multiple named exports match, prefer the one whose name equals
 *      the file's stem (e.g. `HotelCard.tsx` → exported `HotelCard`)
 */
function findComponentExport(ast: ParseResult<File>, fileStem: string): { name: string; isDefault: boolean } | null {
  const namedDecls = new Map<string, true>();
  for (const node of ast.program.body) {
    if (node.type === "FunctionDeclaration" && node.id) namedDecls.set(node.id.name, true);
    else if (node.type === "ClassDeclaration" && node.id) namedDecls.set(node.id.name, true);
    else if (node.type === "VariableDeclaration") {
      for (const d of node.declarations) {
        if (d.id.type === "Identifier") namedDecls.set(d.id.name, true);
      }
    }
  }

  // Pass 1: default export
  for (const node of ast.program.body) {
    if (node.type === "ExportDefaultDeclaration") {
      const decl = node.declaration as any;
      if (decl?.type === "FunctionDeclaration" && decl.id?.name && /^[A-Z]/.test(decl.id.name)) {
        return { name: decl.id.name, isDefault: true };
      }
      if (decl?.type === "ClassDeclaration" && decl.id?.name && /^[A-Z]/.test(decl.id.name)) {
        return { name: decl.id.name, isDefault: true };
      }
      if (decl?.type === "Identifier" && /^[A-Z]/.test(decl.name) && namedDecls.has(decl.name)) {
        return { name: decl.name, isDefault: true };
      }
    }
  }

  // Pass 2: named exports starting with a capital letter
  const named: string[] = [];
  for (const node of ast.program.body) {
    if (node.type === "ExportNamedDeclaration" && node.declaration) {
      const d = node.declaration as any;
      if (d.type === "FunctionDeclaration" && d.id?.name && /^[A-Z]/.test(d.id.name)) named.push(d.id.name);
      else if (d.type === "ClassDeclaration" && d.id?.name && /^[A-Z]/.test(d.id.name)) named.push(d.id.name);
      else if (d.type === "VariableDeclaration") {
        for (const v of d.declarations) {
          if (v.id?.type === "Identifier" && /^[A-Z]/.test(v.id.name)) named.push(v.id.name);
        }
      }
    } else if (node.type === "ExportNamedDeclaration" && node.specifiers?.length) {
      // export { Foo } or export { Foo as Bar }
      for (const spec of node.specifiers) {
        if (spec.type === "ExportSpecifier" && spec.exported.type === "Identifier") {
          const name = spec.exported.name;
          if (/^[A-Z]/.test(name)) named.push(name);
        }
      }
    }
  }

  if (named.length === 0) return null;
  // Prefer name matching file stem; otherwise first capitalized export
  const stemMatch = named.find((n) => n === fileStem);
  return { name: stemMatch ?? named[0]!, isDefault: false };
}

/**
 * Writes a `<Component>.stories.tsx` file next to a component source file,
 * unless one already exists. Returns a status describing what happened.
 */
function generateStub(absComponentPath: string, projectRoot: string): { status: "created" | "skipped"; reason?: string; storyPath?: string } {
  const dir = dirname(absComponentPath);
  const fileName = basename(absComponentPath); // e.g., HotelCard.tsx
  const stem = fileName.replace(/\.(tsx|jsx)$/, "");
  if (!stem || stem === fileName) return { status: "skipped", reason: "not a tsx/jsx file" };

  const storyPath = join(dir, `${stem}.stories.tsx`);
  if (existsSync(storyPath)) return { status: "skipped", reason: "stories file already exists" };

  let source: string;
  try {
    source = readFileSync(absComponentPath, "utf-8");
  } catch (err) {
    return { status: "skipped", reason: `cannot read: ${String(err)}` };
  }

  let ast: ParseResult<File>;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true });
  } catch (err) {
    return { status: "skipped", reason: `parse error: ${String(err)}` };
  }

  const exported = findComponentExport(ast, stem);
  if (!exported) return { status: "skipped", reason: "no exported component found" };

  // Build a short relative path from project root for the title category
  const rel = relative(projectRoot, dir).split("/").filter(Boolean);
  const category = rel.length > 0 ? rel[rel.length - 1] : "components";
  const title = `${category}/${exported.name}`;

  const importLine = exported.isDefault
    ? `import ${exported.name} from "./${stem}";`
    : `import { ${exported.name} } from "./${stem}";`;

  const stub = `${importLine}

export default {
  title: "${title}",
  component: ${exported.name},
};

export const Default = {
  args: {},
};
`;

  try {
    writeFileSync(storyPath, stub, "utf-8");
  } catch (err) {
    return { status: "skipped", reason: `cannot write: ${String(err)}` };
  }
  return { status: "created", storyPath };
}

function generateStubs(filePaths: string[], projectRoot: string): StubResult {
  const result: StubResult = { created: [], skipped: [] };
  for (const file of filePaths) {
    // Vite's `import.meta.glob` returns paths with a leading `/` that mean
    // "project-root-relative", not filesystem-absolute. Normalize before
    // `inRoot` so we don't end up reading from `/src/...` on the real fs.
    const normalized = file.startsWith("/") && !file.startsWith("//")
      ? file.slice(1)
      : file;
    const absPath = inRoot(projectRoot, normalized);
    if (!absPath) {
      result.skipped.push({ file, reason: "path escapes project root" });
      continue;
    }
    // Skip files that are themselves stories or tests
    if (/\.(stories|test|spec)\.(tsx|jsx)$/.test(absPath)) {
      continue;
    }
    const r = generateStub(absPath, projectRoot);
    if (r.status === "created" && r.storyPath) {
      result.created.push(relative(projectRoot, r.storyPath));
    } else if (r.status === "skipped") {
      result.skipped.push({ file: relative(projectRoot, absPath), reason: r.reason ?? "unknown" });
    }
  }
  return result;
}

export function devApiPlugin(): Plugin {
  return {
    name: "dev-workshop:api",
    apply: "serve",
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/__dev/")) { next(); return; }

        if (url.startsWith("/__dev/read")) {
          if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
          try {
            const file = new URL(url, "http://localhost").searchParams.get("file");
            if (!file) { res.statusCode = 400; res.end("Missing `file` query param"); return; }
            const absPath = inRoot(root, file);
            if (!absPath) { res.statusCode = 403; res.end("Path escapes project root"); return; }
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ content: readFileSync(absPath, "utf-8"), absPath }));
          } catch (err) { res.statusCode = 404; res.end(String(err)); }
          return;
        }

        if (url.startsWith("/__dev/generate-stubs")) {
          if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const payload = JSON.parse(body) as { files?: string[] };
              if (!Array.isArray(payload.files)) { res.statusCode = 400; res.end("Missing `files` array"); return; }
              const result = generateStubs(payload.files, root);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(result));
            } catch (err) { res.statusCode = 500; res.end(String(err)); }
          });
          return;
        }

        if (url.startsWith("/__dev/write") || url.startsWith("/__dev/patch-style")) {
          if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const payload = JSON.parse(body);
              const file = payload.file;
              if (!file) { res.statusCode = 400; res.end("Missing `file`"); return; }
              const absPath = inRoot(root, file);
              if (!absPath) { res.statusCode = 403; res.end("Path escapes project root"); return; }

              if (url.startsWith("/__dev/write")) {
                if (typeof payload.content !== "string") { res.statusCode = 400; res.end("Missing `content`"); return; }
                writeFileSync(absPath, payload.content, "utf-8");
              } else {
                const source = readFileSync(absPath, "utf-8");
                const patched = patchStyle(source, payload as PatchStyleRequest);
                if (patched !== source) writeFileSync(absPath, patched, "utf-8");
              }
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true, absPath }));
            } catch (err) { res.statusCode = 500; res.end(String(err)); }
          });
          return;
        }

        res.statusCode = 404; res.end();
      });
    },
  };
}
