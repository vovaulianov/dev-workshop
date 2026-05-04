import type { Plugin } from "vite";
import { parse } from "@babel/parser";
import { relative } from "node:path";

/**
 * Injects a `data-devsource="<relative-file>:<line>:<col>"` attribute on
 * every host JSX element. Used by the Dev Workshop to map DOM nodes back to
 * their original source locations (React 19 removed `_debugSource` and the
 * `_debugStack` field points to compiled positions, not source positions).
 *
 * Must run BEFORE `@vitejs/plugin-react` so the attribute survives the JSX
 * transform as a regular DOM attribute.
 */
export function jsxSourcePlugin(): Plugin {
  let projectRoot = "";

  return {
    name: "dev-workshop:jsx-source",
    enforce: "pre",
    apply: "serve",
    configResolved(config) {
      projectRoot = config.root;
    },
    transform(code, id) {
      const cleanId = id.split("?")[0]!;
      if (!/\.(jsx|tsx)$/.test(cleanId)) return null;
      if (cleanId.includes("/node_modules/")) return null;

      let ast;
      try {
        ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true });
      } catch {
        return null;
      }

      const fileRel = relative(projectRoot, cleanId);
      const insertions: Array<{ pos: number; text: string }> = [];

      const visit = (node: any): void => {
        if (!node || typeof node !== "object") return;
        if (node.type === "JSXOpeningElement") {
          const name = node.name;
          if (name?.type === "JSXIdentifier" && /^[a-z]/.test(name.name) && node.loc) {
            const already = (node.attributes as any[]).some((a) => a.type === "JSXAttribute" && a.name?.name === "data-devsource");
            if (!already) {
              insertions.push({
                pos: name.end as number,
                text: ` data-devsource="${fileRel}:${node.loc.start.line}:${node.loc.start.column}"`,
              });
            }
          }
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

      if (insertions.length === 0) return null;
      insertions.sort((a, b) => b.pos - a.pos);
      let out = code;
      for (const ins of insertions) out = out.slice(0, ins.pos) + ins.text + out.slice(ins.pos);
      return { code: out, map: null };
    },
  };
}
