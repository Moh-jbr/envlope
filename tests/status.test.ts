import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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
    expect(result.stdout).toMatch(/✓ sync +in sync/);
    expect(result.stdout).toMatch(/✓ \.env ignored +rule \.env \(\.gitignore line 1\)/);
    expect(result.stdout).toMatch(/✓ \.env\.encrypted committable +not ignored/);
    expect(result.stdout).toMatch(/No problems/);
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
      gitignore_rule: { source: ".gitignore", line: 1, pattern: ".env" },
      encrypted_committable: true,
      problems: 0,
    });
    expect(typeof data.last_encrypted).toBe("string");
  });

  it("puts the fix under each problem and counts problems", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    run(project, ["init"]);
    const future = new Date(Date.now() + 2000);
    utimesSync(join(project, ".env"), future, future);

    const result = run(project, ["status"]);
    expect(result.stdout).toMatch(
      /✗ sync +\.env changed after the last encrypt\n +fix: envlope encrypt\n/,
    );
    expect(result.stdout).toMatch(/1 problem\n/);
    expect(JSON.parse(run(project, ["status", "--json"]).stdout).problems).toBe(1);
  });

  it("flags a .gitignore rule that hides the ciphertext, naming the rule", () => {
    writeFileSync(join(project, ".gitignore"), "# env\n.env*\n");
    writeFileSync(join(project, ".env"), "X=1\n");
    writeFileSync(join(project, ".env.encrypted"), "envlope:1:placeholder\n");

    const result = run(project, ["status"]);
    expect(result.stdout).toMatch(/✓ \.env ignored +rule \.env\* \(\.gitignore line 2\)/);
    expect(result.stdout).toMatch(
      /✗ \.env\.encrypted committable +ignored by rule \.env\* \(\.gitignore line 2\)\n +fix: add !\.env\.encrypted to \.gitignore/,
    );
    const data = JSON.parse(run(project, ["status", "--json"]).stdout);
    expect(data.encrypted_committable).toBe(false);
    expect(data.problems).toBe(1);

    // The fix it suggests resolves the problem.
    appendFileSync(join(project, ".gitignore"), "!.env.encrypted\n");
    expect(run(project, ["status"]).stdout).toMatch(
      /✓ \.env\.encrypted committable +rule !\.env\.encrypted \(\.gitignore line 3\)/,
    );
  });

  it("suggests envlope init when the ciphertext doesn't exist yet", () => {
    writeFileSync(join(project, ".env"), "X=1\n");
    const result = run(project, ["status", "--strict"]);
    expect(result.code).toBe(0); // --strict still only fails on drift
    expect(result.stdout).toMatch(/✗ \.env\.encrypted +not created yet\n +fix: envlope init\n/);
  });

  it("asks git, so rules outside .gitignore count too", () => {
    expect(spawnSync("git", ["init", "-q"], { cwd: project }).status).toBe(0);
    // .git/info/ comes from git's templates, which a system may not have.
    mkdirSync(join(project, ".git", "info"), { recursive: true });
    appendFileSync(join(project, ".git", "info", "exclude"), "\n.env\n");
    writeFileSync(join(project, ".env"), "X=1\n");

    const data = JSON.parse(run(project, ["status", "--json"]).stdout);
    expect(data.gitignored).toBe(true);
    expect(data.gitignore_rule).toMatchObject({ source: ".git/info/exclude", pattern: ".env" });
  });
});
