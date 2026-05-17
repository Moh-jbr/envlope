import { randomBytes } from "node:crypto";
import { promptKey, UserCancelled } from "./ui.js";

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

export { UserCancelled };
