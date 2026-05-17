import { encrypt } from "../crypto.js";
import {
  backupEncrypted,
  DEFAULT_ENV_FILE,
  encryptedExists,
  ensureGitignore,
  envExists,
  readEnv,
  writeEncrypted,
} from "../files.js";
import { formatKey, generateKey, InvalidKeyError, parseKey } from "../key.js";
import { Output } from "../output.js";
import { confirm } from "../ui.js";

export async function initCommand(
  options: { file?: string; yes?: boolean; key?: string; json?: boolean } = {},
): Promise<number> {
  const file = options.file ?? DEFAULT_ENV_FILE;
  const out = new Output(options.json);

  if (!envExists(file)) {
    out.fail(`No ${file} file found in this directory.`);
    out.info(`Create a plaintext ${file} first, then run \`envlope init\` again.`);
    return 1;
  }

  if (encryptedExists(file)) {
    out.warn(`${file}.encrypted already exists.`);
    out.info(
      "Generating a new key will replace it — any teammates still using the old key will lose access until you share the new key with them.",
    );

    if (options.yes) {
      out.info("--yes provided; proceeding with re-encryption.");
    } else if (options.json) {
      out.fail(
        `${file}.encrypted already exists. Pass --yes to confirm re-encryption in --json mode.`,
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

  let key: Buffer;
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
    key = generateKey();
  }

  const plaintext = readEnv(file);
  const blob = encrypt(plaintext, key);
  writeEncrypted(blob, file);

  const gitignoreResult = ensureGitignore(file);

  out.success(`Encrypted ${file} → ${file}.encrypted`);
  if (gitignoreResult.added.length > 0) {
    const verb = gitignoreResult.existed ? "Updated" : "Created";
    out.success(`${verb} .gitignore (added ${gitignoreResult.added.join(", ")})`);
  } else {
    out.info(`.gitignore already protects ${file} — no changes.`);
  }

  const formattedKey = formatKey(key);

  if (options.key) {
    out.success(
      "Used the provided key — encrypted file is now unlockable with the same key as your other repos.",
    );
  } else {
    out.keyBlock(formattedKey);
  }

  out.nextSteps([`git add ${file}.encrypted .gitignore`, 'git commit -m "Add encrypted env"']);

  // In JSON mode: emit the structured result. Include `key` only when generated
  // (omit when the user provided their own to avoid duplicating known data).
  out.emit({
    success: true,
    file,
    encrypted_file: `${file}.encrypted`,
    ...(options.key ? {} : { key: formattedKey }),
  });

  return 0;
}
