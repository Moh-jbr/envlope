import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const DEFAULT_ENV_FILE = ".env";
export const GITIGNORE_FILE = ".gitignore";

const BASELINE_GITIGNORE_ENTRIES = [".env", ".env.local"];

/**
 * The env file argument as a path relative to cwd with forward slashes, so `./.env`,
 * `.\.env` (PowerShell tab completion) and an absolute path inside cwd all become
 * `.env`. .gitignore rules are written from this name, and a leading `./` or a
 * backslash would produce rules that silently match nothing. Files outside cwd are
 * refused, because the .gitignore here can't protect them.
 */
export function normalizeEnvFile(
  file: string = DEFAULT_ENV_FILE,
  cwd: string = process.cwd(),
): string {
  const path = relative(cwd, resolve(cwd, file));
  if (path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(
      `${file} is outside the current folder, so its .gitignore can't protect it. Run envlope from the folder that contains it.`,
    );
  }
  return path === "" ? file : path.split(sep).join("/");
}

export function envPath(file: string = DEFAULT_ENV_FILE, cwd: string = process.cwd()): string {
  return resolve(cwd, file);
}

export function encryptedPath(
  file: string = DEFAULT_ENV_FILE,
  cwd: string = process.cwd(),
): string {
  return resolve(cwd, `${file}.encrypted`);
}

export function backupPath(file: string = DEFAULT_ENV_FILE, cwd: string = process.cwd()): string {
  return resolve(cwd, `${file}.encrypted.bak`);
}

export function gitignorePath(cwd: string = process.cwd()): string {
  return resolve(cwd, GITIGNORE_FILE);
}

export function readEnv(file?: string, cwd?: string): Buffer {
  return readFileSync(envPath(file, cwd));
}

export function writeEnv(content: Buffer, file?: string, cwd?: string): void {
  writeFileSync(envPath(file, cwd), content);
}

export function readEncrypted(file?: string, cwd?: string): string {
  return readFileSync(encryptedPath(file, cwd), "utf8");
}

export function writeEncrypted(blob: string, file?: string, cwd?: string): void {
  writeFileSync(encryptedPath(file, cwd), blob + "\n");
}

export function envExists(file?: string, cwd?: string): boolean {
  return existsSync(envPath(file, cwd));
}

export function encryptedExists(file?: string, cwd?: string): boolean {
  return existsSync(encryptedPath(file, cwd));
}

export interface FileInfo {
  size: number;
  mtime: Date;
}

export function envInfo(file?: string, cwd?: string): FileInfo | null {
  const p = envPath(file, cwd);
  return existsSync(p) ? statSync(p) : null;
}

export function encryptedInfo(file?: string, cwd?: string): FileInfo | null {
  const p = encryptedPath(file, cwd);
  return existsSync(p) ? statSync(p) : null;
}

/**
 * Record that the env file and its ciphertext hold the same content. `status` spots
 * unencrypted edits by comparing modification times, so this moves the ciphertext's
 * time up to the plaintext's. It never moves the plaintext's time back, because
 * build tools compare that one to decide what to rebuild. Best effort: if the time
 * can't be changed, status may report drift, but nothing is lost.
 */
export function markInSync(file?: string, cwd?: string): void {
  try {
    const env = statSync(envPath(file, cwd));
    const encrypted = encryptedPath(file, cwd);
    const enc = statSync(encrypted);
    if (env.mtimeMs > enc.mtimeMs) {
      utimesSync(encrypted, enc.atimeMs / 1000, env.mtimeMs / 1000);
    }
  } catch {
    // Not worth failing the command over.
  }
}

/**
 * The repo's work tree root and git directory for `cwd` (following the .git file of
 * a worktree or submodule), or null outside a git repo.
 */
function findRepo(cwd: string): { root: string; gitDir: string } | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return { root: dir, gitDir: dotGit };
      const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
      return match ? { root: dir, gitDir: resolve(dir, match[1]!.trim()) } : null;
    }
    if (dirname(dir) === dir) return null;
  }
}

/** Where the base for an env file is kept: inside .git, so git never commits it. */
function basePath(file: string, cwd: string): string | null {
  const repo = findRepo(cwd);
  if (!repo) return null;
  const id = relative(repo.root, envPath(file, cwd)).split(sep).join("/");
  return join(repo.gitDir, "envlope", createHash("sha256").update(id).digest("hex").slice(0, 16));
}

/**
 * The ciphertext the env file was last decrypted from or encrypted into. `encrypt`
 * compares it with the current ciphertext to notice a teammate's newer version. It's
 * encrypted, so it's safe to keep. Null if never recorded, or outside a git repo.
 */
