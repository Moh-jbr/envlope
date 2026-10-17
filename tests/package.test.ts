import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "tsup";
import { describe, expect, it } from "vitest";
import tsupConfig from "../tsup.config.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;

describe("package manifest", () => {
  it("has no library entry points (importing envlope would run the CLI)", () => {
    expect(pkg.main).toBeUndefined();
    expect(pkg.module).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
  });

  it("ships the CLI as a single ESM bin", () => {
    expect(pkg.type).toBe("module");
    expect(pkg.bin).toEqual({ envlope: "dist/cli.js" });
    // A CJS bundle crashes with ERR_REQUIRE_ESM on Node 18 (update-notifier is ESM-only).
    expect((tsupConfig as Options).format).toEqual(["esm"]);
  });
});

describe("startup path", () => {
  const sources = readdirSync("src", { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [f, readFileSync(join("src", f), "utf8")] as const);

  // These two cost ~160ms to import. update-notifier only matters in an interactive
  // terminal and @clack/prompts only when prompting, so both must load on demand.
  it.each(["update-notifier", "@clack/prompts"])("never statically imports %s", (dep) => {
    const staticImport = new RegExp(`^import[^;]*from\\s+"${dep}"`, "m");
    expect(`import x from "${dep}";`).toMatch(staticImport); // the check itself works
    for (const [file, source] of sources) {
      expect(source, `${file} imports ${dep} at startup`).not.toMatch(staticImport);
    }
    expect(sources.some(([, source]) => source.includes(`import("${dep}")`))).toBe(true);
  });
});
