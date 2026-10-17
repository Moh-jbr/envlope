import { encrypt } from "../crypto.js";
import {
  backupEncrypted,
  encryptedExists,
  ensureGitignore,
  envExists,
  isTracked,
  normalizeEnvFile,
  readEnv,
  recordBase,
  writeEncrypted,
} from "../files.js";
import {
  fingerprint,
  fingerprintWords,
  formatFingerprint,
  formatKey,
  generateKey,
  InvalidKeyError,
  offerEnvironmentKey,
  parseKey,
} from "../key.js";
import { describeRule, Output, type OutputData } from "../output.js";
import { parseEnv } from "../parse.js";
import { canPrompt, confirm } from "../ui.js";

export async function initCommand(
  options: {
    file?: string;
    yes?: boolean;
    key?: string;
    json?: boolean;
    collect?: (record: OutputData) => void;
  } = {},
): Promise<number> {
  const file = normalizeEnvFile(options.file);
  const out = new Output(options.json, options.collect);

  if (!envExists(file)) {
    out.fail(`No ${file} file found in this directory.`, 1, { reason: "no_env" });
    out.info(`Create a plaintext ${file} first, then run \`envlope init\` again.`);
    return 1;
  }

  // Resolve the key before touching anything on disk, so a bad --key can't
  // overwrite the previous .bak and then fail.
  let key: Buffer;
  let reused = false;
  if (options.key) {
    try {
      key = parseKey(options.key);
    } catch (err) {
      if (err instanceof InvalidKeyError) {
        out.fail(err.message);
        return 1;
      }
      throw err;
    }
  } else {
    const fromEnvironment = await offerEnvironmentKey(
      options,
      "ENVLOPE_KEY already holds a key. Use it for this file?",
    );
    if (fromEnvironment === "cancelled") return 130;
    reused = fromEnvironment !== null;
    key = fromEnvironment ?? generateKey();
  }

  if (encryptedExists(file)) {
    out.warn(`${file}.encrypted already exists.`);
    out.info(
      "Generating a new key will replace it — any teammates still using the old key will lose access until you share the new key with them.",
    );

    if (options.yes) {
      out.info("--yes provided; proceeding with re-encryption.");
    } else if (!canPrompt(options)) {
      out.fail(
        `${file}.encrypted already exists. Pass --yes to confirm re-encryption (required in --json mode and non-interactive shells).`,
        1,
        { reason: "already_set_up" },
      );
      return 1;
    } else {
      const proceed = await confirm("Generate a new key and re-encrypt?", false);
      if (!proceed) {
        out.info("Aborted. No changes made.");
        return 0;
      }
    }

    // Backup the existing encrypted file before clobbering it.
    backupEncrypted(file);
    out.success(`Backed up old ${file}.encrypted → ${file}.encrypted.bak`);
  }

  const plaintext = readEnv(file);
  const blob = encrypt(plaintext, key);
  writeEncrypted(blob, file);
  recordBase(file);

  const gitignoreResult = ensureGitignore(file);

  const variables = parseEnv(plaintext.toString("utf8")).size;
  out.success(
    `Encrypted ${file} → ${file}.encrypted`,
    `${variables} variable${variables === 1 ? "" : "s"} · AES-256-GCM`,
  );
  const tracked = isTracked(file);
  if (gitignoreResult.added.length > 0) {
    const verb = gitignoreResult.existed ? "Updated" : "Created";
    out.success(`${verb} .gitignore (added ${gitignoreResult.added.join(", ")})`);
  } else if (gitignoreResult.env.ignored && !tracked) {
    out.info(`.gitignore already protects ${file} — no changes.`);
  }
  out.plaintextWarnings(file, gitignoreResult.env, tracked);
  if (gitignoreResult.encrypted.ignored) {
    out.alert(
      `${file}.encrypted is still ignored by ${describeRule(gitignoreResult.encrypted.rule)}, so git add will refuse it. Change or remove that rule.`,
    );
  }

  const formattedKey = formatKey(key);
  const fp = fingerprint(key);

  if (options.key || reused) {
    out.success(
      `Used ${options.key ? "the provided key" : "the key from ENVLOPE_KEY"} — this repo now unlocks with the same key as your other repos`,
      `fingerprint ${formatFingerprint(fp)} · ${fingerprintWords(fp)}`,
    );
  } else {
    out.keyCard(formattedKey, `${formatFingerprint(fp)} · ${fingerprintWords(fp)}`);
  }

  out.nextSteps([`git add ${file}.encrypted .gitignore`, 'git commit -m "Add encrypted env"']);

  // In JSON mode: emit the structured result. Include `key` only when generated
  // (omit when the user provided their own to avoid duplicating known data).
  out.emit({
    success: true,
    file,
    encrypted_file: `${file}.encrypted`,
    variables,
    fingerprint: fp,
    fingerprint_words: fingerprintWords(fp),
    ...(options.key || reused ? {} : { key: formattedKey }),
  });

  return 0;
}