export function readBase(
  file: string = DEFAULT_ENV_FILE,
  cwd: string = process.cwd(),
): string | null {
  const path = basePath(file, cwd);
  if (!path) return null;
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

/** Record that the env file now matches the current ciphertext. Best effort. */
export function recordBase(file: string = DEFAULT_ENV_FILE, cwd: string = process.cwd()): void {
  const path = basePath(file, cwd);
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${readEncrypted(file, cwd).trim()}\n`);
  } catch {
    // Without a record, the conflict guard simply stays off for this file.
  }
}

/**
 * Copy the current .env.encrypted to .env.encrypted.bak.
 * Used by init when re-encrypting, so a user who regretted rotating can recover.
 */
export function backupEncrypted(file?: string, cwd?: string): void {
  copyFileSync(encryptedPath(file, cwd), backupPath(file, cwd));
}

/**
 * Returns the list of entries that should be in .gitignore for a given env file.
 * For the default .env, includes the baseline (.env, .env.local) plus .env.encrypted.bak.
 * For named files (e.g., .env.production), includes that file plus its .bak.
 * The env file itself always comes first.
 */
function gitignoreEntriesFor(file: string): string[] {
  const entries: string[] = [];
  if (file === DEFAULT_ENV_FILE) {
    entries.push(...BASELINE_GITIGNORE_ENTRIES);
  } else {
    entries.push(file);
  }
  entries.push(`${file}.encrypted.bak`);
  return entries;
}

/** The .gitignore pattern that matches exactly this path, with wildcards escaped. */
function gitignorePattern(path: string): string {
  return path.replace(/[\\*?[]/g, "\\$&").replace(/^[#!]/, "\\$&");
}

/** A rule from a .gitignore in the project, which every clone of it shares. */
function isSharedRule(rule: IgnoreRule | null): boolean {
  return rule !== null && !isAbsolute(rule.source) && /(^|\/)\.gitignore$/.test(rule.source);
}

/**
 * Ensures .env (or the given file) and its .bak are ignored by .gitignore, and
 * that the encrypted file is NOT ignored — a broad rule like `.env*` (the
 * Next.js default) would otherwise make `git add .env.encrypted` fail, so a
 * `!.env.encrypted` exception is appended. Idempotent — only appends what the
 * existing rules don't already cover. Creates the file if missing.
 *
 * Only .gitignore rules count as covering a file: one in your global gitignore or
 * .git/info/exclude protects nobody else's clone. Returns both files' ignore status
 * afterwards, so callers can warn when a rule they can't override still wins.
 */
export function ensureGitignore(
  file: string = DEFAULT_ENV_FILE,
  cwd?: string,
): { added: string[]; existed: boolean; env: IgnoreStatus; encrypted: IgnoreStatus } {
  const path = gitignorePath(cwd);
  const existed = existsSync(path);
  const current = existed ? readFileSync(path, "utf8") : "";

  const encryptedFile = `${file}.encrypted`;
  const desired = gitignoreEntriesFor(file);
  const before = ignoreStatus([...desired, encryptedFile], cwd);
  const toAdd = desired
    .filter((_, i) => !(before[i]!.ignored && isSharedRule(before[i]!.rule)))
    .map(gitignorePattern);

  let env = before[0]!;
  let encrypted = before[desired.length]!;
  const exception = `!${gitignorePattern(encryptedFile)}`;
  // If the exception is already there and the file is still ignored, appending it
  // again changes nothing.
  const hasException = current.split(/\r?\n/).some((line) => line.trim() === exception);
  if (encrypted.ignored && !hasException) {
    toAdd.push(exception);
  }

  if (toAdd.length > 0) {
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    writeFileSync(path, current + prefix + toAdd.join("\n") + "\n");
    [env, encrypted] = ignoreStatus([file, encryptedFile], cwd) as [IgnoreStatus, IgnoreStatus];
  }

  return { added: toAdd, existed, env, encrypted };
}

/** The ignore rule that decided a path's fate. */
export interface IgnoreRule {
  /** Where the rule lives, e.g. ".gitignore" or ".git/info/exclude". */
  source: string;
  line: number;
  /** The rule as written; a leading "!" re-includes the path. */
  pattern: string;
}

export interface IgnoreStatus {
  ignored: boolean;
  /** The last rule that matched the path, or null if none did. */
  rule: IgnoreRule | null;
}

/**
 * For each path (relative to cwd): whether git ignores it, and which rule decided.
 * Asks git, so every ignore source counts (.gitignore files in parent directories,
 * .git/info/exclude, core.excludesFile). Outside a git repo, or without git
 * installed, only the .gitignore in cwd is consulted.
 */
export function ignoreStatus(paths: string[], cwd?: string): IgnoreStatus[] {
  return gitIgnoreStatus(paths, cwd) ?? gitignoreFileStatus(paths, cwd);
}

/**
 * Whether git tracks the file. A tracked file keeps being committed whatever
 * .gitignore says. Null outside a git repo, or without git installed.
 */
export function isTracked(file: string, cwd?: string): boolean | null {
  const tracked = trackedFiles([file], cwd);
  return tracked === null ? null : tracked.has(file);
}

/** Which of these paths (relative to cwd) git tracks; null outside a git repo. */
export function trackedFiles(files: string[], cwd?: string): Set<string> | null {
  const result = runGit(["ls-files", "-z", "--", ...files.map((f) => `:(literal)${f}`)], cwd);
  if (result.status !== 0) return null;
  return new Set(result.stdout.split("\0").filter(Boolean));
}

/**
 * The other plaintext env files next to `file`: copies and backups like `.env.bak`,
 * `.env.pre-tunnel` or `.env.production`. They hold secrets too, but envlope never
 * wrote ignore rules for them. Templates (`*.example`) and encrypted files are left out.
 */
export function otherEnvFiles(file: string, cwd: string = process.cwd()): string[] {
  const dir = dirname(envPath(file, cwd));
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(".env"))
    .filter((entry) => !/(\.encrypted|\.encrypted\.bak|\.example)$/.test(entry.name))
    .map((entry) => relative(cwd, join(dir, entry.name)).split(sep).join("/"))
    .filter((path) => path !== file)
    .sort();
}

/**
 * Run git. On Windows a bare "git" would otherwise also be looked up in the current
 * folder before PATH, so a git.exe planted in a project would run. Node reads this
 * setting from its own environment when it spawns, so it has to be set here.
 */
function runGit(args: string[], cwd?: string, input?: string) {
  if (process.platform === "win32") process.env.NoDefaultCurrentDirectoryInExePath = "1";
  return spawnSync("git", args, { cwd, input, encoding: "utf8" });
}

function gitIgnoreStatus(paths: string[], cwd?: string): IgnoreStatus[] | null {
  // -v reports the deciding rule (including "!" re-includes), -n also reports paths
  // no rule matched, and --no-index judges by the rules alone, even for tracked files.
  const result = runGit(
    ["check-ignore", "-v", "-n", "--no-index", "--stdin", "-z"],
    cwd,
    paths.map((p) => `${p}\0`).join(""),
  );
  // 0 or 1 means git answered; anything else means not a repo, or no git.
  if (result.status !== 0 && result.status !== 1) return null;

  // One record per path, in input order: source, line, pattern, path.
  const fields = result.stdout.split("\0");
  return paths.map((_, i) => {
    const [source = "", line = "", pattern = ""] = fields.slice(i * 4, i * 4 + 3);
    if (!pattern) return { ignored: false, rule: null };
    return { ignored: !pattern.startsWith("!"), rule: { source, line: Number(line), pattern } };
  });
}

/**
 * Evaluates the .gitignore in cwd for each path (relative to cwd). Covers the syntax
 * env-file rules use in practice: `*` and `?` wildcards, backslash escapes, leading
 * `/` anchors and `**` directory prefixes, and `!` negations, with the last matching
 * rule winning. Directory-only rules (trailing `/`) are skipped.
 */
function gitignoreFileStatus(paths: string[], cwd?: string): IgnoreStatus[] {
  const statuses: IgnoreStatus[] = paths.map(() => ({ ignored: false, rule: null }));
  const path = gitignorePath(cwd);
  if (!existsSync(path)) return statuses;

  const rules = readFileSync(path, "utf8")
    .split("\n")
    .flatMap((raw, index) => {
      // As git reads it: a trailing CR and unescaped trailing spaces are dropped, but
      // leading whitespace is part of the pattern.
      const pattern = raw.replace(/\r$/, "").replace(/(?<!\\) +$/, "");
      if (!pattern || pattern.startsWith("#") || pattern.endsWith("/")) return [];
      const rule: IgnoreRule = { source: GITIGNORE_FILE, line: index + 1, pattern };
      return [{ ...parseGitignoreRule(pattern), rule }];
    });

  paths.forEach((p, i) => {
    // A .gitignore never applies above its own folder.
    if (p === ".." || p.startsWith("../")) return;
    for (const { regex, negate, rule } of rules) {
      if (regex.test(p)) statuses[i] = { ignored: !negate, rule };
    }
  });
  return statuses;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseGitignoreRule(line: string): { negate: boolean; regex: RegExp } {
  const negate = line.startsWith("!");
  let pattern = negate ? line.slice(1) : line;
  const anyDepth = pattern.startsWith("**/");
  if (anyDepth) pattern = pattern.slice(3);
  // A slash anywhere but the end anchors the pattern to the .gitignore's directory;
  // otherwise it matches the file name at any depth.
  const anchored = !anyDepth && pattern.includes("/");
  pattern = pattern.replace(/^\//, "");

  let body = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "\\" && i + 1 < pattern.length) body += escapeRegExp(pattern[++i]!);
    else if (c === "*") body += "[^/]*";
    else if (c === "?") body += "[^/]";
    else body += escapeRegExp(c);
  }
  return { negate, regex: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}$`) };
}
