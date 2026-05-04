import type { Plugin } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
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
