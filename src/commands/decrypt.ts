import { decrypt, DecryptionError } from "../crypto.js";
import {
  DEFAULT_ENV_FILE,
  encryptedExists,
  ensureGitignore,
  envExists,
  readEncrypted,
  writeEnv,
} from "../files.js";
import { InvalidKeyError, resolveKey, UserCancelled } from "../key.js";
import { Output } from "../output.js";
import { confirm } from "../ui.js";

export async function decryptCommand(
  options: { file?: string; key?: string; yes?: boolean; json?: boolean } = {},
): Promise<number> {
  const file = options.file ?? DEFAULT_ENV_FILE;
  const out = new Output(options.json);

  if (!encryptedExists(file)) {
    out.fail(`No ${file}.encrypted file found in this directory.`);
    out.info("Nothing to decrypt. Did you run `git pull` in the right directory?");
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

  // Only ask about overwrite once we know the key works.
  if (envExists(file) && !options.yes) {
    if (options.json) {
      out.fail(`${file} already exists. Pass --yes to confirm overwrite in --json mode.`);
      return 1;
    }
    const overwrite = await confirm(
      `${file} already exists. Overwrite it with the decrypted contents?`,
      false,
    );
    if (!overwrite) {
      out.info(`Aborted. ${file} left untouched.`);
      return 0;
    }
  }

  writeEnv(plaintext, file);
  ensureGitignore(file);
  out.success(`Decrypted to ${file}`);
  out.emit({ success: true, output_file: file });
  return 0;
}
