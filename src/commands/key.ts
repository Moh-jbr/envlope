import { readdirSync, readFileSync } from "node:fs";
import { decrypt } from "../crypto.js";
import {
  fingerprint,
  fingerprintWords,
  formatFingerprint,
  InvalidKeyError,
  resolveKey,
  UserCancelled,
} from "../key.js";
import { Output, type OutputData } from "../output.js";

/**
 * Show which key you have: its fingerprint, as words to read aloud, and which
 * encrypted files in this folder it opens. Exits 1 if there are encrypted files
 * here and the key opens none of them.
 */
export async function keyCommand(
  options: { key?: string; json?: boolean; collect?: (record: OutputData) => void } = {},
): Promise<number> {
  const out = new Output(options.json, options.collect);
  const source = options.key
    ? "the --key option"
    : process.env.ENVLOPE_KEY
      ? "ENVLOPE_KEY"
      : "the prompt";

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

  const fp = fingerprint(key);
  const files = readdirSync(".")
    .filter((name) => name.endsWith(".encrypted"))
    .sort()
    .map((file) => {
      try {
        decrypt(readFileSync(file, "utf8"), key);
        return { file, opens: true };
      } catch {
        return { file, opens: false };
      }
    });

  out.keySummary(fingerprintWords(fp), formatFingerprint(fp), source, files);
  out.emit({ fingerprint: fp, fingerprint_words: fingerprintWords(fp), source, files });
  return files.length > 0 && !files.some((f) => f.opens) ? 1 : 0;
}
