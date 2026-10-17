import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint, fingerprintWords, formatFingerprint, parseKey } from "../src/key.js";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function run(
  dir: string,
  args: string[],
  options: { input?: string; env?: Record<string, string | undefined> } = {},
): { code: number; stdout: string; stderr: string } {
  // Build a clean env: clear ENVLOPE_KEY so it can't leak in from the parent
  // shell, suppress the update notifier, then layer in any test-specific vars.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  delete env.ENVLOPE_KEY;
  for (const [name, value] of Object.entries(options.env ?? {})) {
    // Windows env names are case-insensitive, so drop every spelling first;
    // `undefined` means "remove this variable".
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === name.toUpperCase()) delete env[key];
    }
    if (value !== undefined) env[name] = value;
  }

  const result = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd: dir,
    input: options.input,
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

function git(dir: string, args: string[]): number | null {
  return spawnSync("git", args, { cwd: dir, encoding: "utf8" }).status;
}

describe("CLI end-to-end", () => {
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    projectA = mkdtempSync(join(tmpdir(), "envlope-a-"));
    projectB = mkdtempSync(join(tmpdir(), "envlope-b-"));
  });

  afterEach(() => {
    rmSync(projectA, { recursive: true, force: true });
    rmSync(projectB, { recursive: true, force: true });
  });

  it("init → decrypt round trip across two project dirs", () => {
    writeFileSync(join(projectA, ".env"), "DB_URL=postgres://secret\nAPI_KEY=abc123\n");

    const initResult = run(projectA, ["init"]);
    expect(initResult.code).toBe(0);
    expect(existsSync(join(projectA, ".env.encrypted"))).toBe(true);
    expect(readFileSync(join(projectA, ".gitignore"), "utf8")).toContain(".env");

    const key = extractKey(initResult.stdout);

    // Simulate teammate: copy encrypted file to project B
    writeFileSync(
      join(projectB, ".env.encrypted"),
      readFileSync(join(projectA, ".env.encrypted")),
    );

    const decryptResult = run(projectB, ["decrypt", "--key", key]);
    expect(decryptResult.code).toBe(0);
    expect(readFileSync(join(projectB, ".env"), "utf8")).toBe(
      "DB_URL=postgres://secret\nAPI_KEY=abc123\n",
    );
  });

  it("init fails when no .env exists", () => {
    const result = run(projectA, ["init"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/No \.env file found/);
  });

  it("decrypt fails when no .env.encrypted exists", () => {
    const result = run(projectA, ["decrypt", "--key", "envlope_key_anything"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/No \.env\.encrypted file found/);
  });

  it("decrypt rejects a wrong key with a clean error (no stack trace)", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    expect(init.code).toBe(0);

    // Use a different valid-format key
    const wrongKey = "envlope_key_" + Buffer.alloc(32, 1).toString("base64");
    const result = run(projectA, ["decrypt", "--key", wrongKey]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/decryption failed|Invalid key/i);
    expect(result.stderr).not.toMatch(/at .+\.ts:/); // no stack trace
  });

  it("decrypt rejects a malformed key with a clean error", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);

    const result = run(projectA, ["decrypt", "--key", "not-a-real-key"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/envlope_key_/);
  });

  it("encrypt updates .env.encrypted with the same key", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    const key = extractKey(init.stdout);
    const firstBlob = readFileSync(join(projectA, ".env.encrypted"), "utf8");

    writeFileSync(join(projectA, ".env"), "X=1\nY=2\n");
    const encryptResult = run(projectA, ["encrypt", "--key", key]);
    expect(encryptResult.code).toBe(0);

    const secondBlob = readFileSync(join(projectA, ".env.encrypted"), "utf8");
    expect(secondBlob).not.toBe(firstBlob);

    // Verify the new blob decrypts to the new content
    writeFileSync(
      join(projectB, ".env.encrypted"),
      readFileSync(join(projectA, ".env.encrypted")),
    );
    run(projectB, ["decrypt", "--key", key]);
    expect(readFileSync(join(projectB, ".env"), "utf8")).toBe("X=1\nY=2\n");
  });

  it("encrypt rejects a key that doesn't match the existing .env.encrypted", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    expect(init.code).toBe(0);

    const wrongKey = "envlope_key_" + Buffer.alloc(32, 7).toString("base64");
    const result = run(projectA, ["encrypt", "--key", wrongKey]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/does not match the current/i);
  });

  it("encrypt rejects the old key after init rotation", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const first = run(projectA, ["init"]);
    const oldKey = extractKey(first.stdout);

    const second = run(projectA, ["init", "--yes"]);
    expect(second.code).toBe(0);

    // Old key was valid before rotation; should now be rejected
    const result = run(projectA, ["encrypt", "--key", oldKey]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/does not match the current/i);
  });

  it("encrypt errors cleanly when no .env.encrypted exists", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const result = run(projectA, ["encrypt", "--key", "envlope_key_anything"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/No \.env\.encrypted file found/);
  });

  it("re-init with --yes generates a new key and invalidates the old one", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const first = run(projectA, ["init"]);
    expect(first.code).toBe(0);
    const oldKey = extractKey(first.stdout);
    const oldBlob = readFileSync(join(projectA, ".env.encrypted"), "utf8");

    const second = run(projectA, ["init", "--yes"]);
    expect(second.code).toBe(0);
    const newKey = extractKey(second.stdout);
    expect(newKey).not.toBe(oldKey);

    const newBlob = readFileSync(join(projectA, ".env.encrypted"), "utf8");
    expect(newBlob).not.toBe(oldBlob);

    // Old key must no longer decrypt the new blob
    writeFileSync(join(projectB, ".env.encrypted"), newBlob);
    const oldKeyAttempt = run(projectB, ["decrypt", "--key", oldKey, "--yes"]);
    expect(oldKeyAttempt.code).toBe(1);

    // New key decrypts cleanly
    const newKeyAttempt = run(projectB, ["decrypt", "--key", newKey, "--yes"]);
    expect(newKeyAttempt.code).toBe(0);
    expect(readFileSync(join(projectB, ".env"), "utf8")).toBe("X=1\n");
  });

  it("init --key uses the provided key and skips the SAVE-THIS-KEY block", () => {
    writeFileSync(join(projectA, ".env"), "DB_URL=postgres://secret\n");

    const providedKey = "envlope_key_" + Buffer.alloc(32, 42).toString("base64");
    const result = run(projectA, ["init", "--key", providedKey]);
    expect(result.code).toBe(0);
    expect(existsSync(join(projectA, ".env.encrypted"))).toBe(true);

    // The SAVE-THIS-KEY block should NOT appear when the user provided a key
    expect(result.stdout).not.toMatch(/SAVE THIS KEY/);
    expect(result.stdout).toMatch(/Used the provided key/);

    // Decrypt with the same key in a different project — should work
    writeFileSync(
      join(projectB, ".env.encrypted"),
      readFileSync(join(projectA, ".env.encrypted")),
    );
    const decryptResult = run(projectB, ["decrypt", "--key", providedKey]);
    expect(decryptResult.code).toBe(0);
    expect(readFileSync(join(projectB, ".env"), "utf8")).toBe("DB_URL=postgres://secret\n");
  });

  it("init --key rejects a malformed key with a clean error", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const result = run(projectA, ["init", "--key", "not-a-real-key"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/envlope_key_/);
    expect(existsSync(join(projectA, ".env.encrypted"))).toBe(false);
  });

  it("multi-repo flow: one key from init unlocks --key init in a second repo", () => {
    // Project A: generate a key the normal way
    writeFileSync(join(projectA, ".env"), "SHARED=secret-1\n");
    const initA = run(projectA, ["init"]);
    expect(initA.code).toBe(0);
    const sharedKey = extractKey(initA.stdout);

    // Project B: different .env, same shared key via --key
    writeFileSync(join(projectB, ".env"), "DIFFERENT=secret-2\n");
    const initB = run(projectB, ["init", "--key", sharedKey]);
    expect(initB.code).toBe(0);

    // The same key decrypts both projects' .env.encrypted files
    const projectC = mkdtempSync(join(tmpdir(), "envlope-c-"));
    try {
      // Decrypt project A's blob with sharedKey
      writeFileSync(
        join(projectC, ".env.encrypted"),
        readFileSync(join(projectA, ".env.encrypted")),
      );
      const decryptA = run(projectC, ["decrypt", "--key", sharedKey]);
      expect(decryptA.code).toBe(0);
      expect(readFileSync(join(projectC, ".env"), "utf8")).toBe("SHARED=secret-1\n");

      // Decrypt project B's blob with the same sharedKey
      writeFileSync(
        join(projectC, ".env.encrypted"),
        readFileSync(join(projectB, ".env.encrypted")),
      );
      const decryptB = run(projectC, ["decrypt", "--key", sharedKey, "--yes"]);
      expect(decryptB.code).toBe(0);
      expect(readFileSync(join(projectC, ".env"), "utf8")).toBe("DIFFERENT=secret-2\n");
    } finally {
      rmSync(projectC, { recursive: true, force: true });
    }
  });

  it("gitignore updating is idempotent", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    writeFileSync(join(projectA, ".gitignore"), ".env\nnode_modules\n");

    run(projectA, ["init"]);
    const after = readFileSync(join(projectA, ".gitignore"), "utf8");

    // .env should appear exactly once
    const matches = after.match(/^\.env$/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  // --- ENVLOPE_KEY, multi-file, backup and --json ---

  it("ENVLOPE_KEY env var: decrypt works without --key when env var is set", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    const key = extractKey(init.stdout);

    writeFileSync(
      join(projectB, ".env.encrypted"),
      readFileSync(join(projectA, ".env.encrypted")),
    );

    const result = run(projectB, ["decrypt"], { env: { ENVLOPE_KEY: key } });
    expect(result.code).toBe(0);
    expect(readFileSync(join(projectB, ".env"), "utf8")).toBe("X=1\n");
  });

  it("ENVLOPE_KEY env var: --key flag takes priority over the env var", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    const realKey = extractKey(init.stdout);
    const wrongKey = "envlope_key_" + Buffer.alloc(32, 99).toString("base64");

    writeFileSync(
      join(projectB, ".env.encrypted"),
      readFileSync(join(projectA, ".env.encrypted")),
    );

    // Set wrong env var, pass real key via --key. Should succeed (flag wins).
    const result = run(projectB, ["decrypt", "--key", realKey], {
      env: { ENVLOPE_KEY: wrongKey },
    });
    expect(result.code).toBe(0);
  });

  it("ENVLOPE_KEY env var with invalid format fails cleanly", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);

    const result = run(projectA, ["decrypt"], { env: { ENVLOPE_KEY: "not-a-real-key" } });
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/envlope_key_/);
  });

  it("multi-file: encrypt/decrypt .env.production round-trip", () => {
    writeFileSync(join(projectA, ".env.production"), "DB=prod-db\n");

    const init = run(projectA, ["init", ".env.production"]);
    expect(init.code).toBe(0);
    expect(existsSync(join(projectA, ".env.production.encrypted"))).toBe(true);
    expect(readFileSync(join(projectA, ".gitignore"), "utf8")).toContain(".env.production");

    const key = extractKey(init.stdout);

    writeFileSync(
      join(projectB, ".env.production.encrypted"),
      readFileSync(join(projectA, ".env.production.encrypted")),
    );

    const decrypt = run(projectB, ["decrypt", ".env.production", "--key", key]);
    expect(decrypt.code).toBe(0);
    expect(readFileSync(join(projectB, ".env.production"), "utf8")).toBe("DB=prod-db\n");
  });

  it("multi-file: each env file is encrypted independently", () => {
    writeFileSync(join(projectA, ".env"), "DEV=1\n");
    writeFileSync(join(projectA, ".env.production"), "PROD=1\n");

    const initDev = run(projectA, ["init"]);
    const initProd = run(projectA, ["init", ".env.production"]);
    expect(initDev.code).toBe(0);
    expect(initProd.code).toBe(0);

    // Two separate encrypted files
    expect(existsSync(join(projectA, ".env.encrypted"))).toBe(true);
    expect(existsSync(join(projectA, ".env.production.encrypted"))).toBe(true);

    // Different keys → contents are different
    const devKey = extractKey(initDev.stdout);
    const prodKey = extractKey(initProd.stdout);
    expect(devKey).not.toBe(prodKey);
  });

  it("backup on re-init: .env.encrypted.bak is created with prior contents", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);
    const originalBlob = readFileSync(join(projectA, ".env.encrypted"), "utf8");

    const second = run(projectA, ["init", "--yes"]);
    expect(second.code).toBe(0);

    expect(existsSync(join(projectA, ".env.encrypted.bak"))).toBe(true);
    const backupBlob = readFileSync(join(projectA, ".env.encrypted.bak"), "utf8");
    expect(backupBlob).toBe(originalBlob);

    // The new .env.encrypted is different from the backup
    const newBlob = readFileSync(join(projectA, ".env.encrypted"), "utf8");
    expect(newBlob).not.toBe(backupBlob);

    // Backup is also gitignored
    expect(readFileSync(join(projectA, ".gitignore"), "utf8")).toContain(".env.encrypted.bak");
  });

  it("--json: init emits a single JSON object with the generated key", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const result = run(projectA, ["init", "--json"]);
    expect(result.code).toBe(0);

    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.file).toBe(".env");
    expect(data.encrypted_file).toBe(".env.encrypted");
    expect(typeof data.key).toBe("string");
    expect(data.key.startsWith("envlope_key_")).toBe(true);
  });

  it("--json: init --key omits the key from the JSON (user already has it)", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const providedKey = "envlope_key_" + Buffer.alloc(32, 17).toString("base64");
    const result = run(projectA, ["init", "--key", providedKey, "--json"]);
    expect(result.code).toBe(0);

    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.key).toBeUndefined();
  });

  it("--json: encrypt emits a single JSON object", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    const key = extractKey(init.stdout);

    writeFileSync(join(projectA, ".env"), "X=1\nY=2\n");
    const result = run(projectA, ["encrypt", "--key", key, "--json"]);
    expect(result.code).toBe(0);

    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.encrypted_file).toBe(".env.encrypted");
    expect(data.changed).toBe(true);
  });

  it("--json: decrypt emits a single JSON object", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const init = run(projectA, ["init"]);
    const key = extractKey(init.stdout);

    writeFileSync(
      join(projectB, ".env.encrypted"),
      readFileSync(join(projectA, ".env.encrypted")),
    );

    const result = run(projectB, ["decrypt", "--key", key, "--json"]);
    expect(result.code).toBe(0);

    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.output_file).toBe(".env");
  });

  it("--json: failure emits a structured error object", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);

    const wrongKey = "envlope_key_" + Buffer.alloc(32, 5).toString("base64");
    const result = run(projectA, ["decrypt", "--key", wrongKey, "--json"]);
    expect(result.code).toBe(1);

    const data = JSON.parse(result.stdout);
    expect(typeof data.error).toBe("string");
    expect(data.code).toBe(1);
  });

  it("--json + destructive op without --yes: aborts cleanly", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);

    // Re-init without --yes in JSON mode should fail (can't prompt)
    const result = run(projectA, ["init", "--json"]);
    expect(result.code).toBe(1);
    const data = JSON.parse(result.stdout);
    expect(data.error).toMatch(/Pass --yes/);
  });

  // --- regression tests ---

  it("status reports in sync right after decrypting a fresh checkout", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);

    // Simulate a clone: git wrote .env.encrypted a while before the teammate decrypts.
    const encrypted = join(projectB, ".env.encrypted");
    writeFileSync(encrypted, readFileSync(join(projectA, ".env.encrypted")));
    const checkedOut = new Date(Date.now() - 60_000);
    utimesSync(encrypted, checkedOut, checkedOut);

    const decryptedAt = Date.now();
    expect(run(projectB, ["decrypt", "--key", key]).code).toBe(0);
    // The ciphertext's time moves up instead; .env keeps its real write time,
    // which build tools rely on.
    expect(statSync(join(projectB, ".env")).mtimeMs).toBeGreaterThanOrEqual(decryptedAt - 2000);

    expect(JSON.parse(run(projectB, ["status", "--json"]).stdout).in_sync).toBe(true);
    expect(run(projectB, ["status", "--strict"]).code).toBe(0);
  });

  it("init re-includes .env.encrypted when a broad .gitignore rule like .env* hides it", () => {
    expect(git(projectA, ["init", "-q"])).toBe(0);
    writeFileSync(join(projectA, ".gitignore"), "# env files\n.env*\n");
    writeFileSync(join(projectA, ".env"), "X=1\n");

    expect(run(projectA, ["init"]).code).toBe(0);

    const gitignore = readFileSync(join(projectA, ".gitignore"), "utf8");
    expect(gitignore).toContain("!.env.encrypted");
    // .env* already covers the plaintext files, so they aren't appended again.
    expect(gitignore).not.toMatch(/^\.env$/m);
    expect(git(projectA, ["check-ignore", "-q", ".env"])).toBe(0);
    expect(git(projectA, ["check-ignore", "-q", ".env.encrypted"])).toBe(1);
    expect(git(projectA, ["add", ".env.encrypted"])).toBe(0);

    expect(JSON.parse(run(projectA, ["status", "--json"]).stdout).gitignored).toBe(true);
  });

  it("handles a .env* rule outside a git repo, without repeating the exception", () => {
    writeFileSync(join(projectA, ".gitignore"), ".env*\n");
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    // decrypt runs the .gitignore check again
    expect(run(projectA, ["decrypt", "--key", key, "--yes"]).code).toBe(0);

    const gitignore = readFileSync(join(projectA, ".gitignore"), "utf8");
    expect(gitignore.match(/^!\.env\.encrypted$/gm)).toHaveLength(1);
    expect(gitignore).not.toMatch(/^\.env$/m);
  });

  it("encrypt leaves .env.encrypted untouched when .env hasn't changed", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    const before = readFileSync(join(projectA, ".env.encrypted"), "utf8");

    const result = run(projectA, ["encrypt", "--key", key]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/already up to date/);
    expect(readFileSync(join(projectA, ".env.encrypted"), "utf8")).toBe(before);

    const json = run(projectA, ["encrypt", "--key", key, "--json"]);
    expect(JSON.parse(json.stdout)).toMatchObject({ success: true, changed: false });
    expect(readFileSync(join(projectA, ".env.encrypted"), "utf8")).toBe(before);
  });

  it("a no-op encrypt clears status drift from re-saving .env unchanged", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    const resaved = new Date(Date.now() + 5_000);
    utimesSync(join(projectA, ".env"), resaved, resaved);
    expect(JSON.parse(run(projectA, ["status", "--json"]).stdout).in_sync).toBe(false);

    expect(run(projectA, ["encrypt", "--key", key]).code).toBe(0);

    expect(JSON.parse(run(projectA, ["status", "--json"]).stdout).in_sync).toBe(true);
  });

  it("re-init without --yes in a non-interactive shell fails cleanly instead of crashing", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);
    const before = readFileSync(join(projectA, ".env.encrypted"), "utf8");

    // spawnSync pipes stdin, so the CLI isn't attached to a terminal.
    const result = run(projectA, ["init"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Pass --yes/);
    expect(result.stderr).not.toMatch(/TTY initialization failed/);
    expect(readFileSync(join(projectA, ".env.encrypted"), "utf8")).toBe(before);
    expect(existsSync(join(projectA, ".env.encrypted.bak"))).toBe(false);
  });

  it("decrypt over an existing .env without --yes in a non-interactive shell fails cleanly", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    writeFileSync(join(projectA, ".env"), "LOCAL_EDIT=1\n");

    const result = run(projectA, ["decrypt", "--key", key]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Pass --yes/);
    expect(result.stderr).not.toMatch(/TTY initialization failed/);
    expect(readFileSync(join(projectA, ".env"), "utf8")).toBe("LOCAL_EDIT=1\n");
  });

  it("re-init with an invalid --key fails before touching the backup or ciphertext", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    run(projectA, ["init"]);
    const encrypted = readFileSync(join(projectA, ".env.encrypted"), "utf8");
    writeFileSync(join(projectA, ".env.encrypted.bak"), "previous backup\n");

    const result = run(projectA, ["init", "--yes", "--key", "not-a-real-key"]);
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/envlope_key_/);
    expect(readFileSync(join(projectA, ".env.encrypted.bak"), "utf8")).toBe("previous backup\n");
    expect(readFileSync(join(projectA, ".env.encrypted"), "utf8")).toBe(encrypted);
  });

  // --- terminal UI ---

  it("init shows the key and its fingerprint in a card; other commands show the same fingerprint", () => {
    writeFileSync(join(projectA, ".env"), "A=1\nB=2\n");
    const init = run(projectA, ["init"]);
    const key = extractKey(init.stdout);
    const fp = formatFingerprint(fingerprint(parseKey(key)));

    expect(init.stdout).toMatch(/✓ Encrypted \.env → \.env\.encrypted · 2 variables · AES-256-GCM/);
    expect(init.stdout).toMatch(/╭─ SAVE THIS KEY · shown once ─+╮/);
    expect(init.stdout).toContain(`│  ${key}  │`);
    const words = fingerprintWords(fingerprint(parseKey(key)));
    expect(init.stdout).toMatch(new RegExp(`│  fingerprint  ${fp} · ${words} +│`));
    // The card's rows all have the same width.
    const card = init.stdout.split("\n").filter((l) => /^[╭│╰]/.test(l));
    expect(new Set(card.map((l) => [...l].length)).size).toBe(1);

    writeFileSync(join(projectB, ".env.encrypted"), readFileSync(join(projectA, ".env.encrypted")));
    expect(run(projectB, ["decrypt", "--key", key]).stdout).toContain(`· key ${fp}`);
    const json = JSON.parse(run(projectB, ["decrypt", "--key", key, "--yes", "--json"]).stdout);
    expect(json.fingerprint).toBe(fingerprint(parseKey(key)));
  });

  it("encrypt lists added, changed and removed variables by name, never values", () => {
    writeFileSync(join(projectA, ".env"), "KEEP=1\nCHANGE=old-secret\nDROP=gone\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    writeFileSync(join(projectA, ".env"), "KEEP=1\nCHANGE=new-secret\nADD=fresh\n");

    const result = run(projectA, ["encrypt", "--key", key]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\+ ADD\n +~ CHANGE\n +- DROP\n/);
    expect(result.stdout).toMatch(/3 changes · 3 variables · values are never printed/);
    expect(result.stdout).not.toMatch(/secret|fresh|gone/);

    writeFileSync(join(projectA, ".env"), "KEEP=1\nCHANGE=new-secret\nADD=fresh\n# note\n");
    const commentOnly = run(projectA, ["encrypt", "--key", key, "--json"]);
    expect(JSON.parse(commentOnly.stdout)).toMatchObject({
      changed: true,
      variables: { added: [], changed: [], removed: [] },
    });
    expect(run(projectA, ["encrypt", "--key", key]).stdout).toMatch(/already up to date/);
  });

  it("decrypt does nothing when .env already matches, even without --yes or a terminal", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);

    const result = run(projectA, ["decrypt", "--key", key]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/\.env already matches \.env\.encrypted — nothing to do/);
    expect(JSON.parse(run(projectA, ["decrypt", "--key", key, "--json"]).stdout)).toMatchObject({
      success: true,
      changed: false,
    });
  });

  it("decrypt names what an overwrite would lose when it can't ask", () => {
    writeFileSync(join(projectA, ".env"), "SHARED=team\nREMOTE_ONLY=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    writeFileSync(join(projectA, ".env"), "SHARED=my-edit\nLOCAL_ONLY=1\n");

    const result = run(projectA, ["decrypt", "--key", key]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /would replace SHARED; would remove LOCAL_ONLY; would add REMOTE_ONLY\)\. Pass --yes/,
    );
    expect(result.stderr).not.toMatch(/my-edit|team/);
    expect(readFileSync(join(projectA, ".env"), "utf8")).toBe("SHARED=my-edit\nLOCAL_ONLY=1\n");

    const json = JSON.parse(run(projectA, ["decrypt", "--key", key, "--json"]).stdout);
    expect(json.error).toMatch(/would replace SHARED/);
  });

  it("writes working .gitignore rules for ./x and .\\x style file arguments", () => {
    expect(git(projectA, ["init", "-q"])).toBe(0);
    writeFileSync(join(projectA, ".env.production"), "A=1\n");
    writeFileSync(join(projectA, ".env.staging"), "B=1\n");

    expect(run(projectA, ["init", "./.env.production"]).code).toBe(0);
    // `.\.env.staging` on Windows (PowerShell tab completion), `./.env.staging` elsewhere.
    const init = run(projectA, ["init", `.${sep}.env.staging`, "--json"]);
    expect(JSON.parse(init.stdout).file).toBe(".env.staging");

    const gitignore = readFileSync(join(projectA, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env\.production$/m);
    expect(gitignore).toMatch(/^\.env\.staging$/m);
    expect(gitignore).not.toMatch(/^\.[/\\]/m);
    expect(git(projectA, ["check-ignore", "-q", ".env.production"])).toBe(0);
    expect(git(projectA, ["check-ignore", "-q", ".env.staging"])).toBe(0);
  });

  it("adds the ! exception once, and says so when a directory rule still blocks it", () => {
    expect(git(projectA, ["init", "-q"])).toBe(0);
    mkdirSync(join(projectA, "secrets"));
    writeFileSync(join(projectA, "secrets", ".env"), "S=1\n");
    writeFileSync(join(projectA, ".gitignore"), "secrets/\n");

    const init = run(projectA, ["init", "secrets/.env"]);
    expect(init.stdout).toMatch(/secrets\/\.env\.encrypted is still ignored by rule secrets\//);
    const key = extractKey(init.stdout);
    run(projectA, ["init", "secrets/.env", "--yes", "--key", key]);
    run(projectA, ["decrypt", "secrets/.env", "--key", key, "--yes"]);

    const gitignore = readFileSync(join(projectA, ".gitignore"), "utf8");
    expect(gitignore.match(/^!secrets\/\.env\.encrypted$/gm)).toHaveLength(1);
    expect(run(projectA, ["status", "secrets/.env"]).stdout).toMatch(
      /fix: stop ignoring secrets\/ \(a ! rule can't re-include files inside an ignored directory\)/,
    );
  });

  it("key shows your key as words and hex, and which encrypted files here it opens", () => {
    writeFileSync(join(projectA, ".env"), "A=1\n");
    writeFileSync(join(projectA, ".env.staging"), "B=1\n");
    const key = extractKey(run(projectA, ["init"]).stdout);
    run(projectA, ["init", ".env.staging"]); // a different key

    const fp = fingerprint(parseKey(key));
    const result = run(projectA, ["key"], { env: { ENVLOPE_KEY: key } });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`key  ${fingerprintWords(fp)}  (${formatFingerprint(fp)})`);
    expect(result.stdout).toMatch(/from ENVLOPE_KEY/);
    expect(result.stdout).toMatch(/✓ opens \.env\.encrypted/);
    expect(result.stdout).toMatch(/✗ doesn't open \.env\.staging\.encrypted/);

    const json = JSON.parse(run(projectA, ["key", "--key", key, "--json"]).stdout);
    expect(json).toMatchObject({
      fingerprint: fp,
      fingerprint_words: fingerprintWords(fp),
      source: "the --key option",
      files: [
        { file: ".env.encrypted", opens: true },
        { file: ".env.staging.encrypted", opens: false },
      ],
    });
  });

  it("key exits 1 when it opens none of the encrypted files here", () => {
    writeFileSync(join(projectA, ".env"), "A=1\n");
    run(projectA, ["init"]);
    const other = "envlope_key_" + Buffer.alloc(32, 9).toString("base64");
    const result = run(projectA, ["key", "--key", other]);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/✗ doesn't open \.env\.encrypted/);
  });

  it("lists a change to the first variable of a file that starts with a byte-order mark", () => {
    writeFileSync(join(projectA, ".env"), "\xef\xbb\xbfFIRST=1\nSECOND=2\n", "latin1");
    const key = extractKey(run(projectA, ["init"]).stdout);
    writeFileSync(join(projectA, ".env"), "\xef\xbb\xbfFIRST=changed\nSECOND=2\n", "latin1");
    expect(run(projectA, ["encrypt", "--key", key]).stdout).toMatch(/~ FIRST/);
  });

  // --- safety checks ---

  it.runIf(process.platform === "win32")("never runs a git.exe from the project folder", () => {
    writeFileSync(join(projectA, ".env"), "X=1\n");
    copyFileSync(process.execPath, join(projectA, "git.exe"));
    // The planted "git" is node, so these scripts would run as `git check-ignore …`
    // and `git ls-files …`.
    for (const script of ["check-ignore", "ls-files"]) {
      writeFileSync(join(projectA, script), 'require("fs").writeFileSync("PLANTED_GIT_RAN", "")');
    }
    // Windows searches the current folder first unless this is set (some shells set it).
    const env = { NoDefaultCurrentDirectoryInExePath: undefined };

    const key = extractKey(run(projectA, ["init"], { env }).stdout);
    run(projectA, ["status"], { env });
    run(projectA, ["decrypt", "--key", key, "--yes"], { env });
    expect(existsSync(join(projectA, "PLANTED_GIT_RAN"))).toBe(false);
  });

  it("flags a .env that git already tracks, since .gitignore can't stop it", () => {
    expect(git(projectA, ["init", "-q"])).toBe(0);
    writeFileSync(join(projectA, ".env"), "SECRET=old\n");
    expect(git(projectA, ["add", ".env"])).toBe(0);
    const commit = ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"];
    expect(git(projectA, commit)).toBe(0);

    const init = run(projectA, ["init"]);
    expect(init.stdout).toMatch(/\.env is tracked by git, so \.gitignore won't keep it out/);
    expect(init.stdout).toMatch(/Run git rm --cached \.env/);
    expect(init.stdout).not.toMatch(/already protects/);
    expect(run(projectA, ["status"]).stdout).toMatch(
      /✗ \.env ignored +tracked by git, so \.gitignore doesn't keep it out of commits\n +fix: git rm --cached \.env/,
    );
    const status = JSON.parse(run(projectA, ["status", "--json"]).stdout);
    expect(status).toMatchObject({ tracked: true, gitignored: false });

    expect(git(projectA, ["rm", "-q", "--cached", ".env"])).toBe(0);
    const fixed = JSON.parse(run(projectA, ["status", "--json"]).stdout);
    expect(fixed).toMatchObject({ tracked: false, gitignored: true });
  });

  it("doesn't count an indented .gitignore line as covering .env, in or out of a repo", () => {
    expect(git(projectA, ["init", "-q"])).toBe(0);
    for (const dir of [projectA, projectB]) {
      writeFileSync(join(dir, ".gitignore"), "  .env\n");
      writeFileSync(join(dir, ".env"), "X=1\n");
      expect(run(dir, ["init"]).stdout).toMatch(/added \.env,/);
      expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^\.env$/m);
    }
    expect(git(projectA, ["check-ignore", "-q", ".env"])).toBe(0);
  });

  it("refuses env files outside the current folder", () => {
    writeFileSync(join(projectB, ".env"), "X=1\n");
    const result = run(projectA, ["init", join("..", basename(projectB), ".env")]);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/outside the current folder/);
    expect(existsSync(join(projectB, ".env.encrypted"))).toBe(false);
  });

  it("notices changes to values that aren't valid UTF-8", () => {
    writeFileSync(join(projectA, ".env"), Buffer.from("DB_PASS=caf\xe9\n", "latin1"));
    const key = extractKey(run(projectA, ["init"]).stdout);
    writeFileSync(join(projectA, ".env"), Buffer.from("DB_PASS=caf\xe8\n", "latin1"));
    expect(run(projectA, ["encrypt", "--key", key]).stdout).toMatch(/~ DB_PASS/);
  });

  it("escapes wildcard characters when it writes a file name into .gitignore", () => {
    expect(git(projectA, ["init", "-q"])).toBe(0);
    writeFileSync(join(projectA, ".env[prod]"), "X=1\n");
    expect(run(projectA, ["init", ".env[prod]"]).code).toBe(0);
    expect(readFileSync(join(projectA, ".gitignore"), "utf8")).toMatch(/^\.env\\\[prod\]$/m);
    expect(git(projectA, ["check-ignore", "-q", ".env[prod]"])).toBe(0);
  });
});
