import { decrypt, DecryptionError } from "../crypto.js";
import {
  encryptedExists,
  ensureGitignore,
  envExists,
  isTracked,
  markInSync,
  normalizeEnvFile,
  readEncrypted,
  readEnv,
  recordBase,
  writeEnv,
} from "../files.js";
import {
  fingerprint,
  fingerprintWords,
  formatFingerprint,
  InvalidKeyError,
  resolveKey,
  UserCancelled,
} from "../key.js";
import { describeOverwrite, Output, type OutputData, summarizeOverwrite } from "../output.js";
import { diffEnv, parseEnv, rawText } from "../parse.js";
import { canPrompt, confirm, showWarning } from "../ui.js";

export async function decryptCommand(
  options: {
    file?: string;
    key?: string;
    yes?: boolean;
    json?: boolean;
    collect?: (record: OutputData) => void;
  } = {},
): Promise<number> {
  const file = normalizeEnvFile(options.file);
  const out = new Output(options.json, options.collect);

  if (!encryptedExists(file)) {
    out.fail(`No ${file}.encrypted file found in this directory.`, 1, { reason: "not_set_up" });
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
      out.fail(err.message, 1, { reason: err.wrongKey ? "wrong_key" : "unreadable" });
      return 1;
    }
    throw err;
  }

  const fp = fingerprint(key);
  const keyDetail = `key ${formatFingerprint(fp)}`;
  const result = {
    success: true,
    output_file: file,
    fingerprint: fp,
    fingerprint_words: fingerprintWords(fp),
  };

  // Only look at the existing file once we know the key works.
  if (envExists(file)) {
    const current = readEnv(file);
    if (current.equals(plaintext)) {
      markInSync(file);
      recordBase(file);
      const gitignore = ensureGitignore(file);
      out.success(`${file} already matches ${file}.encrypted — nothing to do`, keyDetail);
      out.plaintextWarnings(file, gitignore.env, isTracked(file));
      out.emit({ ...result, changed: false });
      return 0;
    }

    if (!options.yes) {
      // Compared byte for byte, so values that aren't valid UTF-8 still count.
      const diff = diffEnv(parseEnv(rawText(current)), parseEnv(rawText(plaintext)));
      if (!canPrompt(options)) {
        out.fail(
          `${file} already exists and differs from ${file}.encrypted (${summarizeOverwrite(diff)}). Pass --yes to overwrite it (required in --json mode and non-interactive shells).`,
          1,
          { reason: "local_changes", variables: diff },
        );
        return 1;
      }
      await showWarning(describeOverwrite(file, diff));
      const overwrite = await confirm(`Overwrite ${file}?`, false);
      if (!overwrite) {
        out.info(`Aborted. ${file} left untouched.`);
        return 0;
      }
    }
  }

  // Make sure .gitignore covers the plaintext before it exists.
  const gitignore = ensureGitignore(file);
  writeEnv(plaintext, file);
  markInSync(file);
  // Remember which ciphertext this .env came from, for encrypt's conflict guard.
  recordBase(file);
  out.success(`Decrypted to ${file}`, keyDetail);
  out.plaintextWarnings(file, gitignore.env, isTracked(file));
  out.emit({ ...result, changed: true });
  return 0;
}
