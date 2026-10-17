import {
  DEFAULT_ENV_FILE,
  encryptedInfo,
  envInfo,
  ignoreStatus,
  type IgnoreStatus,
  isTracked,
  normalizeEnvFile,
  otherEnvFiles,
  readBase,
  readEncrypted,
  trackedFiles,
} from "../files.js";
import { type CheckRow, describeRule, Output, type OutputData } from "../output.js";

function humanizeAge(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** How to stop git ignoring the encrypted file, given the rule that ignores it. */
function unignoreFix(encrypted: string, { rule }: IgnoreStatus): string {
  // A `!` rule can't re-include a file whose parent directory is ignored.
  if (rule?.pattern.endsWith("/")) {
    return `stop ignoring ${rule.pattern} (a ! rule can't re-include files inside an ignored directory)`;
  }
  return `add !${encrypted} to .gitignore`;
}

export async function statusCommand(
  options: {
    file?: string;
    json?: boolean;
    strict?: boolean;
    collect?: (record: OutputData) => void;
  } = {},
): Promise<number> {
  const file = normalizeEnvFile(options.file);
  const encrypted = `${file}.encrypted`;
  const out = new Output(options.json, options.collect);

  const env = envInfo(file);
  const enc = encryptedInfo(file);
  const [envIgnore, encIgnore] = ignoreStatus([file, encrypted]) as [IgnoreStatus, IgnoreStatus];

  // Sync check: only meaningful if both files exist. Allow a 1-second tolerance
  // for filesystems with coarse mtime resolution.
  let inSync: boolean | null = null;
  if (env && enc) {
    inSync = env.mtime.getTime() <= enc.mtime.getTime() + 1000;
  }

  // Fix commands only name the file when it isn't the default .env.
  const target = file === DEFAULT_ENV_FILE ? "" : ` ${file}`;
  const rows: CheckRow[] = [];

  if (env) {
    rows.push({
      state: "ok",
      label: file,
      detail: `${formatBytes(env.size)} · edited ${humanizeAge(env.mtime)}`,
    });
  } else {
    const detail = enc ? `not decrypted here (envlope decrypt${target})` : "not found";
    rows.push({ state: "info", label: file, detail });
  }

  if (enc) {
    rows.push({
      state: "ok",
      label: encrypted,
      detail: `${formatBytes(enc.size)} · written ${humanizeAge(enc.mtime)}`,
    });
  } else if (env) {
    rows.push({
      state: "problem",
      label: encrypted,
      detail: "not created yet",
      fix: `envlope init${target}`,
    });
  } else {
    rows.push({ state: "info", label: encrypted, detail: "not found" });
  }

  if (inSync === true) {
    rows.push({ state: "ok", label: "sync", detail: "in sync" });
  } else if (inSync === false) {
    rows.push({
      state: "problem",
      label: "sync",
      detail: `${file} changed after the last encrypt`,
      fix: `envlope encrypt${target}`,
    });
  }

  // Has .env.encrypted moved on since this .env was decrypted or encrypted, say with a
  // teammate's update from git pull? Known once envlope has recorded a base here.
  const base = enc ? readBase(file) : null;
  const behind = base === null ? null : base !== readEncrypted(file).trim();
  if (behind) {
    rows.push({
      state: "problem",
      label: "up to date",
      detail: `${file}.encrypted changed since your ${file} was made`,
      fix: `envlope decrypt${target} to take it, or envlope encrypt${target} to merge your edits in`,
    });
  }

  // A file git already tracks keeps being committed whatever .gitignore says.
  const tracked = isTracked(file);
  if (tracked) {
    const alsoIgnore = envIgnore.ignored ? "" : ` and add ${file} to .gitignore`;
    rows.push({
      state: "problem",
      label: `${file} ignored`,
      detail: "tracked by git, so .gitignore doesn't keep it out of commits",
      fix: `git rm --cached ${file}${alsoIgnore} (values already committed stay in git history)`,
    });
  } else if (envIgnore.ignored) {
    rows.push({ state: "ok", label: `${file} ignored`, detail: describeRule(envIgnore.rule) });
  } else {
    rows.push({
      state: "problem",
      label: `${file} ignored`,
      detail: envIgnore.rule
        ? `not ignored: ${describeRule(envIgnore.rule)}`
        : "no ignore rule matches it",
      fix: `add ${file} to .gitignore`,
    });
  }

  // The ciphertext has to be committable, or `git add` refuses it.
  if (enc && encIgnore.ignored) {
    rows.push({
      state: "problem",
      label: `${encrypted} committable`,
      detail: `ignored by ${describeRule(encIgnore.rule)}`,
      fix: unignoreFix(encrypted, encIgnore),
    });
  } else if (enc) {
    const detail = encIgnore.rule ? describeRule(encIgnore.rule) : "not ignored";
    rows.push({ state: "ok", label: `${encrypted} committable`, detail });
  }

  // Copies and backups (.env.bak, .env.pre-tunnel, …) hold the same secrets in
  // plain text. They only get a row when git could commit them.
  const others = otherEnvFiles(file);
  const otherIgnore = others.length > 0 ? ignoreStatus(others) : [];
  const otherTracked = others.length > 0 ? trackedFiles(others) : null;
  const otherStates = others.map((other, i) => ({
    file: other,
    tracked: otherTracked?.has(other) ?? null,
    ignored: otherIgnore[i]!.ignored,
  }));
  for (const other of otherStates) {
    if (other.tracked) {
      rows.push({
        state: "problem",
        label: other.file,
        detail: "a plaintext env file tracked by git",
        fix: `git rm --cached ${other.file} and ignore it (its values are in git history)`,
      });
    } else if (!other.ignored) {
      rows.push({
        state: "problem",
        label: other.file,
        detail: "a plaintext env file that git could commit",
        fix: `add ${other.file} to .gitignore, or delete it`,
      });
    }
  }

  const problems = rows.filter((r) => r.state === "problem");
  out.checklist("envlope status", file, rows);
  out.emit({
    file,
    env_exists: env !== null,
    encrypted_exists: enc !== null,
    in_sync: inSync,
    behind,
    last_encrypted: enc ? enc.mtime.toISOString() : null,
    gitignored: envIgnore.ignored && !tracked,
    gitignore_rule: envIgnore.rule,
    tracked,
    encrypted_committable: enc ? !encIgnore.ignored : null,
    other_env_files: otherStates,
    problems: problems.length,
    issues: problems.map((r) => ({ check: r.label, detail: r.detail, fix: r.fix ?? null })),
  });

  if (options.strict && inSync === false) return 1;
  return 0;
}
