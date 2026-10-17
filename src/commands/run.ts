import { decrypt, DecryptionError } from "../crypto.js";
import {
  encryptedExists,
  encryptedInfo,
  envInfo,
  normalizeEnvFile,
  readEncrypted,
} from "../files.js";
import {
  fingerprint,
  formatFingerprint,
  InvalidKeyError,
  resolveKey,
  UserCancelled,
} from "../key.js";
import { launch } from "../launch.js";
import { listNames, Output } from "../output.js";
import { parseEnv } from "../parse.js";

/**
 * The command's environment: yours plus the decrypted variables. As with dotenv,
 * variables you've already set win unless `override` is on. ENVLOPE_KEY is taken
 * out: the command gets the secrets it needs, not the key to all of them.
 */
export function commandEnvironment(
  current: NodeJS.ProcessEnv,
  vars: Map<string, string>,
  override: boolean,
): { env: NodeJS.ProcessEnv; kept: string[] } {
  const env = { ...current };
  // Windows treats variable names case-insensitively.
  const same = (a: string, b: string) =>
    process.platform === "win32" ? a.toUpperCase() === b.toUpperCase() : a === b;
  const existing = (name: string) => Object.keys(env).filter((key) => same(key, name));

  for (const key of existing("ENVLOPE_KEY")) delete env[key];
  const kept: string[] = [];
  for (const [name, value] of vars) {
    const keys = existing(name);
    if (keys.length > 0 && !override) {
      kept.push(name);
      continue;
    }
    for (const key of keys) delete env[key];
    env[name] = value;
  }
  return { env, kept };
}

/**
 * `envlope run -- <command>`: decrypt in memory and run the command with the
 * variables in its environment. The plaintext never touches disk. Exits with the
 * command's own exit code.
 */
export async function runCommand(
  command: string[],
  options: { file?: string; key?: string; override?: boolean } = {},
): Promise<number> {
  const file = normalizeEnvFile(options.file);
  const out = new Output(false);

  if (!encryptedExists(file)) {
    out.fail(`No ${file}.encrypted file found in this directory.`);
    return 1;
  }

  let key: Buffer;
  try {
    key = await resolveKey(options);
  } catch (err) {
    if (err instanceof InvalidKeyError) {
      out.fail(err.message);
      return 1;
    }
    if (err instanceof UserCancelled) return 130;
    throw err;
  }

  let plaintext: Buffer;
  try {
    plaintext = decrypt(readEncrypted(file), key);
  } catch (err) {
    if (err instanceof DecryptionError) {
      out.fail(err.message);
      return 1;
    }
    throw err;
  }

  const vars = parseEnv(plaintext.toString("utf8"));
  const { env, kept } = commandEnvironment(process.env, vars, options.override ?? false);

  // Notes only for a person watching; scripts and CI get the command's output untouched.
  if (process.stderr.isTTY) {
    const fp = formatFingerprint(fingerprint(key));
    out.note(`${vars.size} variables from ${file}.encrypted · key ${fp} → ${command.join(" ")}`);
    if (kept.length > 0) {
      out.note(
        `already set in your environment, so kept: ${listNames(kept)} (--override replaces them)`,
      );
    }
    const plain = envInfo(file);
    const enc = encryptedInfo(file);
    if (plain && enc && plain.mtime.getTime() > enc.mtime.getTime() + 1000) {
      out.note(`${file} has edits that aren't encrypted yet; this run uses ${file}.encrypted`);
    }
  }

  const [program, ...args] = command as [string, ...string[]];
  const result = await launch(program, args, env);
  if (result.status === "not-found") {
    out.fail(`Command not found: ${program}`);
    return 127;
  }
  if (result.status === "failed") {
    out.fail(`Couldn't start ${program}: ${result.error.message}`);
    return 1;
  }
  return result.code;
}
