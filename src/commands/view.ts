import { decrypt, DecryptionError } from "../crypto.js";
import { DEFAULT_ENV_FILE, encryptedExists, readEncrypted } from "../files.js";
import { InvalidKeyError, resolveKey, UserCancelled } from "../key.js";
import { Output } from "../output.js";

export async function viewCommand(
  variable: string,
  options: { file?: string; key?: string; json?: boolean } = {},
): Promise<number> {
  const file = options.file ?? DEFAULT_ENV_FILE;
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

  // Parse: simple KEY=VALUE per line, skip comments and blanks.
  // No quoted-value or multi-line value support in v1 — keep it dumb.
  const lines = plaintext.toString("utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const name = line.slice(0, eqIdx).trim();
    if (name !== variable) continue;
    const value = line.slice(eqIdx + 1);
    if (options.json) {
      out.emit({ variable, value });
    } else {
      out.raw(value);
    }
    return 0;
  }

  out.fail(`Variable '${variable}' not found in ${file}.encrypted.`);
  return 1;
}
