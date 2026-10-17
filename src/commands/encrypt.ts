import { decrypt, DecryptionError, encrypt } from "../crypto.js";
import {
  encryptedExists,
  envExists,
  markInSync,
  normalizeEnvFile,
  readBase,
  readEncrypted,
  readEnv,
  recordBase,
  writeEncrypted,
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
import { type MergeResult, mergeEnv } from "../merge.js";
import { describeConflict, Output, type OutputData, summarizeConflict } from "../output.js";
import { diffEnv, parseEnv, rawText } from "../parse.js";
import { canPrompt, choose, showWarning } from "../ui.js";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export async function encryptCommand(
  options: {
    file?: string;
    key?: string;
    json?: boolean;
    force?: boolean;
    collect?: (record: OutputData) => void;
  } = {},
): Promise<number> {
  const file = normalizeEnvFile(options.file);
  const out = new Output(options.json, options.collect);

  if (!envExists(file)) {
    out.fail(`No ${file} file found in this directory.`, 1, { reason: "no_env" });
    out.info(`Nothing to encrypt. Create a ${file} file first.`);
    return 1;
  }

  if (!encryptedExists(file)) {
    out.fail(`No ${file}.encrypted file found in this directory.`, 1, { reason: "not_set_up" });
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
  let existing: Buffer;
  try {
    existing = decrypt(existingBlob, key);
  } catch (err) {
    if (err instanceof DecryptionError) {
      out.fail(`This key does not match the current ${file}.encrypted.`, 1, {
        reason: err.wrongKey ? "wrong_key" : "unreadable",
      });
      out.info(
        "Either the key is wrong, or someone rotated the key with `envlope init`. Ask a teammate for the current key.",
      );
      return 1;
    }
    throw err;
  }

  const plaintext = readEnv(file);
  const fp = fingerprint(key);
  const keyDetail = `key ${formatFingerprint(fp)}`;
  const result = {
    success: true,
    encrypted_file: `${file}.encrypted`,
    fingerprint: fp,
    fingerprint_words: fingerprintWords(fp),
  };

  // Every encryption uses a fresh random IV, so re-encrypting unchanged content
  // would still rewrite the file and leave a pointless diff in git.
  if (plaintext.equals(existing)) {
    markInSync(file);
    recordBase(file);
    out.success(`${file}.encrypted is already up to date — nothing to commit`, keyDetail);
    out.emit({ ...result, changed: false, variables: { added: [], changed: [], removed: [] } });
    return 0;
  }

  // The conflict guard: if .env.encrypted changed since this .env was decrypted or
  // encrypted (a teammate's update arriving with git pull), encrypting now would
  // silently undo their changes.
  const base = options.force ? null : readBase(file);
  if (base !== null && base !== existingBlob.trim()) {
    const outcome = await handleNewerVersion(file, key, base, existing, plaintext, out, options);
    if (outcome !== "overwrite") return outcome;
  }

  const blob = encrypt(plaintext, key);
  writeEncrypted(blob, file);
  recordBase(file);

  // We already decrypted the previous version to check the key, so listing what
  // changed (by name only) costs nothing.
  const after = parseEnv(rawText(plaintext));
  const variables = diffEnv(parseEnv(rawText(existing)), after);

  out.success(`Updated ${file}.encrypted — ready to commit`, keyDetail);
  out.variableChanges(variables, after.size);
  out.emit({ ...result, changed: true, variables });
  return 0;
}

/**
 * .env.encrypted is newer than the version this .env came from. Explain what each
 * side changed, then in a terminal offer to merge, overwrite or cancel; without one,
 * refuse. Returns the exit code, or "overwrite" to go ahead with a normal encrypt.
 */
async function handleNewerVersion(
  file: string,
  key: Buffer,
  base: string,
  existing: Buffer,
  plaintext: Buffer,
  out: Output,
  options: { json?: boolean },
): Promise<number | "overwrite"> {
  let merge: MergeResult | null = null;
  try {
    merge = mergeEnv(rawText(decrypt(base, key)), rawText(existing), rawText(plaintext));
  } catch {
    // The base was encrypted with an earlier key, so there's no telling who changed what.
  }

  if (!canPrompt(options)) {
    out.fail(summarizeConflict(file, merge), 1, { reason: "newer_version" });
    return 1;
  }

  await showWarning(describeConflict(file, merge));
  const mergeable = merge !== null && merge.text !== null;
  const ownChanges = merge !== null && Object.values(merge.yours).some((names) => names.length > 0);
  const choice = await choose(
    "What do you want to do?",
    [
      ...(mergeable
        ? [
            {
              value: "merge" as const,
              label: ownChanges
                ? "Merge: keep your changes and theirs"
                : "Take their changes (you have none of your own)",
            },
          ]
        : []),
      {
        value: "overwrite" as const,
        label: `Overwrite their version with your ${file}`,
        hint: "their changes are lost",
      },
      { value: "cancel" as const, label: "Cancel" },
    ],
    mergeable ? "merge" : "cancel",
  );

  if (choice === "overwrite") return "overwrite";
  if (choice !== "merge" || merge?.text == null) {
    out.info("Aborted. Nothing changed.");
    return 0;
  }

  // Their file with your changes applied: write it, then encrypt it if it differs.
  const bom = existing.subarray(0, 3).equals(UTF8_BOM) ? UTF8_BOM : Buffer.alloc(0);
  const merged = Buffer.concat([bom, Buffer.from(merge.text, "latin1")]);
  writeEnv(merged, file);
  if (!merged.equals(existing)) writeEncrypted(encrypt(merged, key), file);
  markInSync(file);
  recordBase(file);
  out.mergeSummary(file, merge, `key ${formatFingerprint(fingerprint(key))}`);
  return 0;
}
