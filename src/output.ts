import pc from "picocolors";
import type { IgnoreRule, IgnoreStatus } from "./files.js";
import type { MergeResult } from "./merge.js";
import type { EnvDiff } from "./parse.js";

export type OutputData = Record<string, unknown>;

/** One row of `status`: a check, what was found, and how to fix it if it failed. */
export interface CheckRow {
  state: "ok" | "problem" | "info";
  label: string;
  detail: string;
  fix?: string;
}

/** How a repo came out of an --all run. */
export type RepoStatus = "done" | "unchanged" | "attention" | "other_key" | "skipped" | "problem";

/** One repo's line in an --all run, with notes and warnings to show under it. */
export interface RepoRow {
  repo: string;
  status: RepoStatus;
  detail: string;
  /** More about the detail; a note starting "fix: " is shown as a fix. */
  notes?: string[];
  /** Risks, like a plaintext file git tracks. Shown with a ⚠ whatever the status. */
  warnings?: string[];
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Which ignore rule decided, for messages: "rule .env* (.gitignore line 2)". Control
 * characters are replaced, since a .gitignore line could otherwise rewrite the screen.
 */
export function describeRule(rule: IgnoreRule | null): string {
  if (!rule) return "no rule";
  return `rule ${rule.pattern} (${rule.source} line ${rule.line})`.replace(/[\x00-\x1f\x7f]/g, "?");
}

/** "A, B, C and 2 more" — keeps long name lists from flooding a single line. */
export function listNames(names: string[], max = 5): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * Body of decrypt's overwrite warning: which variables the overwrite would
 * replace, remove or add, by name only.
 */
export function describeOverwrite(file: string, diff: EnvDiff): string {
  const header = `${file} already exists and differs from ${file}.encrypted`;
  const rows = [
    ...diff.changed.map((name) => ({
      kind: "changed",
      color: pc.yellow,
      name,
      note: "your local value is replaced",
    })),
    ...diff.removed.map((name) => ({
      kind: "removed",
      color: pc.red,
      name,
      note: `only in your local ${file}`,
    })),
    ...diff.added.map((name) => ({
      kind: "added",
      color: pc.green,
      name,
      note: `new in ${file}.encrypted`,
    })),
  ];
  if (rows.length === 0) return `${header}\n\nOnly comments or formatting differ.`;

  const width = Math.max(...rows.map((r) => r.name.length)) + 3;
  const lines = rows.map(
    (r) => `${r.color(r.kind.padEnd(10))}${r.name.padEnd(width)}${pc.dim(r.note)}`,
  );
  return [header, "", ...lines].join("\n");
}

const changedNames = (diff: EnvDiff) => [...diff.added, ...diff.changed, ...diff.removed];

/** "+ NEW  ~ CHANGED  - REMOVED", colored; names only. */
function changeTokens(diff: EnvDiff): string {
  const tokens = [
    ...diff.added.map((n) => pc.green(`+ ${n}`)),
    ...diff.changed.map((n) => pc.yellow(`~ ${n}`)),
    ...diff.removed.map((n) => pc.red(`- ${n}`)),
  ];
  return tokens.length > 0 ? tokens.join("  ") : pc.dim("no variable changes");
}

/**
 * The warning above encrypt's conflict prompt: .env.encrypted changed since the
 * env file was made, and what each side changed since then.
 */
export function describeConflict(file: string, merge: MergeResult | null): string {
  const header = `${file}.encrypted changed since your ${file} was made (a teammate's update?)`;
  if (!merge) {
    return `${header}\n\nIt has been encrypted with a different key since, so envlope can't tell what each side changed.`;
  }
  const lines = [
    header,
    "",
    `${pc.dim("theirs".padEnd(9))}${changeTokens(merge.theirs)}`,
    `${pc.dim("yours".padEnd(9))}${changeTokens(merge.yours)}`,
  ];
  if (merge.conflicts.length > 0) {
    lines.push(
      `${pc.dim("both".padEnd(9))}${pc.red(listNames(merge.conflicts))} ${pc.dim("(changed differently, so these can't merge)")}`,
    );
  }
  return lines.join("\n");
}

/** One-line version of describeConflict, for refusing when there's no terminal to ask in. */
export function summarizeConflict(file: string, merge: MergeResult | null): string {
  const changed = `${file}.encrypted changed since your ${file} was made`;
  const force = `pass --force to replace their version with your ${file}`;
  if (!merge) {
    return `${changed}, with a different key, so envlope can't tell what each side changed. To encrypt anyway, ${force}.`;
  }
  const theirs = changedNames(merge.theirs);
  const theyChanged =
    theirs.length > 0 ? `they changed ${listNames(theirs)}` : "they changed only comments";
  if (merge.conflicts.length > 0) {
    return `${changed}, and you both changed ${listNames(merge.conflicts)}. Encrypting now would undo their changes. Back up your ${file}, run envlope decrypt --yes, redo your changes and encrypt again, or ${force}.`;
  }
  const yours = changedNames(merge.yours);
  if (yours.length === 0) {
    return `${changed} (${theyChanged}), and your ${file} has no changes of its own. Run envlope decrypt to get theirs, or ${force}.`;
  }
  return `${changed} (${theyChanged}; you changed ${listNames(yours)}). Encrypting now would undo their changes. Run envlope encrypt in a terminal to merge them, or ${force}.`;
}

/** One-line version of describeOverwrite, for errors when there's no terminal to prompt in. */
export function summarizeOverwrite(diff: EnvDiff): string {
  const parts = [
    diff.changed.length > 0 && `would replace ${listNames(diff.changed)}`,
    diff.removed.length > 0 && `would remove ${listNames(diff.removed)}`,
    diff.added.length > 0 && `would add ${listNames(diff.added)}`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : "only comments or formatting differ";
}

/**
 * Centralized output dispatcher. Constructed per-command from `options.json`.
 *
 * - In human mode: `success`/`info`/`warn`/`fail` write colored lines to stdout/stderr.
 *   `emit` is a no-op (human output already shown).
 * - In JSON mode: `success`/`info`/`warn` are no-ops. The command must call `emit`
 *   exactly once with the final structured result. `fail` writes a JSON error
 *   object and is the only output.
 * - With `collect` (used by `--all`): JSON mode, but the result object goes to
 *   `collect` instead of stdout, so a caller can gather one result per repo.
 * - `alert` is a warning that also reaches JSON output, as the result's `warnings`.
 */
export class Output {
  public readonly json: boolean;
  private readonly warnings: string[] = [];

  constructor(
    json: boolean = false,
    private readonly collect?: (record: OutputData) => void,
  ) {
    this.json = json || collect !== undefined;
  }

  get isHuman(): boolean {
    return !this.json;
  }

  /** Whether stdout is an interactive terminal (not a pipe, file or CI log). */
  get isTTY(): boolean {
    return Boolean(process.stdout.isTTY);
  }

  /** A ✓ line, with optional dimmed detail after the message ("✓ Decrypted to .env · key …"). */
  success(message: string, detail?: string): void {
    if (this.json) return;
    console.log(`${pc.green("✓")} ${message}${detail ? ` ${pc.dim(`· ${detail}`)}` : ""}`);
  }

  /** A plain line, or a blank one. Human mode only. */
  line(text = ""): void {
    if (this.json) return;
    console.log(text);
  }

  /** A quiet status line on stderr, out of the way of a command's own output. Human mode only. */
  note(message: string): void {
    if (this.json) return;
    console.error(`${pc.dim("envlope ›")} ${message}`);
  }

  /** A follow-up line under an error, on stderr so stdout stays clean. Human mode only. */
  hint(message: string): void {
    if (this.json) return;
    console.error(`  ${message}`);
  }

  /**
   * Warn when the plaintext env file isn't actually kept out of git: git tracks it
   * (so .gitignore doesn't apply), or no rule ignores it. Human mode only.
   */
  plaintextWarnings(file: string, status: IgnoreStatus, tracked: boolean | null): void {
    if (tracked) {
      this.alert(
        `${file} is tracked by git, so .gitignore won't keep it out of commits. Run git rm --cached ${file}, and treat the values already in git history as exposed.`,
      );
    } else if (!status.ignored) {
      const why = status.rule
        ? `${describeRule(status.rule)} re-includes it`
        : "no rule matches it";
      this.alert(`${file} is not ignored by git (${why}). Fix .gitignore before committing.`);
    }
  }

  info(message: string): void {
    if (this.json) return;
    console.log(`${pc.cyan("›")} ${message}`);
  }

  warn(message: string): void {
    if (this.json) return;
    console.log(`${pc.yellow("⚠")} ${message}`);
  }

  /** A warning a script should see too: in JSON mode it goes in the result's `warnings`. */
  alert(message: string): void {
    if (this.json) this.warnings.push(message);
    else this.warn(message);
  }

  /**
   * The "save this key" card `init` shows once, with the key's fingerprint. The key
   * is bold in the default text color so it reads on light and dark terminals.
   * Falls back to plain lines when the terminal is too narrow for the box.
   */
  keyCard(formattedKey: string, fingerprint: string): void {
    if (this.json) return;
    const inner = formattedKey.length + 4;
    const title = "SAVE THIS KEY · shown once";
    const footer = "password manager → share over a secure channel";
    const fingerprintLine = `fingerprint  ${fingerprint}`;

    console.log("");
    if ((process.stdout.columns ?? Infinity) < inner + 2) {
      console.log(pc.bold("SAVE THIS KEY (shown once):"));
      console.log(`  ${pc.bold(formattedKey)}`);
      console.log(`  ${pc.dim("fingerprint")}  ${pc.bold(fingerprint)}`);
      console.log(pc.dim("Store it in your password manager and share it over a secure channel."));
      return;
    }

    const edge = (left: string, plain: string, styled: string, right: string) =>
      pc.cyan(`${left}─ `) + styled + pc.cyan(` ${"─".repeat(inner - plain.length - 3)}${right}`);
    const row = (plain = "", styled = plain) =>
      `${pc.cyan("│")}  ${styled}${" ".repeat(inner - 4 - plain.length)}  ${pc.cyan("│")}`;

    console.log(edge("╭", title, `${pc.bold("SAVE THIS KEY")} ${pc.dim("· shown once")}`, "╮"));
    console.log(row());
    console.log(row(formattedKey, pc.bold(formattedKey)));
    console.log(row(fingerprintLine, `${pc.dim("fingerprint")}  ${pc.bold(fingerprint)}`));
    console.log(row());
    console.log(edge("╰", footer, pc.dim(footer), "╯"));
  }

  /** List changed variables by name — never values — after `encrypt`. Human mode only. */
  variableChanges(diff: EnvDiff, total: number): void {
    if (this.json) return;
    const count = diff.added.length + diff.changed.length + diff.removed.length;
    console.log("");
    if (count === 0) {
      console.log(pc.dim("  No variable changes (only comments or formatting)."));
      return;
    }
    for (const name of diff.added) console.log(`    ${pc.green(`+ ${name}`)}`);
    for (const name of diff.changed) console.log(`    ${pc.yellow(`~ ${name}`)}`);
    for (const name of diff.removed) console.log(`    ${pc.red(`- ${name}`)}`);
    console.log("");
    console.log(
      pc.dim(
        `  ${plural(count, "change")} · ${plural(total, "variable")} · values are never printed`,
      ),
    );
  }

  /** After encrypt's conflict merge: what came from them and what was yours. Human mode only. */
  mergeSummary(file: string, merge: MergeResult, keyDetail: string): void {
    if (this.json) return;
    const own = changedNames(merge.yours).length > 0;
    this.success(
      own
        ? `Merged their changes and yours into ${file} and ${file}.encrypted`
        : `Updated ${file} with their changes (you had none of your own)`,
      keyDetail,
    );
    console.log("");
    console.log(`    ${pc.dim("theirs".padEnd(8))}${changeTokens(merge.theirs)}`);
    if (own) console.log(`    ${pc.dim("yours".padEnd(8))}${changeTokens(merge.yours)}`);
    if (own && merge.dropsOtherEdits) {
      console.log("");
      this.warn(
        `Only variable changes merge: comments and line order in your ${file} now follow ${file}.encrypted.`,
      );
    }
  }

  /** `status`: one row per check, a fix line under each problem, then a problem count. */
  checklist(command: string, file: string, rows: CheckRow[]): void {
    if (this.json) return;
    const width = Math.max(...rows.map((r) => r.label.length)) + 2;
    const mark = { ok: pc.green("✓"), problem: pc.red("✗"), info: pc.dim("–") };

    console.log(`${pc.bold(command)} ${pc.dim(`· ${file}`)}`);
    console.log("");
    for (const r of rows) {
      const detail = r.state === "problem" ? r.detail : pc.dim(r.detail);
      console.log(`  ${mark[r.state]} ${r.label.padEnd(width)}${detail}`);
      if (r.fix) console.log(`${" ".repeat(width + 4)}${pc.dim("fix:")} ${r.fix}`);
    }
    const problems = rows.filter((r) => r.state === "problem").length;
    console.log("");
    console.log(
      problems === 0
        ? pc.green("  No problems")
        : pc.bold(pc.red(`  ${plural(problems, "problem")}`)),
    );
  }

  /** `key`: which key this is, and which encrypted files here it opens. */
  keySummary(
    words: string,
    hex: string,
    source: string,
    files: { file: string; opens: boolean }[],
  ): void {
    if (this.json) return;
    console.log(`${pc.bold("key")}  ${pc.bold(words)}  ${pc.dim(`(${hex})`)}`);
    console.log(`     ${pc.dim(`from ${source}`)}`);
    if (files.length === 0) console.log(`     ${pc.dim("no .encrypted files in this folder")}`);
    for (const { file, opens } of files) {
      const verdict = opens ? `${pc.green("✓")} opens` : `${pc.red("✗")} doesn't open`;
      console.log(`     ${verdict} ${file}`);
    }
  }

  /** `view` in a terminal: the name, the value, then where it came from. */
  labeledValue(name: string, value: string, meta: string): void {
    if (this.json) return;
    const indent = " ".repeat(name.length + 2);
    const [first = "", ...rest] = value.split("\n");
    console.log(`${pc.bold(name)}  ${value === "" ? pc.dim("(empty)") : first}`);
    for (const line of rest) console.log(`${indent}${line}`);
    console.log(`${indent}${pc.dim(meta)}`);
  }

  /** `--all`: the title line above the rows ("envlope status --all · 12 repos in work"). */
  heading(title: string, detail?: string): void {
    if (this.json) return;
    console.log(`${pc.bold(title)}${detail ? ` ${pc.dim(`· ${detail}`)}` : ""}`);
  }

  /** `--all`: one line per repo, with its notes indented under the detail. */
  repoRow(row: RepoRow, width: number): void {
    if (this.json) return;
    const mark = {
      done: pc.green("✓"),
      unchanged: pc.dim("✓"),
      attention: pc.yellow("▲"),
      other_key: pc.cyan("○"),
      skipped: pc.dim("–"),
      problem: pc.red("✗"),
    }[row.status];
    const loud = row.status === "attention" || row.status === "problem";
    console.log(`  ${mark} ${row.repo.padEnd(width)}  ${loud ? row.detail : pc.dim(row.detail)}`);
    for (const note of row.notes ?? []) {
      const text = note.startsWith("fix: ")
        ? `${pc.dim("fix:")} ${note.slice(5)}`
        : loud
          ? note
          : pc.dim(note);
      console.log(`${" ".repeat(width + 6)}${text}`);
    }
    for (const warning of row.warnings ?? []) {
      console.log(`${" ".repeat(width + 6)}${pc.yellow("⚠")} ${warning}`);
    }
  }

  /**
   * `--all`: the totals ("40 decrypted · 6 already matched"), then a line for each
   * group of repos left out, with their names.
   */
  tally(
    parts: { count: number; text: string; status: RepoStatus }[],
    groups: { mark: RepoStatus; text: string; repos: string[] }[],
  ): void {
    if (this.json) return;
    const color = (status: RepoStatus) =>
      ({
        done: pc.green,
        unchanged: pc.dim,
        attention: pc.yellow,
        other_key: pc.cyan,
        skipped: pc.dim,
        problem: pc.red,
      })[status];
    const shown = parts.filter((p) => p.count > 0);
    console.log("");
    if (shown.length > 0) {
      console.log(
        `  ${shown.map((p) => color(p.status)(`${p.count} ${p.text}`)).join(pc.dim(" · "))}`,
      );
    }
    for (const group of groups) {
      if (group.repos.length === 0) continue;
      const mark = group.mark === "other_key" ? pc.cyan("○") : pc.dim("–");
      console.log(`  ${mark} ${group.text}: ${pc.dim(listNames(group.repos, 6))}`);
    }
  }

  /** Render a "Next steps" section. Human mode only. */
  nextSteps(steps: string[]): void {
    if (this.json) return;
    console.log("");
    console.log(pc.bold("Next:"));
    for (const step of steps) {
      console.log(`  ${pc.dim("$")} ${step}`);
    }
    console.log("");
  }

  /**
   * Emit the final structured result. In JSON mode, prints one JSON object to
   * stdout. In human mode, this is a no-op (success/info etc. handled output).
   */
  emit(data: OutputData): void {
    if (!this.json) return;
    const record = this.warnings.length > 0 ? { ...data, warnings: this.warnings } : data;
    if (this.collect) this.collect(record);
    else console.log(JSON.stringify(record));
  }

  /**
   * Emit a failure. In JSON mode, writes a structured `{error, code}` JSON
   * object to stdout, plus `extra` (like a `reason` a script can check). In human
   * mode, writes a red ✗ line to stderr.
   */
  fail(message: string, code = 1, extra: OutputData = {}): void {
    if (this.json) {
      const record = { error: message, code, ...extra };
      if (this.collect) this.collect(record);
      else console.log(JSON.stringify(record));
    } else {
      console.error(`${pc.red("✗")} ${message}`);
    }
  }

  /** Print a raw line (used by `view` to print the variable value). */
  raw(line: string): void {
    console.log(line);
  }
}
