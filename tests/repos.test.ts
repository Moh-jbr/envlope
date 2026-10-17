import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRepos, matchNames, suggestPatterns } from "../src/repos.js";

describe("findRepos", () => {
  let root: string;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("lists the folders directly inside that hold a .git, in order", () => {
    root = mkdtempSync(join(tmpdir(), "envlope-repos-"));
    for (const name of ["web", "api", "Billing"])
      mkdirSync(join(root, name, ".git"), { recursive: true });
    // A worktree or submodule has a .git file instead of a folder.
    mkdirSync(join(root, "worktree"));
    writeFileSync(join(root, "worktree", ".git"), "gitdir: ../api/.git/worktrees/x\n");
    // Not repos, or not to be touched.
    mkdirSync(join(root, "notes"));
    mkdirSync(join(root, ".cache", ".git"), { recursive: true });
    mkdirSync(join(root, "node_modules", ".git"), { recursive: true });
    mkdirSync(join(root, "deep", "inner", ".git"), { recursive: true });
    writeFileSync(join(root, "file.txt"), "");

    expect(findRepos(root)).toEqual(["api", "Billing", "web", "worktree"]);
  });
});

describe("matchNames", () => {
  const names = ["auth-back", "users-back", "web-front", "admin-front", "docs", "a+b(1)"];

  it("matches * and ? wildcards, ignoring case", () => {
    expect(matchNames(names, "*-back")).toEqual(["auth-back", "users-back"]);
    expect(matchNames(names, "*-BACK")).toEqual(["auth-back", "users-back"]);
    expect(matchNames(names, "d?cs")).toEqual(["docs"]);
  });

  it("takes several patterns, and ! leaves names out", () => {
    expect(matchNames(names, "*-back, web-*")).toEqual(["auth-back", "users-back", "web-front"]);
    expect(matchNames(names, "*-back,!users-*")).toEqual(["auth-back"]);
    // Only exclusions: everything else.
    expect(matchNames(names, "!*-front,!docs")).toEqual(["auth-back", "users-back", "a+b(1)"]);
  });

  it("treats regex characters in names literally", () => {
    expect(matchNames(names, "a+b(1)")).toEqual(["a+b(1)"]);
    expect(matchNames(names, "a.b*")).toEqual([]);
  });
});

describe("suggestPatterns", () => {
  it("suggests shared endings first, biggest group first", () => {
    const names = [
      "shop-back",
      "users-back",
      "gateway-back",
      "web-front",
      "admin-front",
      "flobi-docs",
    ];
    const suggested = suggestPatterns(names);
    expect(suggested.map((s) => s.pattern)).toEqual(["*-back", "*-front"]);
    expect(suggested[0]!.names).toEqual(["shop-back", "users-back", "gateway-back"]);
  });

  it("skips groups of one and groups covering every name, then falls back to beginnings", () => {
    // Every name ends in -back, so that would pick everything.
    const names = ["acme-a-back", "acme-b-back", "beta-back"];
    expect(suggestPatterns(names).map((s) => s.pattern)).toEqual(["acme-*"]);
  });

  it("returns at most `max` suggestions", () => {
    const names = ["a-x", "b-x", "c-y", "d-y", "e-z", "f-z", "g-w", "h-w"];
    expect(suggestPatterns(names, 2)).toHaveLength(2);
  });
});
