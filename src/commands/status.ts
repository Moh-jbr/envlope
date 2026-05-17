import {
  DEFAULT_ENV_FILE,
  encryptedExists,
  encryptedMtime,
  envExists,
  envMtime,
  isGitignored,
} from "../files.js";
import { Output } from "../output.js";

function humanizeAge(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export async function statusCommand(
  options: { file?: string; json?: boolean; strict?: boolean } = {},
): Promise<number> {
  const file = options.file ?? DEFAULT_ENV_FILE;
  const out = new Output(options.json);

  const envEx = envExists(file);
  const encEx = encryptedExists(file);
  const envT = envMtime(file);
  const encT = encryptedMtime(file);
  const gitignored = isGitignored(file);

  // Sync check: only meaningful if both files exist. Allow a 1-second tolerance
  // for filesystems with coarse mtime resolution.
  let inSync: boolean | null = null;
  if (envEx && encEx && envT && encT) {
    inSync = envT.getTime() <= encT.getTime() + 1000;
  }

  if (out.isHuman) {
    console.log(`File: ${file}`);
    if (envEx) {
      out.success(`${file} exists`);
    } else {
      out.warn(`${file} does not exist`);
    }
    if (encEx && encT) {
      out.success(`${file}.encrypted exists (last encrypted ${humanizeAge(encT)})`);
    } else {
      out.warn(`${file}.encrypted does not exist`);
    }
    if (envEx && encEx) {
      if (inSync === false) {
        out.warn(
          `${file} was modified after ${file}.encrypted — run \`envlope encrypt\` before committing.`,
        );
      } else if (inSync === true) {
        out.success(`${file} and ${file}.encrypted are in sync`);
      }
    }
    if (gitignored) {
      out.success(`.gitignore protects ${file}`);
    } else {
      out.warn(
        `${file} is not in .gitignore — run \`envlope init\` or add it manually before committing.`,
      );
    }
  }

  out.emit({
    file,
    env_exists: envEx,
    encrypted_exists: encEx,
    in_sync: inSync,
    last_encrypted: encT ? encT.toISOString() : null,
    gitignored,
  });

  if (options.strict && inSync === false) return 1;
  return 0;
}
