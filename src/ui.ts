import pc from "picocolors";

// @clack/prompts is only needed when a prompt is actually shown, so it's imported
// on demand to keep it off the startup path of non-interactive runs.
const loadPrompts = () => import("@clack/prompts");

export const colors = pc;

export function success(message: string): void {
  console.log(`${pc.green("✓")} ${message}`);
}

export function info(message: string): void {
  console.log(`${pc.cyan("›")} ${message}`);
}

export function warn(message: string): void {
  console.log(`${pc.yellow("⚠")} ${message}`);
}

export function fail(message: string): void {
  console.error(`${pc.red("✗")} ${message}`);
}

export function keyBlock(formattedKey: string): void {
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

/**
 * Whether a confirmation prompt can be shown. Prompts need a terminal on stdin
 * (piped or closed stdin makes @clack/prompts crash), and --json mode must never
 * block waiting for input.
 */
export function canPrompt(options: { json?: boolean } = {}): boolean {
  return !options.json && Boolean(process.stdin.isTTY);
}

/** Print a warning on the prompt rail (clack's ▲ block), e.g. above a confirmation. */
export async function showWarning(message: string): Promise<void> {
  const prompts = await loadPrompts();
  prompts.log.warn(message);
}

export async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const prompts = await loadPrompts();
  const result = await prompts.confirm({
    message,
    initialValue: defaultValue,
  });

  if (prompts.isCancel(result)) {
    return false;
  }
  return result;
}

/** A single-choice prompt. Returns the chosen value, or null if cancelled. */
export async function choose<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
  initialValue: T,
): Promise<T | null> {
  const prompts = await loadPrompts();
  const choices: { value: string; label: string; hint?: string }[] = options;
  const result = await prompts.select({
    message,
    options: choices,
    initialValue: initialValue as string,
  });
  return prompts.isCancel(result) ? null : (result as T);
}

export async function promptKey(
  message = "Enter your envlope key:",
  check?: (value: string) => string | undefined,
): Promise<string> {
  const prompts = await loadPrompts();
  const result = await prompts.password({
    message,
    validate: (value) => {
      if (!value) return "Key is required.";
      if (!value.startsWith("envlope_key_")) return "Key must start with envlope_key_";
      return check?.(value);
    },
  });

  if (prompts.isCancel(result)) {
    throw new UserCancelled();
  }
  return result;
}

/** A free-text prompt. Returns the answer (the default if left empty), or null if cancelled. */
export async function ask(
  message: string,
  options: {
    placeholder?: string;
    defaultValue?: string;
    validate?: (value: string) => string | undefined;
  } = {},
): Promise<string | null> {
  const prompts = await loadPrompts();
  const { validate } = options;
  const result = await prompts.text({
    ...options,
    message,
    // Called with undefined when Enter is pressed before typing anything.
    validate: validate && ((value) => validate(value ?? "")),
  });
  return prompts.isCancel(result) ? null : (result ?? "");
}

/** A box of text on the prompt rail, e.g. a plan to confirm. */
export async function showNote(message: string, title?: string): Promise<void> {
  const prompts = await loadPrompts();
  prompts.note(message, title);
}

/**
 * Which rows of a long list to show: `size` rows starting at the returned index,
 * moved only as far as needed to keep the cursor, plus one row around it, in view.
 */
export function scrollWindow(cursor: number, top: number, size: number, total: number): number {
  if (total <= size) return 0;
  if (cursor < top + 1) top = cursor - 1;
  if (cursor > top + size - 2) top = cursor - size + 2;
  return Math.max(0, Math.min(top, total - size));
}

/** Cut plain text to a width, marking the cut with an ellipsis. */
const fit = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

/** What one frame of the pickMany checklist shows. */
export interface PickerView {
  message: string;
  options: { value: string; label: string; hint?: string }[];
  state: "initial" | "active" | "cancel" | "submit" | "error";
  cursor: number;
  value: string[];
  error: string;
  /** The first row shown in the previous frame. */
  top: number;
  rows: number;
  columns: number;
}

