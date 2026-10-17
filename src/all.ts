import { basename, isAbsolute, join } from "node:path";
import pc from "picocolors";
import { decryptCommand } from "./commands/decrypt.js";
import { encryptCommand } from "./commands/encrypt.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { decrypt, DecryptionError } from "./crypto.js";
import {
  encryptedExists,
  envExists,
  normalizeEnvFile,
  readBase,
  readEncrypted,
  readEnv,
} from "./files.js";
import {
  fingerprint,
  fingerprintWords,
  formatFingerprint,
  formatKey,
  generateKey,
  InvalidKeyError,
  parseKey,
  resolveKey,
  UserCancelled,
} from "./key.js";
import { describeSource, type KeyGroup, planKeyGroups } from "./keygroups.js";
import {
  listNames,
  Output,
  type OutputData,
  plural,
  type RepoRow,
  type RepoStatus,
  summarizeOverwrite,
} from "./output.js";
import type { EnvDiff } from "./parse.js";
import { findRepos, inFolder, matchNames, splitPatterns } from "./repos.js";
import { canPrompt, choose, promptKey } from "./ui.js";

/** The options of the commands that take --all. */
export interface AllOptions {
  file?: string;
  key?: string;
  json?: boolean;
  yes?: boolean;
  force?: boolean;
  strict?: boolean;
  only?: string;
}

type CommandName = "init" | "encrypt" | "decrypt" | "status" | "key";

/** How a repo came out, plus what --json keeps of it. */
interface Outcome extends RepoRow {
  fingerprint?: string;
  result?: OutputData;
}

type Work = Omit<Outcome, "repo">;

/** How each command words its totals. */
const TALLY: Record<CommandName, Partial<Record<RepoStatus, string>>> = {
  init: { done: "set up", unchanged: "already used the key", problem: "failed" },
  encrypt: {
    done: "updated",
    unchanged: "already up to date",
    attention: "changed by someone else",
    problem: "failed",
  },
  decrypt: {
    done: "decrypted",
    unchanged: "already matched",
    attention: "with local changes",
    problem: "failed",
  },
  status: { done: "healthy", problem: "with problems" },
  key: { done: "opened", problem: "unreadable" },
};

/** One --all run: the repos it covers and how each came out, printed as it happens. */
class Run {
  readonly out: Output;
  readonly outcomes = new Map<string, Outcome>();
  /** The key each repo was opened with. */
  readonly keys = new Map<string, Buffer>();
  private readonly width: number;

  constructor(
    readonly command: CommandName,
    readonly root: string,
    readonly file: string,
    readonly repos: string[],
    readonly options: AllOptions,
  ) {
    this.out = new Output(options.json);
    this.width = Math.min(32, Math.max(...repos.map((r) => r.length)));
  }

  get interactive(): boolean {
    return canPrompt(this.options);
  }

  /** Run `fn` inside a repo's folder. */
  in<T>(repo: string, fn: () => T | Promise<T>): Promise<T> {
    return inFolder(join(this.root, repo), fn);
  }

  /**
   * Record how a repo came out and show its row. Skipped repos, and those waiting for
   * another key, are listed together at the end instead.
   */
  set(
    outcome: Outcome,
    show = outcome.status !== "skipped" && outcome.status !== "other_key",
  ): void {
    this.outcomes.set(outcome.repo, outcome);
    if (show) this.out.repoRow(outcome, this.width);
  }

  with(status: RepoStatus): string[] {
    return this.repos.filter((repo) => this.outcomes.get(repo)?.status === status);
  }

  counts(): Record<RepoStatus, number> {
    const counts = { done: 0, unchanged: 0, attention: 0, other_key: 0, skipped: 0, problem: 0 };
    for (const repo of this.repos) counts[this.outcomes.get(repo)?.status ?? "skipped"]++;
    return counts;
  }

