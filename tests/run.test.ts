import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = resolve(process.cwd(), "src/cli.ts");
const TSX_CLI = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function run(
  dir: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): { code: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    NO_UPDATE_NOTIFIER: "1",
  };
  delete env.ENVLOPE_KEY;
  Object.assign(env, extraEnv);
  const result = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function extractKey(stdout: string): string {
  const match = stdout.match(/envlope_key_[A-Za-z0-9+/=]+/);
  if (!match) throw new Error(`No key found in output:\n${stdout}`);
  return match[0];
}

// A small program that reports what it received.
const REPORT = `console.log(JSON.stringify({ argv: process.argv.slice(2), env: process.env }))`;

describe("run command", () => {
  let project: string;
  let key: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "envlope-run-"));
    writeFileSync(
      join(project, ".env"),
      'API_URL=https://api.example.com\nGREETING="hello world"\n',
    );
    key = extractKey(run(project, ["init"]).stdout);
    rmSync(join(project, ".env"));
    writeFileSync(join(project, "report.js"), REPORT);
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  const report = (stdout: string) =>
    JSON.parse(stdout.trim().split(/\r?\n/).pop()!) as {
      argv: string[];
      env: Record<string, string>;
    };

  it("passes the decrypted variables to the command without writing .env", () => {
    const result = run(project, ["run", "--key", key, "--", "node", "report.js"]);
    expect(result.code).toBe(0);
    expect(report(result.stdout).env).toMatchObject({
      API_URL: "https://api.example.com",
      GREETING: "hello world",
    });
    expect(existsSync(join(project, ".env"))).toBe(false);
  });

  it("keeps variables you already set, unless --override is given", () => {
    const kept = run(project, ["run", "--key", key, "--", "node", "report.js"], {
      API_URL: "mine",
    });
    expect(report(kept.stdout).env.API_URL).toBe("mine");

    const replaced = run(project, ["run", "--override", "--key", key, "--", "node", "report.js"], {
      API_URL: "mine",
    });
    expect(report(replaced.stdout).env.API_URL).toBe("https://api.example.com");
  });

  it("doesn't hand ENVLOPE_KEY to the command", () => {
    const result = run(project, ["run", "--", "node", "report.js"], { ENVLOPE_KEY: key });
    expect(result.code).toBe(0);
    expect(report(result.stdout).env).not.toHaveProperty("ENVLOPE_KEY");
    expect(report(result.stdout).env.API_URL).toBe("https://api.example.com");
  });

  it("passes the command's own options through, -- included", () => {
    const result = run(project, [
      "run",
      "--key",
      key,
      "node",
      "report.js",
      "--port",
      "3000",
      "--",
      "-x",
    ]);
    expect(report(result.stdout).argv).toEqual(["--port", "3000", "--", "-x"]);
  });

  it("exits with the command's exit code", () => {
    const result = run(project, ["run", "--key", key, "--", "node", "-e", "process.exit(7)"]);
    expect(result.code).toBe(7);
  });

  it("reports a missing command with exit code 127", () => {
    const result = run(project, ["run", "--key", key, "--", "no-such-command-envlope-test"]);
    expect(result.code).toBe(127);
    expect(result.stderr).toMatch(/Command not found: no-such-command-envlope-test/);
  });

  it("doesn't start the command when the key is wrong", () => {
    const wrong = "envlope_key_" + Buffer.alloc(32, 1).toString("base64");
    const result = run(project, ["run", "--key", wrong, "--", "node", "-e", "console.log('ran')"]);
    expect(result.code).toBe(1);
    expect(result.stdout).not.toMatch(/ran/);
    expect(result.stderr).toMatch(/Invalid key/);
  });

  it("reads another env file with --file", () => {
    writeFileSync(join(project, ".env.staging"), "STAGE=staging\n");
    const stagingKey = extractKey(run(project, ["init", ".env.staging"]).stdout);
    const result = run(project, [
      "run",
      "--file",
      ".env.staging",
      "--key",
      stagingKey,
      "--",
      "node",
      "report.js",
    ]);
    expect(report(result.stdout).env.STAGE).toBe("staging");
  });

  it.runIf(process.platform === "win32")(
    "passes tricky arguments intact to a .cmd file (how npm, npx and friends are installed)",
    () => {
      // The pattern npm's cmd-shim writes for every installed command.
      writeFileSync(join(project, "echo-args.cmd"), '@node "%~dp0\\report.js" %*\r\n');
      const tricky = [
        "plain",
        "with space",
        "a&b",
        "x|y",
        "100%",
        "%PATH%",
        'say "hi"',
        "a^b",
        "!bang!",
        "<in>",
        "(paren)",
        "semi;colon",
        "comma,arg",
        "*glob*",
        "?q",
        "C:\\path with space\\",
        'back\\\\slash"quote',
        "",
        "café",
        "=eq",
        "--flag=a b",
        "&&echo injected",
      ];
      const viaPath = run(project, ["run", "--key", key, "--", "echo-args", ...tricky], {
        PATH: `${project}${delimiter}${process.env.PATH}`,
      });
      expect(report(viaPath.stdout).argv).toEqual(tricky);
      expect(report(viaPath.stdout).env.API_URL).toBe("https://api.example.com");

      const viaFile = run(project, ["run", "--key", key, "--", ".\\echo-args.cmd", ...tricky]);
      expect(report(viaFile.stdout).argv).toEqual(tricky);
    },
  );
});
