import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fingerprint,
  fingerprintWords,
  formatFingerprint,
  formatKey,
  generateKey,
  InvalidKeyError,
  parseKey,
} from "../src/key.js";
import { WORDS } from "../src/words.js";

describe("key", () => {
  it("generates 32-byte keys", () => {
    const key = generateKey();
    expect(key.length).toBe(32);
  });

  it("generates different keys each time", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a.equals(b)).toBe(false);
  });

  it("formats keys with the envlope_key_ prefix", () => {
    const key = generateKey();
    const formatted = formatKey(key);
    expect(formatted.startsWith("envlope_key_")).toBe(true);
  });

  it("round-trips format → parse", () => {
    const key = generateKey();
    const formatted = formatKey(key);
    const parsed = parseKey(formatted);
    expect(parsed.equals(key)).toBe(true);
  });

  it("tolerates surrounding whitespace when parsing", () => {
    const key = generateKey();
    const formatted = `  ${formatKey(key)}\n`;
    const parsed = parseKey(formatted);
    expect(parsed.equals(key)).toBe(true);
  });

  it("rejects keys without the prefix", () => {
    expect(() => parseKey("not-a-key")).toThrow(InvalidKeyError);
  });

  it("rejects keys with wrong byte length after decode", () => {
    const short = "envlope_key_" + Buffer.alloc(8).toString("base64");
    expect(() => parseKey(short)).toThrow(/8 bytes/);
  });
});

describe("fingerprint", () => {
  it("is 8 hex characters, stable for the same key and different for another", () => {
    const key = generateKey();
    expect(fingerprint(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint(Buffer.from(key))).toBe(fingerprint(key));
    expect(fingerprint(generateKey())).not.toBe(fingerprint(key));
  });

  it("is domain-separated, not a bare SHA-256 of the key", () => {
    const key = Buffer.alloc(32, 42);
    const bare = createHash("sha256").update(key).digest("hex").slice(0, 8);
    expect(fingerprint(key)).not.toBe(bare);
  });

  it("formats as two groups of four for reading aloud", () => {
    expect(formatFingerprint("a3f907c2")).toBe("a3f9·07c2");
  });
});

describe("fingerprintWords", () => {
  it("draws on 256 distinct, short, plain words, one per byte value", () => {
    expect(WORDS).toHaveLength(256);
    expect(new Set(WORDS).size).toBe(256);
    for (const word of WORDS) expect(word).toMatch(/^[a-z]{3,8}$/);
  });

  it("turns the fingerprint's first three bytes into three words", () => {
    expect(fingerprintWords("a3f907c2")).toBe(`${WORDS[0xa3]}-${WORDS[0xf9]}-${WORDS[0x07]}`);
    expect(fingerprintWords("a3f907c2")).toBe("opal-willow-aspen");
    expect(fingerprintWords("000000ff")).toBe("acorn-acorn-acorn");
  });

  it("is the same for the same key and differs for another", () => {
    const key = generateKey();
    const words = fingerprintWords(fingerprint(key));
    expect(fingerprintWords(fingerprint(Buffer.from(key)))).toBe(words);
    expect(fingerprintWords(fingerprint(Buffer.alloc(32, 1)))).not.toBe(
      fingerprintWords(fingerprint(Buffer.alloc(32, 2))),
    );
  });
});
