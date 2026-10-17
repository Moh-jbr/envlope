import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptAll, encryptAll, initAll } from "../src/all.js";
import { decrypt, encrypt } from "../src/crypto.js";
import { formatKey, parseKey } from "../src/key.js";
import { ask, choose, confirm, pickMany, promptKey, showNote } from "../src/ui.js";

// A person at a terminal: prompts work (except in --json mode), and each test
// gives the answers. The runner changes folders, so this file runs in a forked
// worker (see vitest.config.ts).
vi.mock("../src/ui.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/ui.js")>()),
  canPrompt: (options: { json?: boolean } = {}) => !options.json,
  ask: vi.fn(),
  choose: vi.fn(),
  confirm: vi.fn(),
  pickMany: vi.fn(),
  promptKey: vi.fn(),
  showNote: vi.fn(),
  showWarning: vi.fn(),
}));

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const backend = formatKey(Buffer.alloc(32, 2));
const frontend = formatKey(Buffer.alloc(32, 3));

describe("--all in a terminal", () => {
  let root: string;
  let home: string;
  let logs: string[];
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const opens = (repo: string, key: string) =>
    decrypt(read(`${repo}/.env.encrypted`), parseKey(key)).toString();
  const lock = (repo: string, key: string, text = read(`${repo}/.env`)) =>
    writeFileSync(
      join(root, repo, ".env.encrypted"),
      `${encrypt(Buffer.from(text), parseKey(key))}\n`,
    );
  const output = () => plain(logs.join("\n"));

  beforeEach(() => {
    home = process.cwd();
    root = mkdtempSync(join(tmpdir(), "envlope-all-tty-"));
    for (const [repo, env] of [
      ["shop-back", "DB=postgres://shop\n"],
      ["users-back", "DB=postgres://users\n"],
      ["web-front", "URL=https://web\n"],
    ] as const) {
      mkdirSync(join(root, repo));
      spawnSync("git", ["init", "-q"], { cwd: join(root, repo) });
      writeFileSync(join(root, repo, ".env"), env);
    }
    process.chdir(root);
    delete process.env.ENVLOPE_KEY;
    logs = [];
    const keep = (...args: unknown[]) => void logs.push(args.join(" "));
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
    for (const prompt of [ask, choose, confirm, pickMany, promptKey, showNote]) {
      vi.mocked(prompt).mockReset();
    }
    // Pressing enter in the checklist keeps what it started with.
    vi.mocked(pickMany).mockImplementation(async (_message, _options, initial) => initial ?? []);
  });

  afterEach(() => {
    process.chdir(home);
    delete process.env.ENVLOPE_KEY;
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  describe("init --all", () => {
    it("locks every repo with one new key", async () => {
      vi.mocked(choose).mockResolvedValueOnce("one").mockResolvedValueOnce("new");

      expect(await initAll({})).toBe(0);

      const keys = output().match(/envlope_key_[A-Za-z0-9+/=]+/g)!;
      expect(keys).toHaveLength(1);
      for (const repo of ["shop-back", "users-back", "web-front"]) {
        expect(opens(repo, keys[0]!)).toBe(read(`${repo}/.env`));
      }
      const [question, modes] = vi.mocked(choose).mock.calls[0]!;
      expect(question).toBe("How do you want to lock these 3 repos?");
      expect(modes.map((m) => m.value)).toEqual(["one", "several"]);
    });

    it("gives each group of repos its own key: suggested by name, then from ENVLOPE_KEY", async () => {
      process.env.ENVLOPE_KEY = frontend;
      vi.mocked(ask).mockResolvedValueOnce("2");
      vi.mocked(choose)
        .mockResolvedValueOnce("several")
        .mockResolvedValueOnce("match:*-back") // key 1: names like *-back
        .mockResolvedValueOnce("new") // key 1: a new key
        .mockResolvedValueOnce("env"); // key 2: the rest, with ENVLOPE_KEY
      vi.mocked(confirm).mockResolvedValueOnce(true);

      expect(await initAll({})).toBe(0);

      // Key 1 started from the suggested pattern; key 2 from what was left.
      const [startQuestion, starts, initialStart] = vi.mocked(choose).mock.calls[1]!;
      expect(startQuestion).toBe("Key 1 of 2 · which repos is it for?");
      expect(starts.map((s) => s.value)).toEqual(["match:*-back", "pattern", "pick"]);
      expect(initialStart).toBe("match:*-back");
      expect(vi.mocked(pickMany).mock.calls[0]![2]).toEqual(["shop-back", "users-back"]);
      expect(vi.mocked(pickMany).mock.calls[1]![2]).toEqual(["web-front"]);

      const plan = vi.mocked(showNote).mock.calls[0]![0];
      expect(plan).toMatch(/key 1\s+new key · 2 repos: shop-back, users-back/);
      expect(plan).toMatch(/key 2\s+from ENVLOPE_KEY · 1 repo: web-front/);

      // Only the new key is shown, to be saved; it opens just the backend.
      const keys = output().match(/envlope_key_[A-Za-z0-9+/=]+/g)!;
      expect(keys).toHaveLength(1);
      expect(opens("shop-back", keys[0]!)).toBe("DB=postgres://shop\n");
      expect(opens("users-back", keys[0]!)).toBe("DB=postgres://users\n");
      expect(opens("web-front", frontend)).toBe("URL=https://web\n");
      expect(() => opens("web-front", keys[0]!)).toThrow();
    });

    it("checks the number of keys", async () => {
      vi.mocked(choose).mockResolvedValueOnce("several");
      vi.mocked(ask).mockResolvedValueOnce(null);
      expect(await initAll({})).toBe(130);

      const { validate } = vi.mocked(ask).mock.calls[0]![1]!;
      expect(validate!("")).toBeUndefined(); // the default, 2
      expect(validate!("3")).toBeUndefined();
      expect(validate!("1")).toMatch(/2 or more/);
      expect(validate!("2.5")).toMatch(/whole number/);
      expect(validate!("4")).toMatch(/3 repos, so 3 keys at most/);
    });

    it("refuses a pasted key that another group already uses", async () => {
      vi.mocked(ask).mockResolvedValueOnce("2");
      vi.mocked(choose)
        .mockResolvedValueOnce("several")
        .mockResolvedValueOnce("pick")
        .mockResolvedValueOnce("paste")
        .mockResolvedValueOnce("paste");
      vi.mocked(pickMany)
        .mockResolvedValueOnce(["shop-back"])
        .mockImplementationOnce(async (_m, _o, initial) => initial ?? []);
      vi.mocked(promptKey).mockResolvedValueOnce(backend).mockResolvedValueOnce(frontend);
      vi.mocked(confirm).mockResolvedValueOnce(true);

      expect(await initAll({})).toBe(0);

      const check = vi.mocked(promptKey).mock.calls[1]![1]!;
      expect(check(backend)).toBe("That key is already picked for other repos.");
      expect(check("envlope_key_short")).toMatch(/bytes/);
      expect(check(frontend)).toBeUndefined();
      expect(opens("shop-back", backend)).toBe("DB=postgres://shop\n");
      expect(opens("users-back", frontend)).toBe("DB=postgres://users\n");
      // Pasted keys are yours already, so there's no key card.
      expect(output()).not.toContain("SAVE THIS KEY");
    });

    it("writes nothing when the plan is turned down", async () => {
      vi.mocked(ask).mockResolvedValueOnce("2");
      vi.mocked(choose)
        .mockResolvedValueOnce("several")
        .mockResolvedValueOnce("match:*-back")
        .mockResolvedValueOnce("new")
        .mockResolvedValueOnce("new");
      vi.mocked(confirm).mockResolvedValueOnce(false);

      expect(await initAll({})).toBe(130);
      for (const repo of ["shop-back", "users-back", "web-front"]) {
        expect(existsSync(join(root, repo, ".env.encrypted"))).toBe(false);
      }
      expect(output()).toContain("Cancelled. Nothing was changed.");
    });

    it("asks before re-encrypting repos that already have a key", async () => {
      lock("shop-back", backend);
      const before = read("shop-back/.env.encrypted");
      vi.mocked(choose)
        .mockResolvedValueOnce("leave")
        .mockResolvedValueOnce("one")
        .mockResolvedValueOnce("new");

      expect(await initAll({})).toBe(0);
      expect(vi.mocked(choose).mock.calls[0]![0]).toBe(
        "1 repo already has a .env.encrypted (shop-back). Re-encrypt it too?",
      );
      expect(read("shop-back/.env.encrypted")).toBe(before);
      expect(existsSync(join(root, "users-back", ".env.encrypted"))).toBe(true);

      vi.mocked(choose)
        .mockResolvedValueOnce("include")
        .mockResolvedValueOnce("one")
        .mockResolvedValueOnce("new");
      expect(await initAll({})).toBe(0);
      expect(() => opens("shop-back", backend)).toThrow();
      expect(read("shop-back/.env.encrypted.bak")).toBe(before);
    });
  });

  describe("more than one key", () => {
    beforeEach(() => {
      lock("shop-back", backend);
      lock("users-back", backend);
      lock("web-front", frontend);
      for (const repo of ["shop-back", "users-back", "web-front"]) rmSync(join(root, repo, ".env"));
    });

    it("decrypt --all asks for another key for the repos the first doesn't open", async () => {
      process.env.ENVLOPE_KEY = backend;
      vi.mocked(choose).mockResolvedValueOnce("key");
      vi.mocked(promptKey).mockResolvedValueOnce(frontend);

      expect(await decryptAll({})).toBe(0);

      expect(output()).toContain("○ 1 repo needs a different key: web-front");
      const check = vi.mocked(promptKey).mock.calls[0]![1]!;
      expect(check(backend)).toBe("That key was already tried.");
      expect(read("shop-back/.env")).toBe("DB=postgres://shop\n");
      expect(read("web-front/.env")).toBe("URL=https://web\n");
    });

    it("keeps asking while keys miss, and says when one opens nothing", async () => {
      vi.mocked(choose).mockResolvedValueOnce("key").mockResolvedValueOnce("key");
      vi.mocked(promptKey)
        .mockResolvedValueOnce(formatKey(Buffer.alloc(32, 7)))
        .mockResolvedValueOnce(frontend);

      expect(await decryptAll({ key: backend })).toBe(0);

      expect(output()).toContain("it doesn't open any of them either");
      expect(vi.mocked(choose)).toHaveBeenCalledTimes(2);
      expect(read("web-front/.env")).toBe("URL=https://web\n");
    });

    it("skipping the other key leaves those repos out", async () => {
      vi.mocked(choose).mockResolvedValueOnce("skip");
      expect(await decryptAll({ key: backend })).toBe(0);
      expect(existsSync(join(root, "web-front", ".env"))).toBe(false);
      expect(output()).toContain("1 repo needs a different key: web-front");
    });
  });

  describe("decisions after the run", () => {
    beforeEach(() => {
      lock("shop-back", backend);
      lock("users-back", backend);
      writeFileSync(join(root, "users-back", ".env"), "DB=postgres://mine\n");
    });

    it.each([
      ["overwrite", "DB=postgres://users\n"],
      ["keep", "DB=postgres://mine\n"],
    ])("decrypt --all asks about local changes: %s", async (answer, after) => {
      vi.mocked(choose).mockResolvedValueOnce(answer);
      expect(await decryptAll({ key: backend, only: "*-back" })).toBe(0);
      expect(output()).toContain(
        "▲ 1 repo has local changes that decrypting would overwrite: users-back",
      );
      expect(read("users-back/.env")).toBe(after);
    });

    it("decrypt --all can go through them one at a time", async () => {
      vi.mocked(choose).mockResolvedValueOnce("review");
      vi.mocked(confirm).mockResolvedValueOnce(true);
      expect(await decryptAll({ key: backend, only: "*-back" })).toBe(0);
      expect(output()).toContain("── users-back");
      expect(vi.mocked(confirm).mock.calls[0]![0]).toBe("Overwrite .env?");
      expect(read("users-back/.env")).toBe("DB=postgres://users\n");
    });

    it("encrypt --all can merge someone else's newer version", async () => {
      // Record where this .env came from, then a teammate's change arrives.
      writeFileSync(join(root, "users-back", ".env"), "DB=postgres://users\n");
      vi.mocked(choose).mockResolvedValueOnce("keep");
      await decryptAll({ key: backend, only: "users-back" });
      lock("users-back", backend, "DB=postgres://users\nTHEIRS=1\n");
      writeFileSync(join(root, "users-back", ".env"), "DB=postgres://users\nMINE=1\n");

      vi.mocked(choose).mockReset();
      vi.mocked(choose).mockResolvedValueOnce("resolve").mockResolvedValueOnce("merge");
      expect(await encryptAll({ key: backend, only: "users-back" })).toBe(0);

      expect(output()).toContain(
        "▲ .env.encrypted changed since the .env was made in 1 repo: users-back",
      );
      const merged = "DB=postgres://users\nTHEIRS=1\nMINE=1\n";
      expect(read("users-back/.env")).toBe(merged);
      expect(opens("users-back", backend)).toBe(merged);
    });
  });
});
