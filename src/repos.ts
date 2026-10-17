import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The git repos directly inside `root`, as folder names in alphabetical order. A
 * repo is a folder with a `.git` (the directory, or the file a worktree or submodule
 * has). Hidden folders, node_modules and symlinks are skipped.
 */
export function findRepos(root: string = process.cwd()): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .filter((entry) => entry.name !== "node_modules")
    .filter((entry) => existsSync(join(root, entry.name, ".git")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const globToRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .split("*")
      .map((part) => part.split("?").map(escapeRegExp).join("."))
      .join(".*")}$`,
    "i",
  );

/** The patterns in a comma-separated list, without blanks. */
export const splitPatterns = (patterns: string) =>
  patterns
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * The names matching a comma-separated list of patterns like `*-back,!legacy-*`:
 * `*` and `?` wildcards, ignoring case, and `!` to leave names out. A list of only
 * `!` patterns keeps every other name.
 */
export function matchNames(names: string[], patterns: string): string[] {
  const list = splitPatterns(patterns);
  const include = list.filter((p) => !p.startsWith("!")).map(globToRegExp);
  const exclude = list.filter((p) => p.startsWith("!")).map((p) => globToRegExp(p.slice(1)));
  return names.filter(
    (name) =>
      (include.length === 0 || include.some((re) => re.test(name))) &&
      !exclude.some((re) => re.test(name)),
  );
}

/**
 * Patterns that split names into recognizable groups, read from the endings and
 * beginnings they share (`*-back`, `web-*`): endings first, as they tend to say what
 * a repo is, then the biggest groups. Each covers at least two names, and not all.
 */
export function suggestPatterns(names: string[], max = 3): { pattern: string; names: string[] }[] {
  const group = (patternOf: (name: string) => string | null) => {
    const groups = new Map<string, string[]>();
    for (const name of names) {
      const pattern = patternOf(name);
      if (pattern) groups.set(pattern, [...(groups.get(pattern) ?? []), name]);
    }
    return [...groups]
      .filter(([, members]) => members.length >= 2 && members.length < names.length)
      .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b, "en"));
  };
  const ending = (name: string) => {
    const match = /[-_.][^-_.]+$/.exec(name);
    return match ? `*${match[0].toLowerCase()}` : null;
  };
  const beginning = (name: string) => {
    const match = /^[^-_.]+[-_.]/.exec(name);
    return match ? `${match[0].toLowerCase()}*` : null;
  };
  return [...group(ending), ...group(beginning)]
    .slice(0, max)
    .map(([pattern, members]) => ({ pattern, names: members }));
}

/** Run `fn` with `dir` as the working directory, then go back. */
export async function inFolder<T>(dir: string, fn: () => T | Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}
