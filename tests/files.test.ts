import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeEnvFile } from "../src/files.js";

describe("normalizeEnvFile", () => {
  const cwd = resolve("some-project");

  it("turns ./x, .\\x and absolute paths inside cwd into a clean relative path", () => {
    expect(normalizeEnvFile("./.env.production", cwd)).toBe(".env.production");
    expect(normalizeEnvFile(`.${sep}config${sep}.env`, cwd)).toBe("config/.env");
    expect(normalizeEnvFile(join(cwd, ".env"), cwd)).toBe(".env");
    expect(normalizeEnvFile(undefined, cwd)).toBe(".env");
  });

  it("refuses paths outside cwd, which its .gitignore can't protect", () => {
    expect(() => normalizeEnvFile("../.env", cwd)).toThrow(/outside the current folder/);
    expect(() => normalizeEnvFile(resolve(cwd, "..", "other", ".env"), cwd)).toThrow(/outside/);
  });

  it("keeps a name that merely starts with two dots", () => {
    expect(normalizeEnvFile("..env", cwd)).toBe("..env");
  });
});