  /** The totals, then the repos needing another key and the skipped ones, by reason. */
  tally(): void {
    const counts = this.counts();
    const words = TALLY[this.command];
    const parts = (["done", "unchanged", "attention", "problem"] as const)
      .filter((status) => words[status])
      .map((status) => ({ status, count: counts[status], text: words[status]! }));

    const otherKey = this.with("other_key");
    const groups: { mark: RepoStatus; text: string; repos: string[] }[] = [
      {
        mark: "other_key",
        text: `${plural(otherKey.length, "repo")} ${otherKey.length === 1 ? "needs" : "need"} a different key`,
        repos: otherKey,
      },
    ];
    const skipped = new Map<string, string[]>();
    for (const repo of this.repos) {
      const outcome = this.outcomes.get(repo);
      if (outcome && outcome.status !== "skipped") continue;
      const why = outcome?.detail ?? "not reached";
      skipped.set(why, [...(skipped.get(why) ?? []), repo]);
    }
    for (const [why, repos] of skipped) {
      groups.push({ mark: "skipped", text: `${repos.length} skipped, ${why}`, repos });
    }
    this.out.tally(parts, groups);
  }

  /** The --json result: every repo, in folder order, and the totals. */
  emit(extra: OutputData = {}): void {
    this.out.emit({
      folder: this.root,
      command: this.command,
      file: this.file,
      ...extra,
      repos: this.repos.map((repo) => {
        const {
          notes,
          warnings,
          fingerprint: fp,
          result,
          ...row
        } = this.outcomes.get(repo) ?? {
          repo,
          status: "skipped",
          detail: "not reached",
        };
        return {
          ...row,
          ...(notes && notes.length > 0 ? { notes } : {}),
          ...(warnings && warnings.length > 0 ? { warnings } : {}),
          ...(fp ? { fingerprint: fp } : {}),
          ...(result ? { result } : {}),
        };
      }),
      summary: this.counts(),
    });
  }
}

/**
 * Check the options and find the repos: the git repos directly inside the current
 * folder, narrowed by --only. Returns an exit code instead if there's nothing to do.
 */
function prepare(command: CommandName, options: AllOptions): Run | number {
  const out = new Output(options.json);
  if (options.file !== undefined && isAbsolute(options.file)) {
    out.fail(
      `With --all, name the env file as it is inside each repo, like .env.local, not by its full path.`,
    );
    return 1;
  }
  const root = process.cwd();
  const file = normalizeEnvFile(options.file);
  let repos = findRepos(root);
  if (repos.length === 0) {
    out.fail(
      `No git repos in ${root}. --all works on the repos directly inside the folder you run it from.`,
    );
    return 1;
  }
  if (options.only !== undefined) {
    if (splitPatterns(options.only).length === 0) {
      out.fail('--only needs a pattern, like "*-back".');
      return 1;
    }
    const all = repos.length;
    repos = matchNames(repos, options.only);
    if (repos.length === 0) {
      out.fail(`None of the ${plural(all, "repo")} here matches --only ${options.only}.`);
      return 1;
    }
  }
  return new Run(command, root, file, repos, options);
}

