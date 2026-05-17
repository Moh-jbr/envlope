import { decrypt, DecryptionError, encrypt } from "../crypto.js";
import {
  DEFAULT_ENV_FILE,
  encryptedExists,
  envExists,
  readEncrypted,
  readEnv,
  writeEncrypted,
} from "../files.js";
import { InvalidKeyError, resolveKey, UserCancelled } from "../key.js";
import { Output } from "../output.js";

export async function encryptCommand(
  options: { file?: string; key?: string; json?: boolean } = {},
): Promise<number> {
  const file = options.file ?? DEFAULT_ENV_FILE;
  const out = new Output(options.json);

  if (!envExists(file)) {
    out.fail(`No ${file} file found in this directory.`);
    out.info(`Nothing to encrypt. Create a ${file} file first.`);
    return 1;
  }

  if (!encryptedExists(file)) {
    out.fail(`No ${file}.encrypted file found in this directory.`);
    out.info("Run `envlope init` first to create one.");
    return 1;
  }

  let key: Buffer;
  try {
    key = await resolveKey(options, `Enter your envlope key to re-encrypt ${file}:`);
  } catch (err) {
    if (err instanceof InvalidKeyError) {
      out.fail(err.message);
      return 1;
    }
    if (err instanceof UserCancelled) return 130;
    throw err;
  }

  // Validate the key by decrypting the existing encrypted file. Prevents using
  // a stale key (rotated out by `envlope init`) to re-encrypt and silently
  // grant access back to whoever still holds the old key.
  const existingBlob = readEncrypted(file);
  try {
    decrypt(existingBlob, key);
  } catch (err) {
    if (err instanceof DecryptionError) {
      out.fail(`This key does not match the current ${file}.encrypted.`);
      out.info(
        "Either the key is wrong, or someone rotated the key with `envlope init`. Ask a teammate for the current key.",
      );
      return 1;
    }
    throw err;
  }

  const plaintext = readEnv(file);
  const blob = encrypt(plaintext, key);
  writeEncrypted(blob, file);

  out.success(`Updated ${file}.encrypted — ready to commit.`);
  out.emit({ success: true, encrypted_file: `${file}.encrypted` });
  return 0;
}
