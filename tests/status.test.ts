import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function run(
  dir: string,
  args: string[],
): { code: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  delete env.ENVLOPE_KEY;
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

describe("status command", () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "envlope-status-"));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("reports all-green when env and encrypted are in sync", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    run(project, ["init"]);

    const result = run(project, ["status"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/in sync/);
    expect(result.stdout).toMatch(/\.gitignore protects/);
  });

  it("reports drift when .env is newer than .env.encrypted", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    run(project, ["init"]);

    // Touch .env into the future (2 seconds past current encrypted mtime)
    const future = new Date(Date.now() + 2000);
    utimesSync(join(project, ".env"), future, future);

    const result = run(project, ["status", "--json"]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.env_exists).toBe(true);
    expect(data.encrypted_exists).toBe(true);
    expect(data.in_sync).toBe(false);
  });

  it("--strict exits 1 when out of sync", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    run(project, ["init"]);
    const future = new Date(Date.now() + 2000);
    utimesSync(join(project, ".env"), future, future);

    const result = run(project, ["status", "--strict"]);
    expect(result.code).toBe(1);
  });

  it("reports missing .env.encrypted cleanly", () => {
    writeFileSync(join(project, ".env"), "X=1\n");

    const result = run(project, ["status", "--json"]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.env_exists).toBe(true);
    expect(data.encrypted_exists).toBe(false);
    expect(data.in_sync).toBeNull();
  });

  it("reports missing .env cleanly", () => {
    const result = run(project, ["status", "--json"]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.env_exists).toBe(false);
    expect(data.encrypted_exists).toBe(false);
    expect(data.gitignored).toBe(false);
  });

  it("works with multi-file (.env.production)", () => {
    writeFileSync(join(project, ".env.production"), "DB=prod\n");
    run(project, ["init", ".env.production"]);

    const result = run(project, ["status", ".env.production", "--json"]);
    expect(result.code).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.file).toBe(".env.production");
    expect(data.env_exists).toBe(true);
    expect(data.encrypted_exists).toBe(true);
  });

  it("--json output has the expected shape", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    run(project, ["init"]);

    const result = run(project, ["status", "--json"]);
    const data = JSON.parse(result.stdout);

    expect(data).toMatchObject({
      file: ".env",
      env_exists: true,
      encrypted_exists: true,
      gitignored: true,
    });
    expect(typeof data.last_encrypted).toBe("string");
  });
});
