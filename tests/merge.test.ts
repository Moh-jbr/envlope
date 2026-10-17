import { describe, expect, it } from "vitest";
import { mergeEnv } from "../src/merge.js";
import { parseEnv } from "../src/parse.js";

const BASE = "# team settings\nDATABASE_URL=postgres://base\nAPI_KEY=base-key\nDEBUG=false\n";

describe("mergeEnv", () => {
  it("combines changes to different variables, keeping their file's layout", () => {
    const theirs =
      "# team settings\nDATABASE_URL=postgres://base\nAPI_KEY=their-key\nDEBUG=false\nSENTRY_DSN=https://sentry\n";
    const yours = "# team settings\nDATABASE_URL=postgres://mine\nAPI_KEY=base-key\nDEBUG=false\n";
    const merge = mergeEnv(BASE, theirs, yours);

    expect(merge.conflicts).toEqual([]);
    expect(merge.theirs).toEqual({ added: ["SENTRY_DSN"], changed: ["API_KEY"], removed: [] });
    expect(merge.yours).toEqual({ added: [], changed: ["DATABASE_URL"], removed: [] });
    expect(merge.text).toBe(
      "# team settings\nDATABASE_URL=postgres://mine\nAPI_KEY=their-key\nDEBUG=false\nSENTRY_DSN=https://sentry\n",
    );
    expect(merge.dropsOtherEdits).toBe(false);
  });

  it("refuses to merge a variable both sides changed differently", () => {
    const merge = mergeEnv(
      BASE,
      BASE.replace("base-key", "theirs"),
      BASE.replace("base-key", "mine"),
    );
    expect(merge.conflicts).toEqual(["API_KEY"]);
    expect(merge.text).toBeNull();
  });

  it("isn't a conflict when both sides made the same change", () => {
    const same = BASE.replace("base-key", "same");
    const merge = mergeEnv(BASE, same, same);
    expect(merge.conflicts).toEqual([]);
    expect(merge.text).toBe(same);
  });

  it("carries your additions and removals over, exactly as written", () => {
    const cert = 'export CERT="-----BEGIN-----\nabc\n-----END-----" # pem';
    const yours = `# team settings\nDATABASE_URL=postgres://base\nAPI_KEY=base-key\n${cert}\n`;
    const merge = mergeEnv(BASE, BASE.replace("base-key", "their-key"), yours);

    expect(merge.yours).toEqual({ added: ["CERT"], changed: [], removed: ["DEBUG"] });
    expect(merge.text).toBe(
      `# team settings\nDATABASE_URL=postgres://base\nAPI_KEY=their-key\n${cert}\n`,
    );
    expect(parseEnv(merge.text!).get("CERT")).toBe("-----BEGIN-----\nabc\n-----END-----");
  });

  it("treats a variable you removed and they changed as a conflict", () => {
    const yours = BASE.replace("DEBUG=false\n", "");
    const merge = mergeEnv(BASE, BASE.replace("DEBUG=false", "DEBUG=true"), yours);
    expect(merge.conflicts).toEqual(["DEBUG"]);
    expect(merge.text).toBeNull();
  });

  it("removes every definition of a variable you deleted", () => {
    const theirs = "A=1\nGONE=old\nB=2\nGONE=newer\n";
    const merge = mergeEnv("A=1\nGONE=old\nB=2\nGONE=newer\n", theirs + "C=3\n", "A=1\nB=2\n");
    expect(merge.text).toBe("A=1\nB=2\nC=3\n");
    expect(parseEnv(merge.text!).has("GONE")).toBe(false);
  });

  it("replaces the definition that counts when their file repeats a name", () => {
    const base = "A=1\nB=first\nB=second\n";
    const merge = mergeEnv(base, `${base}C=3\n`, "A=1\nB=first\nB=mine\n");
    expect(merge.text).toBe("A=1\nB=first\nB=mine\nC=3\n");
    expect(parseEnv(merge.text!).get("B")).toBe("mine");
  });

  it("keeps their Windows line endings", () => {
    const merge = mergeEnv("A=1\r\nB=2\r\n", "A=1\r\nB=2\r\nC=3\r\n", "A=mine\r\nB=2\r\n");
    expect(merge.text).toBe("A=mine\r\nB=2\r\nC=3\r\n");
  });

  it("says when your file had edits besides variable changes, which don't merge", () => {
    const withComment = mergeEnv(BASE, BASE, BASE.replace("DEBUG=false", "DEBUG=true # temporary"));
    expect(withComment.dropsOtherEdits).toBe(false); // a comment on the same line travels with it

    const newComment = mergeEnv(
      BASE,
      BASE,
      `# my notes\n${BASE.replace("DEBUG=false", "DEBUG=true")}`,
    );
    expect(newComment.dropsOtherEdits).toBe(true);
  });
});
