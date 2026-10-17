import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  // ESM only: this is a CLI, not a library, and a CJS bundle crashes with
  // ERR_REQUIRE_ESM on Node versions that can't require() ESM-only
  // dependencies like update-notifier (e.g. Node 18).
  format: ["esm"],
  target: "node18",
  clean: true,
  dts: false,
  sourcemap: false,
  minify: false,
  shims: true,
  banner: { js: "#!/usr/bin/env node" },
});
