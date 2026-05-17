import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FORMAT_VERSION = 1;

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

export function encrypt(plaintext: Buffer, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const payload = Buffer.concat([iv, ciphertext, tag]);
  return `envlope:${FORMAT_VERSION}:${payload.toString("base64")}`;
}

export function decrypt(blob: string, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${key.length}`);
  }

  const trimmed = blob.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 3 || parts[0] !== "envlope") {
    throw new DecryptionError("Not a valid envlope-encrypted file.");
  }

  const version = Number(parts[1]);
  if (version !== FORMAT_VERSION) {
    throw new DecryptionError(
      `Unsupported envlope format version ${version}. This tool supports version ${FORMAT_VERSION}.`,
    );
  }

  const payload = Buffer.from(parts[2]!, "base64");
  if (payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new DecryptionError("Encrypted payload is truncated or malformed.");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptionError("Invalid key — decryption failed.");
  }
}
