import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_ENV_FILE = ".env";
export const GITIGNORE_FILE = ".gitignore";

const BASELINE_GITIGNORE_ENTRIES = [".env", ".env.local"];

export function envPath(file: string = DEFAULT_ENV_FILE, cwd: string = process.cwd()): string {
  return resolve(cwd, file);
}

export function encryptedPath(file: string = DEFAULT_ENV_FILE, cwd: string = process.cwd()): string {
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

export function envMtime(file?: string, cwd?: string): Date | null {
  const p = envPath(file, cwd);
  return existsSync(p) ? statSync(p).mtime : null;
}

export function encryptedMtime(file?: string, cwd?: string): Date | null {
  const p = encryptedPath(file, cwd);
  return existsSync(p) ? statSync(p).mtime : null;
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

/**
 * Ensures .env (or the given file) and its .bak are listed in .gitignore.
 * Idempotent — only appends lines that aren't already present. Creates the file if missing.
 */
export function ensureGitignore(
  file: string = DEFAULT_ENV_FILE,
  cwd?: string,
): { added: string[]; existed: boolean } {
  const path = gitignorePath(cwd);
  const existed = existsSync(path);
  const current = existed ? readFileSync(path, "utf8") : "";
  const lines = current.split(/\r?\n/).map((l) => l.trim());
  const present = new Set(lines);

  const desired = gitignoreEntriesFor(file);
  const toAdd = desired.filter((entry) => !present.has(entry));
  if (toAdd.length === 0) {
    return { added: [], existed };
  }

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  const addition = prefix + toAdd.join("\n") + "\n";
  writeFileSync(path, current + addition);

  return { added: toAdd, existed };
}

/**
 * Checks whether the given env file is currently protected by .gitignore.
 * Returns false if .gitignore doesn't exist or doesn't include the file.
 */
export function isGitignored(file: string = DEFAULT_ENV_FILE, cwd?: string): boolean {
  const path = gitignorePath(cwd);
  if (!existsSync(path)) return false;
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim());
  return lines.includes(file);
}
