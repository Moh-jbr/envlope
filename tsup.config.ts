import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm", "cjs"],
  target: "node18",
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
});
