import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptCommand } from "../src/commands/decrypt.js";
import { encrypt } from "../src/crypto.js";
import { formatKey } from "../src/key.js";
import { confirm, showWarning } from "../src/ui.js";

// Act as a person at a terminal: prompting is possible, and each test picks the answer.
vi.mock("../src/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ui.js")>()),
  canPrompt: () => true,
  confirm: vi.fn(),
  showWarning: vi.fn(),
}));

// In-process, cwd is the repo itself: leave its .gitignore alone, and accept these
// tests' absolute temp paths, which the CLI refuses as outside the current folder
// (the CLI tests cover that).
vi.mock("../src/files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/files.js")>()),
  normalizeEnvFile: (file: string) => file,
  recordBase: vi.fn(),
  ensureGitignore: vi.fn(() => ({
    added: [],
    existed: true,
    env: { ignored: true, rule: null },
    encrypted: { ignored: false, rule: null },
  })),
}));

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("decrypt in an interactive terminal", () => {
  const key = Buffer.alloc(32, 3);
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "envlope-prompt-"));
    file = join(dir, ".env");
    writeFileSync(`${file}.encrypted`, encrypt(Buffer.from("SHARED=team\nREMOTE_ONLY=1\n"), key));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(confirm).mockReset();
    vi.mocked(showWarning).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("shows what an overwrite would change, and keeps .env when the answer is no", async () => {
    writeFileSync(file, "SHARED=mine\nLOCAL_ONLY=1\n");
    vi.mocked(confirm).mockResolvedValueOnce(false);

    expect(await decryptCommand({ file, key: formatKey(key) })).toBe(0);

    const warning = plain(vi.mocked(showWarning).mock.calls[0]![0]);
    // Names are padded to the longest one (REMOTE_ONLY) plus 3, so the notes line up.
    expect(warning).toMatch(/\nchanged {3}SHARED {8}your local value is replaced\n/);
    expect(warning).toMatch(/\nremoved {3}LOCAL_ONLY {4}only in your local .*\.env\n/);
    expect(warning).toMatch(/\nadded {5}REMOTE_ONLY {3}new in .*\.env\.encrypted$/);
    expect(vi.mocked(confirm).mock.calls[0]![0]).toMatch(/^Overwrite .*\.env\?$/);
    expect(readFileSync(file, "utf8")).toBe("SHARED=mine\nLOCAL_ONLY=1\n");
  });

  it("overwrites .env when the answer is yes", async () => {
    writeFileSync(file, "SHARED=mine\n");
    vi.mocked(confirm).mockResolvedValueOnce(true);

    expect(await decryptCommand({ file, key: formatKey(key) })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe("SHARED=team\nREMOTE_ONLY=1\n");
  });

  it("doesn't ask at all when .env already matches", async () => {
    writeFileSync(file, "SHARED=team\nREMOTE_ONLY=1\n");

    expect(await decryptCommand({ file, key: formatKey(key) })).toBe(0);
    expect(showWarning).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
