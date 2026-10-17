import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/crypto.js";
import { formatKey, parseKey } from "../src/key.js";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

/** Run envlope in `dir`, without a terminal, a key in the environment or colors. */
function run(dir: string, args: string[], env: Record<string, string> = {}) {
  const clean: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  delete clean.ENVLOPE_KEY;
  const result = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...clean, ...env },
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const json = (stdout: string) => JSON.parse(stdout) as Record<string, any>;
const statuses = (result: Record<string, any>) =>
  Object.fromEntries(result.repos.map((r: any) => [r.repo, r.status]));

describe("--all", () => {
  let root: string;
  const repo = (name: string, env?: string) => {
    mkdirSync(join(root, name));
    spawnSync("git", ["init", "-q"], { cwd: join(root, name) });
    if (env !== undefined) writeFileSync(join(root, name, ".env"), env);
  };
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const opens = (name: string, key: string) =>
    decrypt(read(`${name}/.env.encrypted`), parseKey(key)).toString();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "envlope-all-"));
    repo("shop-back", "DB=postgres://shop\nAPI=1\n");
    repo("users-back", "DB=postgres://users\n");
    repo("web-front", "URL=https://web\n");
    repo("docs");
    mkdirSync(join(root, "not-a-repo"));
    writeFileSync(join(root, "not-a-repo", ".env"), "SECRET=1\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe("init --all", () => {
    it("sets up every repo with a .env under one key, and skips the rest", () => {
      const result = run(root, ["init", "--all", "--json"]);
      expect(result.code).toBe(0);
      const data = json(result.stdout);
      expect(statuses(data)).toEqual({
        docs: "skipped",
        "shop-back": "done",
        "users-back": "done",
        "web-front": "done",
      });
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].source).toBe("new");
      expect(data.keys[0].repos).toEqual(["shop-back", "users-back", "web-front"]);
      const key = data.keys[0].key as string;
      expect(opens("shop-back", key)).toBe("DB=postgres://shop\nAPI=1\n");
      expect(opens("web-front", key)).toBe("URL=https://web\n");
      expect(read("users-back/.gitignore")).toMatch(/^\.env$/m);
      // A folder without .git is never touched.
      expect(existsSync(join(root, "not-a-repo", ".env.encrypted"))).toBe(false);
      expect(data.summary).toMatchObject({ done: 3, skipped: 1, problem: 0 });
    });

    it("prints rows, totals and one key card in a shell", () => {
      const result = run(root, ["init", "--all"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("envlope init --all · 4 repos in");
      expect(result.stdout).toMatch(/✓ shop-back\s+encrypted · 2 variables/);
      expect(result.stdout).toContain("3 set up");
      expect(result.stdout).toContain("1 skipped, no .env: docs");
      expect(result.stdout.match(/SAVE THIS KEY/g)).toHaveLength(1);
      expect(result.stdout).toContain("for 3 repos: shop-back, users-back, web-front");
    });

    it("uses --key everywhere without printing it", () => {
      const key = formatKey(Buffer.alloc(32, 9));
      const result = run(root, ["init", "--all", "--key", key, "--json"]);
      expect(result.code).toBe(0);
      const data = json(result.stdout);
      expect(data.keys[0]).toMatchObject({ source: "--key" });
      expect(data.keys[0].key).toBeUndefined();
      expect(opens("users-back", key)).toBe("DB=postgres://users\n");
      expect(run(root, ["init", "--all", "--key", key]).stdout).not.toContain("envlope_key_");
    });

    it("leaves encrypted repos alone without --yes, and re-encrypts them with it", () => {
      const old = formatKey(Buffer.alloc(32, 1));
      writeFileSync(
        join(root, "shop-back", ".env.encrypted"),
        `${encrypt(Buffer.from("DB=old\n"), parseKey(old))}\n`,
      );
      const before = read("shop-back/.env.encrypted");

      const first = json(run(root, ["init", "--all", "--json"]).stdout);
      expect(first.repos.find((r: any) => r.repo === "shop-back")).toMatchObject({
        status: "skipped",
        detail: "already set up; --yes re-encrypts it",
      });
      expect(read("shop-back/.env.encrypted")).toBe(before);

      const second = json(run(root, ["init", "--all", "--yes", "--json"]).stdout);
      const key = second.keys[0].key as string;
      expect(statuses(second)["shop-back"]).toBe("done");
      expect(opens("shop-back", key)).toBe("DB=postgres://shop\nAPI=1\n");
      expect(read("shop-back/.env.encrypted.bak")).toBe(before);
    });

    it("doesn't rewrite a repo that already uses the key", () => {
      const key = formatKey(Buffer.alloc(32, 4));
      run(root, ["init", "--all", "--key", key]);
      const before = read("shop-back/.env.encrypted");
      writeFileSync(join(root, "shop-back", ".env"), "DB=changed\n");

      const data = json(run(root, ["init", "--all", "--yes", "--key", key, "--json"]).stdout);
      const shop = data.repos.find((r: any) => r.repo === "shop-back");
      expect(shop).toMatchObject({ status: "unchanged", detail: "already uses this key" });
      expect(shop.notes[0]).toContain("envlope encrypt --all");
      expect(read("shop-back/.env.encrypted")).toBe(before);
    });

    it("passes on plaintext warnings, like a tracked .env", () => {
      spawnSync("git", ["add", ".env"], { cwd: join(root, "web-front") });
      const result = run(root, ["init", "--all"]);
      expect(result.stdout).toMatch(/✓ web-front[^\n]*\n\s+⚠ \.env is tracked by git/);
      const data = json(run(root, ["init", "--all", "--yes", "--json"]).stdout);
      expect(data.repos.find((r: any) => r.repo === "web-front").warnings[0]).toMatch(
        /tracked by git/,
      );
    });
  });

  describe("with two keys", () => {
    const backend = formatKey(Buffer.alloc(32, 2));
    const frontend = formatKey(Buffer.alloc(32, 3));

    beforeEach(() => {
      expect(run(root, ["init", "--all", "--only", "*-back", "--key", backend]).code).toBe(0);
      expect(run(root, ["init", "--all", "--only", "*-front", "--key", frontend]).code).toBe(0);
    });

    it("key --all shows which repos a key opens", () => {
      const result = run(root, ["key", "--all", "--key", backend]);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/✓ shop-back\s+opens/);
      expect(result.stdout).toContain("2 opened");
      expect(result.stdout).toContain("○ 1 repo needs a different key: web-front");
      expect(run(root, ["key", "--all", "--key", formatKey(Buffer.alloc(32, 8))]).code).toBe(1);
    });

    it("decrypt --all decrypts what the key opens and lists the rest", () => {
      rmSync(join(root, "shop-back", ".env"));
      const result = run(root, ["decrypt", "--all", "--key", backend, "--json"]);
      expect(result.code).toBe(0);
      expect(statuses(json(result.stdout))).toEqual({
        docs: "skipped",
        "shop-back": "done",
        "users-back": "unchanged",
        "web-front": "other_key",
      });
      expect(read("shop-back/.env")).toBe("DB=postgres://shop\nAPI=1\n");
    });

    it("decrypt --all keeps local changes unless --yes, and says so", () => {
      writeFileSync(join(root, "users-back", ".env"), "DB=postgres://mine\n");
      const kept = run(root, ["decrypt", "--all", "--key", backend]);
      expect(kept.code).toBe(1);
      expect(kept.stdout).toMatch(
        /▲ users-back\s+\.env has local changes \(decrypting would replace DB\)/,
      );
      expect(kept.stderr).toContain("Rerun with --yes");
      expect(read("users-back/.env")).toBe("DB=postgres://mine\n");

      const data = json(run(root, ["decrypt", "--all", "--key", backend, "--json"]).stdout);
      const users = data.repos.find((r: any) => r.repo === "users-back");
      expect(users.result).toMatchObject({
        reason: "local_changes",
        variables: { changed: ["DB"] },
      });

      expect(run(root, ["decrypt", "--all", "--key", backend, "--yes"]).code).toBe(0);
      expect(read("users-back/.env")).toBe("DB=postgres://users\n");
    });

    it("decrypt --all fails when the key opens none of them", () => {
      const result = run(root, ["decrypt", "--all", "--key", formatKey(Buffer.alloc(32, 8))]);
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("○ 3 repos need a different key");
    });

    it("encrypt --all updates the repos that changed, naming the variables", () => {
      writeFileSync(join(root, "shop-back", ".env"), "DB=postgres://shop\nAPI=2\nNEW=1\n");
      const result = run(root, ["encrypt", "--all", "--key", backend]);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/✓ shop-back\s+updated: added NEW; changed API/);
      expect(result.stdout).toMatch(/✓ users-back\s+already up to date/);
      expect(result.stdout).toContain("1 updated · 1 already up to date");
      expect(opens("shop-back", backend)).toBe("DB=postgres://shop\nAPI=2\nNEW=1\n");
    });

    it("encrypt --all won't undo someone else's newer version", () => {
      // A teammate's update arrives with git pull, after this .env was made.
      const theirs = `${encrypt(Buffer.from("DB=postgres://users\nTHEIRS=1\n"), parseKey(backend))}\n`;
      writeFileSync(join(root, "users-back", ".env.encrypted"), theirs);
      writeFileSync(join(root, "users-back", ".env"), "DB=postgres://users\nMINE=1\n");

      const result = run(root, ["encrypt", "--all", "--key", backend, "--json"]);
      expect(result.code).toBe(1);
      const users = json(result.stdout).repos.find((r: any) => r.repo === "users-back");
      expect(users).toMatchObject({ status: "attention", result: { reason: "newer_version" } });
      expect(read("users-back/.env.encrypted")).toBe(theirs);

      expect(run(root, ["encrypt", "--all", "--key", backend, "--force"]).code).toBe(0);
      expect(opens("users-back", backend)).toBe("DB=postgres://users\nMINE=1\n");
    });
  });

  describe("status --all", () => {
    it("checks each repo, with fixes for the problems", () => {
      run(root, ["init", "--all"]);
      // .env is ignored by now, so it takes -f to track it.
      spawnSync("git", ["add", "-f", ".env"], { cwd: join(root, "web-front") });
      writeFileSync(join(root, "shop-back", ".env.bak"), "DB=old\n");

      const result = run(root, ["status", "--all"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/✓ users-back\s+in sync/);
      expect(result.stdout).toMatch(
        /✗ shop-back\s+1 problem\n\s+\.env\.bak: a plaintext env file that git could commit\n\s+fix: add \.env\.bak/,
      );
      expect(result.stdout).toMatch(/✗ web-front\s+1 problem/);
      expect(result.stdout).toContain("1 healthy · 2 with problems");
      expect(result.stdout).toContain("1 skipped, no env files: docs");

      const data = json(run(root, ["status", "--all", "--json"]).stdout);
      const web = data.repos.find((r: any) => r.repo === "web-front");
      expect(web.result.issues[0]).toMatchObject({
        check: ".env ignored",
        fix: expect.stringContaining("git rm --cached .env"),
      });
    });

    it("fails with --strict only when a repo has unencrypted edits", () => {
      run(root, ["init", "--all"]);
      expect(run(root, ["status", "--all", "--strict"]).code).toBe(0);
      const later = new Date(Date.now() + 5000);
      writeFileSync(join(root, "users-back", ".env"), "DB=edited\n");
      utimesSync(join(root, "users-back", ".env"), later, later);
      expect(run(root, ["status", "--all", "--strict"]).code).toBe(1);
    });
  });

  describe("choosing repos", () => {
    it("--only narrows by folder name, with ! to leave some out", () => {
      const data = json(run(root, ["init", "--all", "--only", "*-back,!users-*", "--json"]).stdout);
      expect(data.repos.map((r: any) => r.repo)).toEqual(["shop-back"]);
    });

    it("refuses --only without --all, a pattern matching nothing, or a full --file path", () => {
      const alone = run(root, ["status", "--only", "*-back"]);
      expect(alone.code).toBe(1);
      expect(alone.stderr).toContain("--only works with --all");

      const nothing = run(root, ["status", "--all", "--only", "zzz*"]);
      expect(nothing.code).toBe(1);
      expect(nothing.stderr).toContain("None of the 4 repos here matches --only zzz*");

      const full = run(root, ["status", "--all", join(root, ".env")]);
      expect(full.code).toBe(1);
      expect(full.stderr).toContain("name the env file as it is inside each repo");
    });

    it("explains when there are no repos, or nothing to do", () => {
      const empty = mkdtempSync(join(tmpdir(), "envlope-none-"));
      try {
        const none = run(empty, ["status", "--all"]);
        expect(none.code).toBe(1);
        expect(none.stderr).toContain("No git repos in");
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
      const decrypting = run(root, ["decrypt", "--all", "--key", formatKey(Buffer.alloc(32, 1))]);
      expect(decrypting.code).toBe(1);
      expect(decrypting.stderr).toContain("None of the 4 repos here has a .env.encrypted");
    });

    it("works with another env file name", () => {
      writeFileSync(join(root, "docs", ".env.local"), "LOCAL=1\n");
      const data = json(run(root, ["init", ".env.local", "--all", "--json"]).stdout);
      expect(statuses(data)).toMatchObject({ docs: "done", "shop-back": "skipped" });
      expect(
        decrypt(read("docs/.env.local.encrypted"), parseKey(data.keys[0].key)).toString(),
      ).toBe("LOCAL=1\n");
    });
  });
});
