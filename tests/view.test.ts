import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function run(
  dir: string,
  args: string[],
  extraEnv?: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  delete env.ENVLOPE_KEY;
  if (extraEnv) Object.assign(env, extraEnv);
  const result = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function extractKey(stdout: string): string {
  const match = stdout.match(/envlope_key_[A-Za-z0-9+/=]+/);
  if (!match) throw new Error(`No key found in output:\n${stdout}`);
  return match[0];
}

describe("view command", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "envlope-view-"));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("prints a single variable value to stdout (no .env written to disk)", () => {
    writeFileSync(
      join(project, ".env"),
      "DB_URL=postgres://prod.example.com/db\nAPI_KEY=sk_live_xyz\n",
    );
    const init = run(project, ["init"]);
    const key = extractKey(init.stdout);

    // Remove the plaintext .env to prove view doesn't recreate it
    rmSync(join(project, ".env"));

    const result = run(project, ["view", "DB_URL", "--key", key]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("postgres://prod.example.com/db");

    // view must NOT write .env to disk
    expect(() => readFileSync(join(project, ".env"), "utf8")).toThrow();
  });

  it("fails cleanly when the variable is not found", () => {
    writeFileSync(join(project, ".env"), "EXISTING=value\n");
    const init = run(project, ["init"]);
    const key = extractKey(init.stdout);

    const result = run(project, ["view", "MISSING_VAR", "--key", key]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/MISSING_VAR/);
    expect(result.stdout + result.stderr).toMatch(/not found/);
  });

  it("rejects a wrong key with a clean error", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    run(project, ["init"]);

    const wrongKey = "envlope_key_" + Buffer.alloc(32, 3).toString("base64");
    const result = run(project, ["view", "X", "--key", wrongKey]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/Invalid key|decryption failed/i);
  });

  it("--json emits {variable, value}", () => {
    writeFileSync(join(project, ".env"), "DB=postgres://x\n");
    const init = run(project, ["init"]);
    const key = extractKey(init.stdout);

    const result = run(project, ["view", "DB", "--key", key, "--json"]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data).toEqual({ variable: "DB", value: "postgres://x" });
  });

  it("uses ENVLOPE_KEY env var when --key is omitted", () => {
    writeFileSync(join(project, ".env"), "TOKEN=abc123\n");
    const init = run(project, ["init"]);
    const key = extractKey(init.stdout);

    const result = run(project, ["view", "TOKEN"], { ENVLOPE_KEY: key });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("abc123");
  });

  it("works with multi-file (.env.production)", () => {
    writeFileSync(join(project, ".env.production"), "STRIPE_KEY=sk_live_prod\n");
    const init = run(project, ["init", ".env.production"]);
    const key = extractKey(init.stdout);

    const result = run(project, ["view", "STRIPE_KEY", ".env.production", "--key", key]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("sk_live_prod");
  });

  it("handles values with '=' inside them", () => {
    writeFileSync(join(project, ".env"), "QUERY=name=value&other=thing\n");
    const init = run(project, ["init"]);
    const key = extractKey(init.stdout);

    const result = run(project, ["view", "QUERY", "--key", key]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("name=value&other=thing");
  });
});
