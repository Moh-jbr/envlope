import { createHash, randomBytes } from "node:crypto";
import { canPrompt, choose, promptKey, UserCancelled } from "./ui.js";
import { WORDS } from "./words.js";

const KEY_PREFIX = "envlope_key_";
const KEY_BYTES = 32;
const ENV_VAR_NAME = "ENVLOPE_KEY";

export class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidKeyError";
  }
}

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function formatKey(key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Invalid key length: expected ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return `${KEY_PREFIX}${key.toString("base64")}`;
}

/**
 * A short ID for a key: 8 hex characters of a domain-separated SHA-256 of it.
 * Teammates can compare fingerprints to check they hold the same key without
 * exposing it. It gives an attacker nothing new: the committed ciphertext
 * already lets anyone test a guessed key.
 */
export function fingerprint(key: Buffer): string {
  return createHash("sha256")
    .update("envlope-key-fingerprint\0")
    .update(key)
    .digest("hex")
    .slice(0, 8);
}

/** Group a fingerprint for display: a3f907c2 → a3f9·07c2. */
export function formatFingerprint(fp: string): string {
  return `${fp.slice(0, 4)}·${fp.slice(4)}`;
}

/**
 * The fingerprint's first three bytes as words, for comparing keys out loud:
 * a3f907c2 → "opal-willow-aspen". A shorter check than the full fingerprint.
 */
export function fingerprintWords(fp: string): string {
  return [0, 2, 4].map((i) => WORDS[parseInt(fp.slice(i, i + 2), 16)]).join("-");
}

export function parseKey(formatted: string): Buffer {
  const trimmed = formatted.trim();
  if (!trimmed.startsWith(KEY_PREFIX)) {
    throw new InvalidKeyError(
      `Key must start with "${KEY_PREFIX}". Did you paste the whole key?`,
    );
  }

  const base64 = trimmed.slice(KEY_PREFIX.length);
  let key: Buffer;
  try {
    key = Buffer.from(base64, "base64");
  } catch {
    throw new InvalidKeyError("Key contents are not valid base64.");
  }

  if (key.length !== KEY_BYTES) {
    throw new InvalidKeyError(
      `Decoded key is ${key.length} bytes; expected ${KEY_BYTES}. Key may be corrupted.`,
    );
  }

  return key;
}

/**
 * Resolve the envlope key from (in priority order):
 *   1. The --key CLI flag
 *   2. The ENVLOPE_KEY environment variable
 *   3. An interactive prompt (only when stdin is a TTY and --json is off)
 *
 * Throws InvalidKeyError if no source is available, or UserCancelled if the
 * user aborts the interactive prompt.
 */
export async function resolveKey(
  options: { key?: string; json?: boolean },
  promptMessage = "Enter your envlope key:",
): Promise<Buffer> {
  if (options.key) {
    return parseKey(options.key);
  }

  const envValue = process.env[ENV_VAR_NAME];
  if (envValue && envValue.length > 0) {
    return parseKey(envValue);
  }

  if (options.json) {
    throw new InvalidKeyError(
      `No key provided. In --json mode, pass --key <key> or set ${ENV_VAR_NAME} env var.`,
    );
  }

  if (!process.stdin.isTTY) {
    throw new InvalidKeyError(
      `No key provided. Pass --key <key>, set ${ENV_VAR_NAME} env var, or run interactively.`,
    );
  }

  const formatted = await promptKey(promptMessage);
  return parseKey(formatted);
}

/**
 * When ENVLOPE_KEY already holds a valid key, offer it instead of a new one, so one
 * key can cover many repos. Only in a terminal: scripts keep getting a fresh key
 * unless they pass --key. Returns the key to use, null for a new one, or
 * "cancelled".
 */
export async function offerEnvironmentKey(
  options: { json?: boolean },
  question: string,
): Promise<Buffer | null | "cancelled"> {
  const value = process.env[ENV_VAR_NAME];
  if (!value || !canPrompt(options)) return null;
  let key: Buffer;
  try {
    key = parseKey(value);
  } catch {
    return null;
  }

  const choice = await choose(
    question,
    [
      {
        value: "reuse",
        label: "Use the key from ENVLOPE_KEY",
        hint: fingerprintWords(fingerprint(key)),
      },
      { value: "new", label: "Generate a new key" },
    ],
    "reuse",
  );
  if (choice === null) return "cancelled";
  return choice === "reuse" ? key : null;
}

export { UserCancelled };
