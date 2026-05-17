import { describe, expect, it } from "vitest";
import { decrypt, DecryptionError, encrypt } from "../src/crypto.js";
import { generateKey } from "../src/key.js";

describe("crypto", () => {
  it("round-trips a simple .env content", () => {
    const key = generateKey();
    const plaintext = Buffer.from("DB_URL=postgres://localhost/db\nAPI_KEY=abc123\n");
    const blob = encrypt(plaintext, key);
    const decrypted = decrypt(blob, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it("produces output prefixed with envlope:1:", () => {
    const key = generateKey();
    const blob = encrypt(Buffer.from("X=1"), key);
    expect(blob.startsWith("envlope:1:")).toBe(true);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const key = generateKey();
    const plaintext = Buffer.from("SAME=value");
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with a wrong key", () => {
    const realKey = generateKey();
    const wrongKey = generateKey();
    const blob = encrypt(Buffer.from("SECRET=value"), realKey);
    expect(() => decrypt(blob, wrongKey)).toThrow(DecryptionError);
  });

  it("fails to decrypt tampered ciphertext", () => {
    const key = generateKey();
    const blob = encrypt(Buffer.from("SECRET=value-long-enough-to-tamper"), key);
    // Decode payload, flip a byte in the middle of the ciphertext, re-encode
    const prefix = "envlope:1:";
    const payload = Buffer.from(blob.slice(prefix.length), "base64");
    payload[20] = payload[20]! ^ 0xff;
    const tampered = prefix + payload.toString("base64");
    expect(() => decrypt(tampered, key)).toThrow(DecryptionError);
  });

  it("rejects non-envlope blobs", () => {
    const key = generateKey();
    expect(() => decrypt("not-an-envlope-file", key)).toThrow(DecryptionError);
  });

  it("rejects unsupported version numbers", () => {
    const key = generateKey();
    expect(() => decrypt("envlope:99:abc", key)).toThrow(/version 99/);
  });

  it("rejects truncated payloads", () => {
    const key = generateKey();
    expect(() => decrypt("envlope:1:" + Buffer.from("short").toString("base64"), key)).toThrow(
      DecryptionError,
    );
  });

  it("rejects keys of wrong length", () => {
    const shortKey = Buffer.alloc(16);
    expect(() => encrypt(Buffer.from("X=1"), shortKey)).toThrow(/Invalid key length/);
  });

  it("handles large plaintexts (1MB)", () => {
    const key = generateKey();
    const big = Buffer.alloc(1024 * 1024, "A");
    const blob = encrypt(big, key);
    const decrypted = decrypt(blob, key);
    expect(decrypted.equals(big)).toBe(true);
  });

  it("handles empty plaintexts", () => {
    const key = generateKey();
    const empty = Buffer.alloc(0);
    const blob = encrypt(empty, key);
    const decrypted = decrypt(blob, key);
    expect(decrypted.length).toBe(0);
  });
});
