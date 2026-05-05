import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "index": "src/index.ts",
    "plugin/index": "src/plugin/index.ts",
    "ui/index": "src/ui/DevWorkshopPage.tsx",
    "context/index": "src/context/PortalTargetContext.tsx",
  },
  format: ["esm"],
  target: "es2022",
  dts: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  external: ["react", "react-dom", "react/jsx-runtime", "vite", /^node:/, /^virtual:/],
});
