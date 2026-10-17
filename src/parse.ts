// One assignment: optional `export`, a name, `=` (or `: `), then a quoted value that
// may span lines, or an unquoted value that ends at `#`. A quoted value only counts
// if nothing but a comment follows its closing quote; otherwise the value is read
// unquoted, as dotenv does, so a stray quote can't swallow the lines below it.
// Whitespace is matched with `\s` exactly where dotenv does, line breaks included,
// so even odd layouts (a quoted value on the line after `NAME=`) parse the same.
// The `d` flag records where each part matched, which merging needs.
const ASSIGNMENT =
  /^\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*"(?:\\"|[^"])*"|\s*'(?:\\'|[^'])*'|\s*`(?:\\`|[^`])*`|[^#\n]*)\s*(?:#[^\n]*)?$/dgm;

/** One assignment in a .env file: its name and value, and the lines it occupies. */
export interface EnvEntry {
  name: string;
  value: string;
  /** Start of the line the name is on, in the normalized text. */
  start: number;
  /** End of the line the value ends on (before its line break), in the normalized text. */
  end: number;
}

/**
 * Bytes as text for comparing and merging: latin1 maps each byte to one character,
 * so values that aren't valid UTF-8 still compare, and round-trip, byte for byte.
 * A UTF-8 byte-order mark is dropped first. Variable names are ASCII either way.
 */
export function rawText(bytes: Buffer): string {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  return bytes.subarray(bom ? 3 : 0).toString("latin1");
}

/**
 * Parse .env content into its assignments, in file order, with their positions in
 * `text`: the content with a byte-order mark removed and line breaks turned into `\n`.
 */
export function parseEnvEntries(content: string): { text: string; entries: EnvEntry[] } {
  // A byte-order mark (common in files saved on Windows) would hide the first variable.
  const text = (content.charCodeAt(0) === 0xfeff ? content.slice(1) : content).replace(
    /\r\n?/g,
    "\n",
  );
  const entries: EnvEntry[] = [];

  for (const match of text.matchAll(ASSIGNMENT)) {
    const [, name, raw = ""] = match;
    let value = raw.trim();
    const quoted = /^(["'`])([\s\S]*)\1$/.exec(value);
    if (quoted) {
      value = quoted[2]!;
      if (quoted[1] === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    const nameStart = match.indices![1]![0];
    const valueEnd = match.indices![2]![1];
    const lineEnd = text.indexOf("\n", valueEnd);
    entries.push({
      name: name!,
      value,
      start: text.lastIndexOf("\n", nameStart - 1) + 1,
      end: lineEnd === -1 ? text.length : lineEnd,
    });
  }

  return { text, entries };
}

/**
 * Parse .env content with the same rules as the `dotenv` package, so `view`
 * prints exactly what an app loading the file would see:
 *   - `export NAME=value` and `NAME: value` are accepted
 *   - quoted values ("…", '…', `…`) keep `#` and may span lines; inside double
 *     quotes, `\n` and `\r` become real newlines
 *   - a quote that is never closed is kept as part of an unquoted value
 *   - unquoted values end at `#` (an inline comment) and are trimmed
 *   - when a name is defined more than once, the last definition wins
 */
export function parseEnv(content: string): Map<string, string> {
  return new Map(parseEnvEntries(content).entries.map((entry) => [entry.name, entry.value]));
}

/** Variable names that differ between two parsed env files. */
export interface EnvDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** Compare two parsed env files by name. Values are compared but never returned. */
export function diffEnv(before: Map<string, string>, after: Map<string, string>): EnvDiff {
  const diff: EnvDiff = { added: [], changed: [], removed: [] };
  for (const [name, value] of after) {
    if (!before.has(name)) diff.added.push(name);
    else if (before.get(name) !== value) diff.changed.push(name);
  }
  for (const name of before.keys()) {
    if (!after.has(name)) diff.removed.push(name);
  }
  return diff;
}