/**
 * Draw one frame of the checklist, in clack's style, and return it with the first
 * row it shows. Only as many rows as fit the terminal are drawn, so the frame never
 * outgrows the screen (clack redraws by moving the cursor up, and can't move above
 * the top). The cursor's row shows its hint; the footer counts the ticked ones.
 */
export function drawPicker(view: PickerView): { frame: string; top: number } {
  const { message, options, state, cursor } = view;
  const chosen = new Set(view.value);
  const title = `${pc.gray("│")}\n`;
  if (state === "submit") {
    const labels = options.filter((o) => chosen.has(o.value)).map((o) => o.label);
    const shown =
      labels.length <= 4
        ? labels.join(", ")
        : `${labels.slice(0, 4).join(", ")} and ${labels.length - 4} more`;
    return {
      frame: `${title}${pc.green("◇")}  ${message}\n${pc.gray("│")}  ${pc.dim(`${labels.length} · ${shown}`)}`,
      top: view.top,
    };
  }
  if (state === "cancel") {
    return { frame: `${title}${pc.red("■")}  ${message}\n${pc.gray("│")}`, top: view.top };
  }

  const color = state === "error" ? pc.yellow : pc.cyan;
  // Leave room for the frame's other lines and a few of what came before.
  const size = Math.max(3, Math.min(options.length, view.rows - 9));
  const top = scrollWindow(cursor, view.top, size, options.length);

  const lines = options.slice(top, top + size).map((option, i) => {
    const active = top + i === cursor;
    const box = chosen.has(option.value) ? pc.green("◼") : active ? pc.cyan("◻") : pc.dim("◻");
    const room = view.columns - 8;
    if (!active) return `${box} ${pc.dim(fit(option.label, room))}`;
    const label = fit(option.label, room);
    const hint = option.hint ? fit(`  (${option.hint})`, room - label.length) : "";
    return `${box} ${label}${pc.dim(hint)}`;
  });
  if (options.length > size) {
    const below = options.length - top - size;
    lines.unshift(top > 0 ? pc.dim(`↑ ${top} more`) : "");
    lines.push(below > 0 ? pc.dim(`↓ ${below} more`) : "");
  }

  const footer =
    state === "error"
      ? pc.yellow(view.error)
      : pc.dim(
          `${chosen.size} of ${options.length} ticked · space ticks · a ticks all · enter confirms`,
        );
  const body = lines.map((line) => `${color("│")}  ${line}`).join("\n");
  return { frame: `${title}${color("◆")}  ${message}\n${body}\n${color("└")}  ${footer}\n`, top };
}

/**
 * A checklist for picking several items from a long list, like the repos in a
 * folder. clack's own multiselect draws every option at once, which breaks once the
 * list is taller than the terminal; this one scrolls. Space ticks, `a` ticks all.
 * Returns the ticked values in list order, or null if cancelled.
 */
export async function pickMany<T extends string>(
  message: string,
  options: { value: T; label: string; hint?: string }[],
  initial: T[] = [],
): Promise<T[] | null> {
  const { MultiSelectPrompt, isCancel } = await import("@clack/core");
  let top = 0;

  const prompt = new MultiSelectPrompt({
    options,
    initialValues: initial,
    validate(value: T[]) {
      if (value.length === 0) return "Tick at least one: space ticks, a ticks all.";
      return undefined;
    },
    render() {
      const drawn = drawPicker({
        message,
        options,
        state: this.state,
        cursor: this.cursor,
        value: this.value,
        error: this.error,
        top,
        rows: process.stdout.rows ?? 24,
        columns: process.stdout.columns ?? 80,
      });
      top = drawn.top;
      return drawn.frame;
    },
  });

  const result = await prompt.prompt();
  if (isCancel(result)) return null;
  const picked = new Set<unknown>(result as unknown as T[]);
  return options.map((o) => o.value).filter((value) => picked.has(value));
}

export class UserCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "UserCancelled";
  }
}

export function nextSteps(steps: string[]): void {
  console.log("");
  console.log(pc.bold("Next:"));
  for (const step of steps) {
    console.log(`  ${pc.dim("$")} ${step}`);
  }
  console.log("");
}
