import pc from "picocolors";

export type OutputData = Record<string, unknown>;

/**
 * Centralized output dispatcher. Constructed per-command from `options.json`.
 *
 * - In human mode: `success`/`info`/`warn`/`fail` write colored lines to stdout/stderr.
 *   `emit` is a no-op (human output already shown).
 * - In JSON mode: `success`/`info`/`warn` are no-ops. The command must call `emit`
 *   exactly once with the final structured result. `fail` writes a JSON error
 *   object and is the only output.
 */
export class Output {
  constructor(public readonly json: boolean = false) {}

  get isHuman(): boolean {
    return !this.json;
  }

  success(message: string): void {
    if (this.json) return;
    console.log(`${pc.green("✓")} ${message}`);
  }

  info(message: string): void {
    if (this.json) return;
    console.log(`${pc.cyan("›")} ${message}`);
  }

  warn(message: string): void {
    if (this.json) return;
    console.log(`${pc.yellow("⚠")} ${message}`);
  }

  /** Render the prominent "SAVE THIS KEY" block. Human mode only. */
  keyBlock(formattedKey: string): void {
    if (this.json) return;
    const bar = pc.dim("─".repeat(64));
    console.log("");
    console.log(pc.bold(pc.yellow("SAVE THIS KEY — it cannot be recovered:")));
    console.log(bar);
    console.log(`   ${pc.bold(formattedKey)}`);
    console.log(bar);
    console.log(
      pc.dim(
        "Save it in your password manager and share with teammates over a secure channel.",
      ),
    );
    console.log("");
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
    console.log(JSON.stringify(data));
  }

  /**
   * Emit a failure. In JSON mode, writes a structured `{error, code}` JSON
   * object to stdout. In human mode, writes a red ✗ line to stderr.
   */
  fail(message: string, code = 1): void {
    if (this.json) {
      console.log(JSON.stringify({ error: message, code }));
    } else {
      console.error(`${pc.red("✗")} ${message}`);
    }
  }

  /** Print a raw line (used by `view` to print the variable value). */
  raw(line: string): void {
    console.log(line);
  }
}
