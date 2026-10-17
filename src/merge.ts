import { diffEnv, type EnvDiff, parseEnv, parseEnvEntries } from "./parse.js";

export interface MergeResult {
  /** What each side changed since the version both started from, by name. */
  yours: EnvDiff;
  theirs: EnvDiff;
  /** Names both sides changed, to different values. */
  conflicts: string[];
  /** Their file with your changes applied, or null when there are conflicts. */
  text: string | null;
  /** Your file also had edits that aren't variable changes (comments, order), which a merge drops. */
  dropsOtherEdits: boolean;
}

const changedNames = (diff: EnvDiff) => [...diff.added, ...diff.changed, ...diff.removed];

/**
 * Three-way merge of .env files, variable by variable. `base` is the version both
 * sides started from, `theirs` the newer one from .env.encrypted, `yours` the local
 * file. Variables only you changed are carried into their file; a variable you both
 * changed to different values is a conflict, and then nothing is merged.
 */
export function mergeEnv(base: string, theirs: string, yours: string): MergeResult {
  const baseVars = parseEnv(base);
  const theirVars = parseEnv(theirs);
  const yourVars = parseEnv(yours);
  const yourDiff = diffEnv(baseVars, yourVars);
  const theirDiff = diffEnv(baseVars, theirVars);

  const theyChanged = new Set(changedNames(theirDiff));
  const differs = (name: string) => yourVars.get(name) !== theirVars.get(name);
  const conflicts = changedNames(yourDiff).filter((name) => theyChanged.has(name) && differs(name));

  let text: string | null = null;
  if (conflicts.length === 0) {
    text = applyChanges(theirs, yours, changedNames(yourDiff).filter(differs));
    // Keep their line endings.
    if (theirs.includes("\r\n")) text = text.replace(/\n/g, "\r\n");
  }

  const yourChangesOnBase = applyChanges(base, yours, changedNames(yourDiff));
  return {
    yours: yourDiff,
    theirs: theirDiff,
    conflicts,
    text,
    dropsOtherEdits: yourChangesOnBase !== parseEnvEntries(yours).text,
  };
}

/**
 * Copy each named variable's assignment, exactly as written, from `source` into
 * `target`: replacing the definition that counts (the last one), adding it at the
 * end, or removing every definition if `source` no longer has it. Returns the
 * result with `\n` line breaks.
 */
function applyChanges(target: string, source: string, names: string[]): string {
  const into = parseEnvEntries(target);
  const from = parseEnvEntries(source);
  const edits: { start: number; end: number; insert: string }[] = [];
  const added: string[] = [];

  for (const name of names) {
    const mine = from.entries.filter((entry) => entry.name === name).pop();
    const theirs = into.entries.filter((entry) => entry.name === name);
    if (!mine) {
      // Removed: drop every definition, so an earlier one can't come back into effect.
      for (const entry of theirs) {
        edits.push({
          start: entry.start,
          end: Math.min(entry.end + 1, into.text.length),
          insert: "",
        });
      }
      continue;
    }
    const assignment = from.text.slice(mine.start, mine.end);
    const last = theirs.pop();
    if (last) edits.push({ start: last.start, end: last.end, insert: assignment });
    else added.push(assignment);
  }

  let text = into.text;
  for (const { start, end, insert } of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, start) + insert + text.slice(end);
  }
  if (added.length > 0) {
    text += `${text === "" || text.endsWith("\n") ? "" : "\n"}${added.join("\n")}\n`;
  }
  return text;
}
