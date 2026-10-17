import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptCommand } from "../src/commands/encrypt.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { recordBase } from "../src/files.js";
import { formatKey } from "../src/key.js";
import { choose, showWarning } from "../src/ui.js";

const state = vi.hoisted(() => ({ base: null as string | null }));

// Act as a person at a terminal: prompting works, and each test picks the answer.
vi.mock("../src/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ui.js")>()),
  canPrompt: () => true,
  choose: vi.fn(),
  showWarning: vi.fn(),
}));

// In-process, cwd is the repo itself, so hand the command its recorded base directly
// and accept these tests' absolute temp paths (the CLI tests cover the real thing).
vi.mock("../src/files.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/files.js")>()),
  normalizeEnvFile: (file: string) => file,
  readBase: () => state.base,
  recordBase: vi.fn(),
}));

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const BASE = "# team\nDATABASE_URL=postgres://base\nAPI_KEY=base-key\nDEBUG=false\n";
const THEIRS =
  "# team\nDATABASE_URL=postgres://base\nAPI_KEY=their-key\nDEBUG=false\nSENTRY_DSN=https://sentry\n";
const MINE = "# team\nDATABASE_URL=postgres://base\nAPI_KEY=base-key\nDEBUG=true\n";

describe("encrypt's conflict guard in a terminal", () => {
  const key = Buffer.alloc(32, 5);
  let dir: string;
  let file: string;
  const encrypted = () => decrypt(readFileSync(`${file}.encrypted`, "utf8"), key).toString();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "envlope-merge-"));
    file = join(dir, ".env");
    state.base = encrypt(Buffer.from(BASE), key);
    writeFileSync(`${file}.encrypted`, `${encrypt(Buffer.from(THEIRS), key)}\n`);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(choose).mockReset();
    vi.mocked(showWarning).mockReset();
    vi.mocked(recordBase).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("merges their changes and yours into both files when you pick Merge", async () => {
    writeFileSync(file, MINE);
    vi.mocked(choose).mockResolvedValueOnce("merge");

    expect(await encryptCommand({ file, key: formatKey(key) })).toBe(0);

    const warning = plain(vi.mocked(showWarning).mock.calls[0]![0]);
    expect(warning).toMatch(/theirs {3}\+ SENTRY_DSN {2}~ API_KEY/);
    expect(warning).toMatch(/yours {4}~ DEBUG/);
    const [, options, initial] = vi.mocked(choose).mock.calls[0]!;
    expect(options.map((o) => o.value)).toEqual(["merge", "overwrite", "cancel"]);
    expect(initial).toBe("merge");

    const merged =
      "# team\nDATABASE_URL=postgres://base\nAPI_KEY=their-key\nDEBUG=true\nSENTRY_DSN=https://sentry\n";
    expect(readFileSync(file, "utf8")).toBe(merged);
    expect(encrypted()).toBe(merged);
    expect(recordBase).toHaveBeenCalled();
  });

  it("leaves both files alone when you cancel", async () => {
    writeFileSync(file, MINE);
    vi.mocked(choose).mockResolvedValueOnce("cancel");

    expect(await encryptCommand({ file, key: formatKey(key) })).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(MINE);
    expect(encrypted()).toBe(THEIRS);
    expect(recordBase).not.toHaveBeenCalled();
  });

  it("encrypts your file as it is when you pick Overwrite", async () => {
    writeFileSync(file, MINE);
    vi.mocked(choose).mockResolvedValueOnce("overwrite");

    expect(await encryptCommand({ file, key: formatKey(key) })).toBe(0);
    expect(encrypted()).toBe(MINE);
  });

  it("doesn't offer Merge when you both changed a variable, and defaults to Cancel", async () => {
    writeFileSync(file, MINE.replace("base-key", "my-key"));
    vi.mocked(choose).mockResolvedValueOnce(null);

    expect(await encryptCommand({ file, key: formatKey(key) })).toBe(0);
    expect(plain(vi.mocked(showWarning).mock.calls[0]![0])).toMatch(/both {5}API_KEY/);
    const [, options, initial] = vi.mocked(choose).mock.calls[0]!;
    expect(options.map((o) => o.value)).toEqual(["overwrite", "cancel"]);
    expect(initial).toBe("cancel");
    expect(encrypted()).toBe(THEIRS);
  });

  it("offers to take their version when you have no changes of your own", async () => {
    writeFileSync(file, `${BASE}# a note of mine\n`);
    vi.mocked(choose).mockResolvedValueOnce("merge");

    expect(await encryptCommand({ file, key: formatKey(key) })).toBe(0);
    expect(vi.mocked(choose).mock.calls[0]![1][0]!.label).toMatch(/Take their changes/);
    expect(readFileSync(file, "utf8")).toBe(THEIRS);
    expect(encrypted()).toBe(THEIRS);
  });
});
