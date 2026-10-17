import { decrypt, DecryptionError } from "../crypto.js";
import { encryptedExists, normalizeEnvFile, readEncrypted } from "../files.js";
import {
  fingerprint,
  formatFingerprint,
  InvalidKeyError,
  resolveKey,
  UserCancelled,
} from "../key.js";
import { listNames, Output } from "../output.js";
import { parseEnv } from "../parse.js";
import { closestName } from "../suggest.js";

export async function viewCommand(
  variable: string,
  options: { file?: string; key?: string; json?: boolean } = {},
): Promise<number> {
  const file = normalizeEnvFile(options.file);
  const out = new Output(options.json);

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

  const blob = readEncrypted(file);
  let plaintext: Buffer;
  try {
    plaintext = decrypt(blob, key);
  } catch (err) {
    if (err instanceof DecryptionError) {
      out.fail(err.message);
      return 1;
    }
    throw err;
  }

  const vars = parseEnv(plaintext.toString("utf8"));
  const value = vars.get(variable);
  if (value === undefined) {
    const names = [...vars.keys()];
    const suggestion = closestName(variable, names);
    const message = `Variable '${variable}' not found in ${file}.encrypted.`;
    if (options.json) {
      out.fail(suggestion ? `${message} Did you mean ${suggestion}?` : message);
    } else {
      // Hints go to stderr with the error, so a script's stdout stays empty.
      out.fail(message);
      if (suggestion) out.hint(`did you mean ${suggestion}?`);
      if (names.length > 0) out.hint(`available: ${listNames(names, 12)}`);
    }
    return 1;
  }

  if (options.json) {
    out.emit({ variable, value });
  } else if (out.isTTY) {
    // A person at a terminal gets a label; pipes and $(…) get the bare value.
    const chars = [...value].length;
    const lines = value.split("\n").length;
    const meta = [
      ...(lines > 1 ? [`${lines} lines`] : []),
      `${chars} char${chars === 1 ? "" : "s"}`,
      `${file}.encrypted`,
      `key ${formatFingerprint(fingerprint(key))}`,
    ];
    out.labeledValue(variable, value, meta.join(" · "));
  } else {
    out.raw(value);
  }
  return 0;
}
