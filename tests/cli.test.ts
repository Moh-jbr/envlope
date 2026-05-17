import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function run(
  dir: string,
  args: string[],
  options: { input?: string; env?: Record<string, string> } = {},
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
  if (options.env) Object.assign(env, options.env);

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

  // --- v0.2.0 features below ---

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
});
