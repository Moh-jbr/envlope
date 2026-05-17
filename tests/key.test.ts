import { describe, expect, it } from "vitest";
import { formatKey, generateKey, InvalidKeyError, parseKey } from "../src/key.js";

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
