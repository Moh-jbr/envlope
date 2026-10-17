import { describe, expect, it } from "vitest";
import { describeOverwrite, describeRule, listNames, summarizeOverwrite } from "../src/output.js";

// picocolors enables color on Windows even without a TTY; compare plain text.
const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("decrypt overwrite messages", () => {
  const diff = { changed: ["DATABASE_URL"], removed: ["DEBUG"], added: ["SENTRY_DSN"] };

  it("lists what an overwrite would replace, remove and add, aligned by name", () => {
    expect(plain(describeOverwrite(".env", diff)).split("\n")).toEqual([
      ".env already exists and differs from .env.encrypted",
      "",
      "changed   DATABASE_URL   your local value is replaced",
      "removed   DEBUG          only in your local .env",
      "added     SENTRY_DSN     new in .env.encrypted",
    ]);
  });

  it("says when only comments or formatting differ", () => {
    const none = { changed: [], removed: [], added: [] };
    expect(plain(describeOverwrite(".env", none))).toMatch(/Only comments or formatting differ/);
    expect(summarizeOverwrite(none)).toBe("only comments or formatting differ");
  });

  it("summarizes on one line for non-interactive errors", () => {
    expect(summarizeOverwrite(diff)).toBe(
      "would replace DATABASE_URL; would remove DEBUG; would add SENTRY_DSN",
    );
  });
});

describe("listNames", () => {
  it("truncates long lists with a count", () => {
    expect(listNames(["A", "B"])).toBe("A, B");
    expect(listNames(["A", "B", "C", "D"], 2)).toBe("A, B and 2 more");
  });
});

describe("describeRule", () => {
  it("names the rule and where it lives", () => {
    const rule = { source: ".gitignore", line: 2, pattern: ".env*" };
    expect(describeRule(rule)).toBe("rule .env* (.gitignore line 2)");
  });

  it("replaces control characters, so a .gitignore line can't rewrite the screen", () => {
    const rule = {
      source: ".gitignore",
      line: 1,
      pattern: ".env" + String.fromCharCode(27) + "[2J",
    };
    expect(describeRule(rule)).toBe("rule .env?[2J (.gitignore line 1)");
  });
});
