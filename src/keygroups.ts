import { fingerprint, fingerprintWords, generateKey, InvalidKeyError, parseKey } from "./key.js";
import { listNames, plural } from "./output.js";
import { matchNames, suggestPatterns } from "./repos.js";
import { ask, choose, confirm, pickMany, promptKey, showNote, UserCancelled } from "./ui.js";

/** Where a key came from. */
export type KeySource = "new" | "ENVLOPE_KEY" | "--key" | "pasted";

/** A key, and the repos it locks. */
export interface KeyGroup {
  /** "key 1", or just "key" when there is one. */
  label: string;
  key: Buffer;
  source: KeySource;
  repos: string[];
}

export function describeSource(source: KeySource): string {
  return {
    new: "new key",
    ENVLOPE_KEY: "from ENVLOPE_KEY",
    "--key": "from --key",
    pasted: "pasted",
  }[source];
}

/** The key in ENVLOPE_KEY, if it holds a valid one. */
function environmentKey(): Buffer | null {
  try {
    return process.env.ENVLOPE_KEY ? parseKey(process.env.ENVLOPE_KEY) : null;
  } catch {
    return null;
  }
}

/**
 * Ask how to lock a set of repos: with one key, or with several, each for the repos
 * picked for it, and where each key comes from (a new one, ENVLOPE_KEY, or one you
 * paste). Repos given no key are left alone. Returns null if cancelled; nothing has
 * been written by then.
 */
export async function planKeyGroups(
  repos: string[],
  existing: ReadonlySet<string>,
  options: { yes?: boolean } = {},
): Promise<KeyGroup[] | null> {
  if (repos.length > 1) {
    const mode = await choose(
      `How do you want to lock these ${repos.length} repos?`,
      [
        { value: "one", label: `One key for all ${repos.length}`, hint: "one key to share" },
        {
          value: "several",
          label: "Different keys for different repos",
          hint: "like one for the backend and one for the frontend",
        },
      ],
      "one",
    );
    if (mode === null) return null;
    if (mode === "several") return planSeveral(repos, existing, options);
  }

  const source = await pickKey(`Which key should lock ${repos.length === 1 ? "it" : "them"}?`, []);
  return source && [{ label: "key", ...source, repos }];
}

async function planSeveral(
  repos: string[],
  existing: ReadonlySet<string>,
  options: { yes?: boolean },
): Promise<KeyGroup[] | null> {
  const answer = await ask("How many keys?", {
    placeholder: "2",
    defaultValue: "2",
    validate: (value) => {
      const n = Number(value.trim() || "2");
      if (!Number.isInteger(n) || n < 2) return "Type a whole number, 2 or more.";
      if (n > repos.length)
        return `There are ${repos.length} repos, so ${repos.length} keys at most.`;
      return undefined;
    },
  });
  if (answer === null) return null;
  const count = Number(answer.trim() || "2");

  const toOptions = (names: string[]) =>
    names.map((repo) => ({
      value: repo,
      label: repo,
      hint: existing.has(repo) ? "already encrypted: its current key stops working" : undefined,
    }));

  const groups: KeyGroup[] = [];
  let left = repos;
  for (let i = 1; i <= count && left.length > 0; i++) {
    const title = `Key ${i} of ${count}`;
    const last = i === count;
    // The last key starts with every repo still without one.
    const start = last ? left : await startingPick(title, left);
    if (start === null) return null;
    const chosen = await pickMany(
      last
        ? `${title} · the ${plural(left.length, "repo")} left (untick any to leave alone)`
        : `${title} · its repos`,
      toOptions(left),
      start,
    );
    if (chosen === null) return null;
    const source = await pickKey(
      `${title} · which key?`,
      groups.map((g) => g.key),
    );
    if (source === null) return null;
    groups.push({ label: `key ${i}`, ...source, repos: chosen });
    left = left.filter((repo) => !chosen.includes(repo));
  }

  const lines = groups.map(
    (g) =>
      `${g.label.padEnd(7)} ${describeSource(g.source)} · ${plural(g.repos.length, "repo")}: ${listNames(g.repos, 4)}`,
  );
  if (left.length > 0) {
    lines.push(
      `${"no key".padEnd(7)} ${plural(left.length, "repo")} left alone: ${listNames(left, 4)}`,
    );
  }
  await showNote(lines.join("\n"), "The plan");
  if (!options.yes) {
    const total = groups.reduce((n, g) => n + g.repos.length, 0);
    const go = await confirm(
      `Encrypt ${plural(total, "repo")} with ${plural(groups.length, "key")}?`,
      true,
    );
    if (!go) return null;
  }
  return groups;
}

/**
 * Which repos to start a key's list with: those matching a pattern suggested by the
 * folder names, or one you type, or none to pick by hand.
 */
async function startingPick(title: string, left: string[]): Promise<string[] | null> {
  const suggestions = suggestPatterns(left);
  const choice = await choose(
    `${title} · which repos is it for?`,
    [
      ...suggestions.map((s) => ({
        value: `match:${s.pattern}`,
        label: `Names like ${s.pattern}`,
        hint: `${plural(s.names.length, "repo")}: ${listNames(s.names, 3)}`,
      })),
      {
        value: "pattern",
        label: "Names matching a pattern I type",
        hint: "like api-* or *-back,!old-*",
      },
      { value: "pick", label: "I'll tick them in a list" },
    ],
    suggestions.length > 0 ? `match:${suggestions[0]!.pattern}` : "pick",
  );
  if (choice === null) return null;
  if (choice === "pick") return [];
  if (choice.startsWith("match:")) return matchNames(left, choice.slice("match:".length));

  const pattern = await ask("Pattern (* matches anything, ! leaves names out, commas separate):", {
    placeholder: suggestions[0]?.pattern ?? "*-back",
    validate: (value) => {
      if (!value.trim()) return "Type a pattern, like *-back.";
      if (matchNames(left, value).length === 0) return "No repo without a key matches that.";
      return undefined;
    },
  });
  return pattern === null ? null : matchNames(left, pattern);
}

/**
 * Ask where a key comes from: ENVLOPE_KEY (when it holds a key not used for other
 * repos here), a new key, or one you paste. Null if cancelled.
 */
async function pickKey(
  message: string,
  used: Buffer[],
): Promise<{ key: Buffer; source: KeySource } | null> {
  const isUsed = (key: Buffer) => used.some((u) => u.equals(key));
  const env = environmentKey();
  const offered = env !== null && !isUsed(env) ? env : null;

  const choice = await choose(
    message,
    [
      ...(offered
        ? [
            {
              value: "env" as const,
              label: "The key in ENVLOPE_KEY",
              hint: fingerprintWords(fingerprint(offered)),
            },
          ]
        : []),
      { value: "new" as const, label: "A new key", hint: "shown once at the end, for you to save" },
      { value: "paste" as const, label: "A key I already have", hint: "you'll paste it" },
    ],
    offered ? "env" : "new",
  );
  if (choice === null) return null;
  if (choice === "env" && offered) return { key: offered, source: "ENVLOPE_KEY" };
  if (choice !== "paste") return { key: generateKey(), source: "new" };

  try {
    const value = await promptKey("Paste the key:", (input) => {
      try {
        return isUsed(parseKey(input)) ? "That key is already picked for other repos." : undefined;
      } catch (err) {
        return err instanceof InvalidKeyError ? err.message : "That isn't a valid key.";
      }
    });
    return { key: parseKey(value), source: "pasted" };
  } catch (err) {
    if (err instanceof UserCancelled) return null;
    throw err;
  }
}
