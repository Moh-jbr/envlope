import { describe, expect, it } from "vitest";
import { diffEnv, parseEnv } from "../src/parse.js";

describe("parseEnv", () => {
  it("parses plain KEY=VALUE lines, keeping '=' inside values", () => {
    const vars = parseEnv("A=1\nQUERY=name=value&other=thing\n");
    expect(vars.get("A")).toBe("1");
    expect(vars.get("QUERY")).toBe("name=value&other=thing");
  });

  it("skips comments, blank lines and lines without an assignment", () => {
    const vars = parseEnv("# comment\n\n   \nNOT AN ASSIGNMENT\nA=1\n");
    expect([...vars.keys()]).toEqual(["A"]);
  });

  it("accepts an `export` prefix and whitespace around the name and value", () => {
    const vars = parseEnv("export A=1\n  B  =  spaced  \n");
    expect(vars.get("A")).toBe("1");
    expect(vars.get("B")).toBe("spaced");
  });

  it("strips inline comments from unquoted values", () => {
    expect(parseEnv("A=plain # note\n").get("A")).toBe("plain");
  });

  it("unwraps single, double and backtick quotes, keeping '#' inside them", () => {
    const vars = parseEnv("A='one # two'\nB=\"three # four\"\nC=`five`\n");
    expect(vars.get("A")).toBe("one # two");
    expect(vars.get("B")).toBe("three # four");
    expect(vars.get("C")).toBe("five");
  });

  it("expands \\n and \\r inside double quotes only", () => {
    const vars = parseEnv("A=\"line1\\nline2\"\nB='line1\\nline2'\n");
    expect(vars.get("A")).toBe("line1\nline2");
    expect(vars.get("B")).toBe("line1\\nline2");
  });

  it("supports quoted values spanning multiple lines", () => {
    const vars = parseEnv('KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1\n');
    expect(vars.get("KEY")).toBe("-----BEGIN-----\nabc\n-----END-----");
    expect(vars.get("NEXT")).toBe("1");
  });

  it("keeps an unterminated quote as a literal character", () => {
    expect(parseEnv('A="unterminated\n').get("A")).toBe('"unterminated');
  });

  it("lets the last definition of a name win", () => {
    expect(parseEnv("A=first\nA=second\n").get("A")).toBe("second");
  });

  it("handles empty values and CRLF line endings", () => {
    const vars = parseEnv("EMPTY=\r\nA=1\r\n");
    expect(vars.get("EMPTY")).toBe("");
    expect(vars.get("A")).toBe("1");
  });
});

describe("diffEnv", () => {
  it("reports added, changed and removed names in file order", () => {
    const before = parseEnv("A=1\nB=2\nC=3\nD=4\n");
    const after = parseEnv("B=2\nC=changed\nE=5\nA=1\nF=6\n");
    expect(diffEnv(before, after)).toEqual({ added: ["E", "F"], changed: ["C"], removed: ["D"] });
  });

  it("compares parsed values, so quoting or comments alone are not a change", () => {
    const before = parseEnv("A=1\nB=two\n");
    const after = parseEnv('# a comment\nA="1"\nB=two # inline\n');
    expect(diffEnv(before, after)).toEqual({ added: [], changed: [], removed: [] });
  });
});

describe("parseEnv with a byte-order mark", () => {
  it("still reads the first variable (Windows editors often save a BOM)", () => {
    const vars = parseEnv("\uFEFFFIRST=1\nSECOND=2\n");
    expect(vars.get("FIRST")).toBe("1");
    expect([...vars.keys()]).toEqual(["FIRST", "SECOND"]);
  });
});

describe("parseEnv where dotenv's rules are subtle", () => {
  it("doesn't let an unclosed quote swallow the lines below it", () => {
    const vars = parseEnv(
      'GREETING="Hello\nDB_PASSWORD=hunter2\nAPI_URL="https://api.example.com"\n',
    );
    expect(vars.get("GREETING")).toBe('"Hello');
    expect(vars.get("DB_PASSWORD")).toBe("hunter2");
    expect(vars.get("API_URL")).toBe("https://api.example.com");
  });

  it("only treats a quoted value as quoted when nothing but a comment follows it", () => {
    const vars = parseEnv('A="x" # note\nB="x" trailing\n');
    expect(vars.get("A")).toBe("x");
    expect(vars.get("B")).toBe('"x" trailing');
  });

  it("accepts NAME: value, but not NAME:value", () => {
    const vars = parseEnv("API_KEY: remote-key\nNO_SPACE:value\n");
    expect(vars.get("API_KEY")).toBe("remote-key");
    expect(vars.has("NO_SPACE")).toBe(false);
  });
});