/** Run a command with its output collected instead of printed. */
async function quietly(
  run: (collect: (record: OutputData) => void) => Promise<number>,
): Promise<{ code: number; record: OutputData }> {
  let record: OutputData = {};
  try {
    const code = await run((r) => {
      record = r;
    });
    return { code, record };
  } catch (err) {
    return { code: 1, record: { error: errorText(err), code: 1 } };
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const warningsOf = (record: OutputData) =>
  Array.isArray(record.warnings) ? (record.warnings as string[]) : undefined;

/** "added A; changed B, C" for a row; names only. */
function nameChanges(diff: EnvDiff): string {
  const parts = [
    diff.added.length > 0 && `added ${listNames(diff.added, 3)}`,
    diff.changed.length > 0 && `changed ${listNames(diff.changed, 3)}`,
    diff.removed.length > 0 && `removed ${listNames(diff.removed, 3)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : "only comments or formatting changed";
}

/** Whether the key opens the repo's encrypted file; otherwise why not. */
function tryKey(file: string, key: Buffer): "opens" | "other_key" | string {
  try {
    decrypt(readEncrypted(file), key);
    return "opens";
  } catch (err) {
    if (err instanceof DecryptionError && err.wrongKey) return "other_key";
    return errorText(err);
  }
}

/** The first key: --key, ENVLOPE_KEY, or the prompt. Returns an exit code on failure. */
async function firstKey(run: Run): Promise<{ key: Buffer; source: string } | number> {
  const source = run.options.key
    ? "from --key"
    : process.env.ENVLOPE_KEY
      ? "from ENVLOPE_KEY"
      : "entered";
  try {
    return { key: await resolveKey(run.options, "Enter the envlope key for these repos:"), source };
  } catch (err) {
    if (err instanceof InvalidKeyError) {
      run.out.fail(err.message);
      return 1;
    }
    if (err instanceof UserCancelled) return 130;
    throw err;
  }
}

/**
 * Do `work` in each repo the key opens, setting the rest aside. In a terminal, offer
 * to try another key on those, for as long as some are left.
 */
async function withKeys(
  run: Run,
  repos: string[],
  first: { key: Buffer; source: string },
  work: (key: Buffer) => Promise<Work>,
): Promise<void> {
  const tried: Buffer[] = [];
  let current: { key: Buffer; source: string } | null = first;
  let pending = repos;
  while (current !== null) {
    const { key, source } = current;
    tried.push(key);
    const fp = fingerprint(key);
    run.out.line();
    run.out.heading(`key ${formatFingerprint(fp)}`, `${fingerprintWords(fp)} · ${source}`);

    const left: string[] = [];
    for (const repo of pending) {
      const verdict = await run.in(repo, () => tryKey(run.file, key));
      if (verdict === "other_key") {
        left.push(repo);
      } else if (verdict !== "opens") {
        run.set({ repo, status: "problem", detail: verdict });
      } else {
        run.keys.set(repo, key);
        run.set({ repo, fingerprint: fp, ...(await run.in(repo, () => work(key))) });
      }
    }
    if (tried.length > 1 && left.length === pending.length) {
      run.out.line(pc.dim(`  it doesn't open any of them either`));
    }
    pending = left;
    current = pending.length > 0 && run.interactive ? await anotherKey(run, pending, tried) : null;
  }
  for (const repo of pending)
    run.set({ repo, status: "other_key", detail: "needs a different key" });
}

async function anotherKey(
  run: Run,
  pending: string[],
  tried: Buffer[],
): Promise<{ key: Buffer; source: string } | null> {
  const one = pending.length === 1;
  run.out.line();
  run.out.line(
    `${pc.cyan("○")} ${one ? "1 repo needs" : `${pending.length} repos need`} a different key: ${listNames(pending, 6)}`,
  );
  const choice = await choose(
    one ? "Try another key on it?" : "Try another key on them?",
    [
      { value: "key", label: "Enter another key" },
      { value: "skip", label: one ? "Skip it" : "Skip them" },
    ],
    "key",
  );
  if (choice !== "key") return null;
  try {
    const value = await promptKey("The other key:", (input) => {
      try {
        const key = parseKey(input);
        return tried.some((t) => t.equals(key)) ? "That key was already tried." : undefined;
      } catch (err) {
        return err instanceof InvalidKeyError ? err.message : "That isn't a valid key.";
      }
    });
    return { key: parseKey(value), source: "entered" };
  } catch (err) {
    if (err instanceof UserCancelled) return null;
    throw err;
  }
}

/** The heading over an --all run: "envlope decrypt --all · 12 repos in work". */
function heading(run: Run): void {
  run.out.heading(
    `envlope ${run.command} --all`,
    `${plural(run.repos.length, "repo")} in ${basename(run.root)}${run.options.only ? ` matching ${run.options.only}` : ""}`,
  );
}

/** Exit code for encrypt and decrypt: 1 if a repo failed or still needs a decision, or no key opened any. */
function keyedExitCode(run: Run, candidates: string[]): number {
  const counts = run.counts();
  if (counts.problem > 0 || counts.attention > 0) return 1;
  return candidates.length > 0 && run.keys.size === 0 ? 1 : 0;
}

// --- decrypt ---------------------------------------------------------------------

async function decryptIn(run: Run, key: Buffer, yes = false): Promise<Work> {
  const { code, record } = await quietly((collect) =>
    decryptCommand({ file: run.file, key: formatKey(key), yes, json: true, collect }),
  );
  if (code === 0) {
    return {
      status: record.changed ? "done" : "unchanged",
      detail: record.changed ? "decrypted" : "already matches",
      warnings: warningsOf(record),
      result: record,
    };
  }
  if (record.reason === "local_changes") {
    return {
      status: "attention",
      detail: `${run.file} has local changes (decrypting ${summarizeOverwrite(record.variables as EnvDiff)})`,
      result: record,
    };
  }
  return { status: "problem", detail: String(record.error), result: record };
}

/** Decrypting would overwrite local edits: in a terminal, ask what to do about them. */
async function settleLocalChanges(run: Run): Promise<void> {
  const repos = run.with("attention");
  if (repos.length === 0 || !run.interactive) return;
  const one = repos.length === 1;
  run.out.line();
  run.out.line(
    `${pc.yellow("▲")} ${one ? "1 repo has" : `${repos.length} repos have`} local changes that decrypting would overwrite: ${listNames(repos, 6)}`,
  );
  const choice = await choose(
    one ? "What should happen to it?" : "What should happen to them?",
    [
      { value: "keep", label: "Keep the local changes" },
      {
        value: "review",
        label: one ? "Show me what differs, then decide" : "Go through them one by one",
        hint: "see which variables differ, then decide",
      },
      {
        value: "overwrite",
        label: one ? "Overwrite it" : "Overwrite them all",
        hint: "the local values are replaced",
      },
    ],
    "keep",
  );

  if (choice === "overwrite") run.out.line();
  for (const repo of repos) {
    const key = run.keys.get(repo)!;
    const fp = fingerprint(key);
    if (choice === "overwrite") {
      run.set({ repo, fingerprint: fp, ...(await run.in(repo, () => decryptIn(run, key, true))) });
    } else if (choice === "review") {
      run.out.line();
      run.out.line(pc.bold(`── ${repo}`));
      try {
        const replaced = await run.in(repo, async () => {
          await decryptCommand({ file: run.file, key: formatKey(key) });
          return (
            envExists(run.file) && readEnv(run.file).equals(decrypt(readEncrypted(run.file), key))
          );
        });
        run.set(
          {
            repo,
            fingerprint: fp,
            status: replaced ? "done" : "skipped",
            detail: replaced ? "decrypted" : "kept its local changes",
          },
          false,
        );
      } catch (err) {
        run.set({ repo, fingerprint: fp, status: "problem", detail: errorText(err) });
      }
    } else {
      run.set({ repo, fingerprint: fp, status: "skipped", detail: "kept its local changes" });
    }
  }
}

export async function decryptAll(options: AllOptions): Promise<number> {
  const run = prepare("decrypt", options);
  if (typeof run === "number") return run;
  heading(run);

  const candidates: string[] = [];
  for (const repo of run.repos) {
    if (await run.in(repo, () => encryptedExists(run.file))) candidates.push(repo);
    else run.set({ repo, status: "skipped", detail: `no ${run.file}.encrypted` });
  }
  if (candidates.length === 0) {
    run.out.fail(
      `None of the ${plural(run.repos.length, "repo")} here has a ${run.file}.encrypted.`,
    );
    return 1;
  }

  const first = await firstKey(run);
  if (typeof first === "number") return first;
  await withKeys(run, candidates, first, (key) => decryptIn(run, key, options.yes));
  await settleLocalChanges(run);

  run.tally();
  if (run.with("attention").length > 0) {
    run.out.hint(
      pc.dim(
        "Rerun with --yes to overwrite their local changes, or run envlope decrypt in each to see them first.",
      ),
    );
  }
  run.emit();
  return keyedExitCode(run, candidates);
}

// --- encrypt ---------------------------------------------------------------------

async function encryptIn(run: Run, key: Buffer): Promise<Work> {
  const { code, record } = await quietly((collect) =>
    encryptCommand({
      file: run.file,
      key: formatKey(key),
      force: run.options.force,
      json: true,
      collect,
    }),
  );
  if (code === 0) {
    if (!record.changed)
      return { status: "unchanged", detail: "already up to date", result: record };
    return {
      status: "done",
      detail: `updated: ${nameChanges(record.variables as EnvDiff)}`,
      result: record,
    };
  }
  if (record.reason === "newer_version") {
    return {
      status: "attention",
      detail: `${run.file}.encrypted changed since this ${run.file} was made (a teammate's update?)`,
      notes: run.interactive ? undefined : [String(record.error)],
      result: record,
    };
  }
  return { status: "problem", detail: String(record.error), result: record };
}

/** Someone else's newer version arrived: in a terminal, offer to sort each one out. */
async function settleNewerVersions(run: Run): Promise<void> {
  const repos = run.with("attention");
  if (repos.length === 0 || !run.interactive) return;
  const one = repos.length === 1;
  run.out.line();
  run.out.line(
    `${pc.yellow("▲")} ${run.file}.encrypted changed since the ${run.file} was made in ${one ? "1 repo" : `${repos.length} repos`}: ${listNames(repos, 6)}`,
  );
  const choice = await choose(
    one ? "What should happen to it?" : "What should happen to them?",
    [
      {
        value: "resolve",
        label: one ? "Sort it out now" : "Go through them one by one",
        hint: "merge their changes and yours",
      },
      { value: "leave", label: "Leave it for later", hint: "envlope encrypt there merges it" },
    ],
    "resolve",
  );

  for (const repo of repos) {
    const key = run.keys.get(repo)!;
    const fp = fingerprint(key);
    if (choice !== "resolve") {
      run.set({
        repo,
        fingerprint: fp,
        status: "skipped",
        detail: "left for later (changed by someone else)",
      });
      continue;
    }
    run.out.line();
    run.out.line(pc.bold(`── ${repo}`));
    // Settled once the recorded base is the current ciphertext again (merged or overwritten).
    try {
      const settled = await run.in(repo, async () => {
        await encryptCommand({ file: run.file, key: formatKey(key) });
        return readBase(run.file) === readEncrypted(run.file).trim();
      });
      run.set(
        {
          repo,
          fingerprint: fp,
          status: settled ? "done" : "skipped",
          detail: settled ? "updated" : "left for later (changed by someone else)",
        },
        false,
      );
    } catch (err) {
      run.set({ repo, fingerprint: fp, status: "problem", detail: errorText(err) });
    }
  }
}

export async function encryptAll(options: AllOptions): Promise<number> {
  const run = prepare("encrypt", options);
  if (typeof run === "number") return run;
  heading(run);

  const candidates: string[] = [];
  for (const repo of run.repos) {
    const [env, encrypted] = await run.in(repo, () => [
      envExists(run.file),
      encryptedExists(run.file),
    ]);
    if (env && encrypted) candidates.push(repo);
    else if (env)
      run.set({ repo, status: "skipped", detail: "not set up yet (envlope init --all)" });
    else run.set({ repo, status: "skipped", detail: `no ${run.file}` });
  }
  if (candidates.length === 0) {
    run.out.fail(
      `None of the ${plural(run.repos.length, "repo")} here has both a ${run.file} and a ${run.file}.encrypted.`,
    );
    return 1;
  }

  const first = await firstKey(run);
  if (typeof first === "number") return first;
  await withKeys(run, candidates, first, (key) => encryptIn(run, key));
  await settleNewerVersions(run);

  run.tally();
  if (run.with("attention").length > 0) {
    run.out.hint(
      pc.dim(
        "Run envlope encrypt in each, in a terminal, to merge their changes with yours; --force replaces theirs.",
      ),
    );
  }
  run.emit();
  return keyedExitCode(run, candidates);
}

// --- key -------------------------------------------------------------------------

export async function keyAll(options: AllOptions): Promise<number> {
  const run = prepare("key", options);
  if (typeof run === "number") return run;
  heading(run);

  const candidates: string[] = [];
  for (const repo of run.repos) {
    if (await run.in(repo, () => encryptedExists(run.file))) candidates.push(repo);
    else run.set({ repo, status: "skipped", detail: `no ${run.file}.encrypted` });
  }
  if (candidates.length === 0) {
    run.out.fail(
      `None of the ${plural(run.repos.length, "repo")} here has a ${run.file}.encrypted.`,
    );
    return 1;
  }

  const first = await firstKey(run);
  if (typeof first === "number") return first;
  await withKeys(run, candidates, first, async () => ({ status: "done", detail: "opens" }));

  run.tally();
  run.emit();
  return run.keys.size === 0 ? 1 : 0;
}

// --- status ----------------------------------------------------------------------

export async function statusAll(options: AllOptions): Promise<number> {
  const run = prepare("status", options);
  if (typeof run === "number") return run;
  heading(run);
  run.out.line();

  let drift = false;
  let failed = false;
  for (const repo of run.repos) {
    const has = await run.in(repo, () => envExists(run.file) || encryptedExists(run.file));
    if (!has) {
      run.set({ repo, status: "skipped", detail: "no env files" });
      continue;
    }
    const { record } = await run.in(repo, () =>
      quietly((collect) => statusCommand({ file: run.file, json: true, collect })),
    );
    if (record.error !== undefined) {
      failed = true;
      run.set({ repo, status: "problem", detail: String(record.error), result: record });
      continue;
    }
    if (record.in_sync === false) drift = true;
    const issues = (record.issues ?? []) as { check: string; detail: string; fix: string | null }[];
    if (issues.length === 0) {
      const detail = record.env_exists ? "in sync" : `not decrypted here (envlope decrypt --all)`;
      run.set({ repo, status: "done", detail, result: record });
    } else {
      run.set({
        repo,
        status: "problem",
        detail: plural(issues.length, "problem"),
        notes: issues.flatMap((i) => [
          `${i.check}: ${i.detail}`,
          ...(i.fix ? [`fix: ${i.fix}`] : []),
        ]),
        result: record,
      });
    }
  }

  run.tally();
  run.emit();
  return failed || (options.strict && drift) ? 1 : 0;
}

// --- init ------------------------------------------------------------------------

async function initIn(run: Run, key: Buffer, existing: boolean): Promise<Work> {
  // Already locked with this very key: nothing to rotate, so leave the file alone.
  if (existing && tryKey(run.file, key) === "opens") {
    const stale = !decrypt(readEncrypted(run.file), key).equals(readEnv(run.file));
    return {
      status: "unchanged",
      detail: "already uses this key",
      notes: stale
        ? [`its ${run.file} changed since; envlope encrypt --all updates it`]
        : undefined,
    };
  }
  const { code, record } = await quietly((collect) =>
    initCommand({ file: run.file, key: formatKey(key), yes: existing, json: true, collect }),
  );
  if (code !== 0) return { status: "problem", detail: String(record.error), result: record };
  const variables = plural(Number(record.variables), "variable");
  return {
    status: "done",
    detail: existing
      ? `re-encrypted · ${variables} · the old one is in ${run.file}.encrypted.bak`
      : `encrypted · ${variables}`,
    warnings: warningsOf(record),
    result: record,
  };
}

export async function initAll(options: AllOptions): Promise<number> {
  const run = prepare("init", options);
  if (typeof run === "number") return run;
  const { file } = run;

  const ready: string[] = [];
  const existing = new Set<string>();
  for (const repo of run.repos) {
    const [env, encrypted] = await run.in(repo, () => [envExists(file), encryptedExists(file)]);
    if (!env) run.set({ repo, status: "skipped", detail: `no ${file}` });
    else if (encrypted) existing.add(repo);
    else ready.push(repo);
  }

  heading(run);
  const without = run.repos.length - ready.length - existing.size;
  run.out.line(
    pc.dim(
      [
        ready.length > 0 && `${ready.length} ready to set up`,
        existing.size > 0 && `${existing.size} already encrypted`,
        without > 0 && `${without} without a ${file}`,
      ]
        .filter(Boolean)
        .join(" · "),
    ),
  );
  if (ready.length + existing.size === 0) {
    run.out.fail(`None of the ${plural(run.repos.length, "repo")} here has a ${file} to encrypt.`);
    return 1;
  }

  // Encrypted repos are only re-encrypted (retiring their current key) with --yes, or when asked.
  let include = Boolean(options.yes);
  if (existing.size > 0 && !include && run.interactive) {
    const names = [...existing];
    const one = names.length === 1;
    const choice = await choose(
      `${one ? "1 repo already has" : `${names.length} repos already have`} a ${file}.encrypted (${listNames(names, 4)}). Re-encrypt ${one ? "it" : "them"} too?`,
      [
        { value: "leave", label: one ? "No, leave it as it is" : "No, leave them as they are" },
        {
          value: "include",
          label: "Yes, re-encrypt with the key I pick",
          hint: "anyone with their current key loses access",
        },
      ],
      "leave",
    );
    if (choice === null) return cancelled(run);
    include = choice === "include";
  }
  const candidates = run.repos.filter(
    (repo) => ready.includes(repo) || (include && existing.has(repo)),
  );
  if (!include) {
    for (const repo of existing) {
      const hint = run.interactive ? "" : "; --yes re-encrypts it";
      run.set({ repo, status: "skipped", detail: `already set up${hint}` });
    }
  }
  if (candidates.length === 0) {
    run.tally();
    run.emit({ keys: [] });
    return 0;
  }

  let groups: KeyGroup[];
  if (options.key) {
    let key: Buffer;
    try {
      key = parseKey(options.key);
    } catch (err) {
      if (err instanceof InvalidKeyError) {
        run.out.fail(err.message);
        return 1;
      }
      throw err;
    }
    groups = [{ label: "key", key, source: "--key", repos: candidates }];
  } else if (!run.interactive) {
    groups = [{ label: "key", key: generateKey(), source: "new", repos: candidates }];
  } else {
    const planned = await planKeyGroups(candidates, existing, options);
    if (planned === null) return cancelled(run);
    groups = planned;
  }

  for (const group of groups) {
    const fp = fingerprint(group.key);
    run.out.line();
    run.out.heading(
      `${group.label} ${formatFingerprint(fp)}`,
      `${fingerprintWords(fp)} · ${describeSource(group.source)}`,
    );
    for (const repo of group.repos) {
      const outcome = await run.in(repo, () => initIn(run, group.key, existing.has(repo)));
      if (outcome.status === "done" || outcome.status === "unchanged")
        run.keys.set(repo, group.key);
      run.set({ repo, fingerprint: fp, ...outcome });
    }
  }
  for (const repo of candidates) {
    if (!run.outcomes.has(repo)) run.set({ repo, status: "skipped", detail: "given no key" });
  }

  run.tally();
  const usedBy = (group: KeyGroup) => group.repos.filter((repo) => run.keys.has(repo));
  for (const group of groups) {
    const repos = usedBy(group);
    if (group.source !== "new" || repos.length === 0) continue;
    const fp = fingerprint(group.key);
    run.out.line();
    run.out.line(
      `${pc.bold(group.label)} ${pc.dim(`· for ${plural(repos.length, "repo")}: ${listNames(repos, 6)}`)}`,
    );
    run.out.keyCard(formatKey(group.key), `${formatFingerprint(fp)} · ${fingerprintWords(fp)}`);
  }
  const setUp = run.with("done");
  if (setUp.length > 0) {
    run.out.nextSteps([
      `git add ${file}.encrypted .gitignore && git commit -m "Add encrypted env"   ${pc.dim(`in each of the ${plural(setUp.length, "repo")}`)}`,
      `envlope status --all   ${pc.dim("to check them")}`,
    ]);
  }

  run.emit({
    keys: groups.map((group) => {
      const fp = fingerprint(group.key);
      return {
        label: group.label,
        source: group.source,
        fingerprint: fp,
        fingerprint_words: fingerprintWords(fp),
        ...(group.source === "new" ? { key: formatKey(group.key) } : {}),
        repos: usedBy(group),
      };
    }),
  });
  return run.counts().problem > 0 ? 1 : 0;
}

function cancelled(run: Run): number {
  run.out.info("Cancelled. Nothing was changed.");
  return 130;
}
