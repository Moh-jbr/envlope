import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import { parseKey } from "../src/key.js";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function run(dir: string, args: string[]): { code: number; stdout: string; stderr: string } {
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
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function extractKey(stdout: string): string {
  const match = stdout.match(/envlope_key_[A-Za-z0-9+/=]+/);
  if (!match) throw new Error(`No key found in output:\n${stdout}`);
  return match[0];
}

const BASE = "DATABASE_URL=postgres://base\nAPI_KEY=base-key\nDEBUG=false\n";
const THEIRS =
  "DATABASE_URL=postgres://base\nAPI_KEY=their-key\nDEBUG=false\nSENTRY_DSN=https://sentry\n";

describe("encrypt's conflict guard", () => {
  let project: string;
  let key: string;

  // What `git pull` does to the file when a teammate pushed a new version.
  const pullTeammateVersion = (content: string) =>
    writeFileSync(
      join(project, ".env.encrypted"),
      `${encrypt(Buffer.from(content), parseKey(key))}\n`,
    );
  const encrypted = () =>
    decrypt(readFileSync(join(project, ".env.encrypted"), "utf8"), parseKey(key)).toString();

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "envlope-guard-"));
    expect(spawnSync("git", ["init", "-q"], { cwd: project }).status).toBe(0);
    writeFileSync(join(project, ".env"), BASE);
    key = extractKey(run(project, ["init"]).stdout);
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it("refuses to undo a teammate's newer version, naming what each side changed", () => {
    pullTeammateVersion(THEIRS);
    writeFileSync(join(project, ".env"), BASE.replace("DEBUG=false", "DEBUG=true"));

    const result = run(project, ["encrypt", "--key", key]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /\.env\.encrypted changed since your \.env was made \(they changed SENTRY_DSN, API_KEY; you changed DEBUG\)/,
    );
    expect(result.stderr).toMatch(
      /Run envlope encrypt in a terminal to merge them, or pass --force/,
    );
    expect(encrypted()).toBe(THEIRS);

    const json = run(project, ["encrypt", "--key", key, "--json"]);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout).error).toMatch(/they changed SENTRY_DSN, API_KEY/);
  });

  it("names a variable you both changed, which can't merge", () => {
    pullTeammateVersion(THEIRS);
    writeFileSync(join(project, ".env"), BASE.replace("base-key", "my-key"));
    const result = run(project, ["encrypt", "--key", key]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/you both changed API_KEY/);
  });

  it("points to decrypt when your .env has no changes of its own", () => {
    pullTeammateVersion(THEIRS);
    writeFileSync(join(project, ".env"), `${BASE}# just a note\n`);
    const result = run(project, ["encrypt", "--key", key]);
    expect(result.stderr).toMatch(/has no changes of its own\. Run envlope decrypt to get theirs/);
  });

  it("shows in status that .env is behind, until you decrypt", () => {
    pullTeammateVersion(THEIRS);
    const status = run(project, ["status"]);
    expect(status.stdout).toMatch(
      /✗ up to date +\.env\.encrypted changed since your \.env was made\n +fix: envlope decrypt to take it, or envlope encrypt to merge your edits in/,
    );
    expect(JSON.parse(run(project, ["status", "--json"]).stdout).behind).toBe(true);

    expect(run(project, ["decrypt", "--key", key, "--yes"]).code).toBe(0);
    expect(JSON.parse(run(project, ["status", "--json"]).stdout).behind).toBe(false);
    writeFileSync(join(project, ".env"), `${THEIRS}MINE=1\n`);
    expect(run(project, ["encrypt", "--key", key]).code).toBe(0);
  });

  it("replaces their version with --force, and stays quiet after that", () => {
    pullTeammateVersion(THEIRS);
    const mine = BASE.replace("DEBUG=false", "DEBUG=true");
    writeFileSync(join(project, ".env"), mine);

    expect(run(project, ["encrypt", "--key", key, "--force"]).code).toBe(0);
    expect(encrypted()).toBe(mine);
    writeFileSync(join(project, ".env"), `${mine}MORE=1\n`);
    expect(run(project, ["encrypt", "--key", key]).code).toBe(0);
  });

  it("works for a fresh clone once it has decrypted", () => {
    const clone = mkdtempSync(join(tmpdir(), "envlope-clone-"));
    try {
      expect(spawnSync("git", ["init", "-q"], { cwd: clone }).status).toBe(0);
      writeFileSync(join(clone, ".env.encrypted"), readFileSync(join(project, ".env.encrypted")));
      expect(run(clone, ["decrypt", "--key", key]).code).toBe(0);

      writeFileSync(
        join(clone, ".env.encrypted"),
        `${encrypt(Buffer.from(THEIRS), parseKey(key))}\n`,
      );
      writeFileSync(join(clone, ".env"), BASE.replace("DEBUG=false", "DEBUG=true"));
      expect(run(clone, ["encrypt", "--key", key]).code).toBe(1);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it("stays out of the way outside a git repo, where nothing is recorded", () => {
    const plain = mkdtempSync(join(tmpdir(), "envlope-nogit-"));
    try {
      writeFileSync(join(plain, ".env"), BASE);
      const plainKey = extractKey(run(plain, ["init"]).stdout);
      writeFileSync(
        join(plain, ".env.encrypted"),
        `${encrypt(Buffer.from(THEIRS), parseKey(plainKey))}\n`,
      );
      writeFileSync(join(plain, ".env"), `${BASE}MINE=1\n`);
      expect(run(plain, ["encrypt", "--key", plainKey]).code).toBe(0);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
