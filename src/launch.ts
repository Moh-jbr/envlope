import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { constants } from "node:os";
import { delimiter, extname, isAbsolute, join, resolve } from "node:path";

/** A variable's value, matched the way the OS does: case-insensitively on Windows. */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  if (process.platform !== "win32") return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Windows only: the file a command refers to, trying PATHEXT's extensions. Only
 * absolute PATH entries are searched, never the current folder, so a program
 * planted in a project can't stand in for a real one.
 */
export function findWindowsProgram(
  command: string,
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
): string | null {
  const extensions = (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const names = [...(extname(command) ? [command] : []), ...extensions.map((ext) => command + ext)];
  const dirs = /[\\/]/.test(command)
    ? [cwd]
    : (envValue(env, "PATH") ?? "")
        .split(delimiter)
        .map((dir) => dir.replace(/^"(.*)"$/, "$1"))
        .filter((dir) => isAbsolute(dir));

  for (const dir of dirs) {
    for (const name of names) {
      const path = resolve(dir, name);
      if (existsSync(path) && statSync(path).isFile()) return path;
    }
  }
  return null;
}

// cmd.exe's special characters; https://qntm.org/cmd explains how it reads a line.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * One argument for a batch file (.cmd/.bat), which only runs through cmd.exe: quoted
 * the way the C runtime splits arguments, then caret-escaped twice, because cmd.exe
 * reads the line once and the batch file's %* reads it again.
 */
function quoteForBatch(arg: string): string {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(CMD_META, "^^^$1");
}

class NotFound extends Error {}

/** Start a command with this terminal's input and output, the same way on every OS. */
function start(command: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  if (process.platform !== "win32") {
    return spawn(command, args, { stdio: "inherit", env });
  }

  const program = findWindowsProgram(command, env);
  if (!program) throw new NotFound();
  if (!/\.(cmd|bat)$/i.test(program)) {
    return spawn(program, args, { stdio: "inherit", env });
  }

  // Node won't start batch files itself, so hand cmd.exe a line it reads back exactly.
  const line = [program.replace(CMD_META, "^$1"), ...args.map(quoteForBatch)].join(" ");
  const shell =
    envValue(env, "ComSpec") ??
    join(envValue(env, "SystemRoot") ?? "C:\\Windows", "System32", "cmd.exe");
  return spawn(shell, ["/d", "/s", "/c", `"${line}"`], {
    stdio: "inherit",
    env,
    windowsVerbatimArguments: true,
  });
}

export type LaunchResult =
  | { status: "exited"; code: number }
  | { status: "not-found" }
  | { status: "failed"; error: Error };

/**
 * Run a command to completion. Ctrl-C reaches the command directly, since it shares
 * the terminal, so envlope just keeps waiting for it to exit; a stop request sent to
 * envlope alone is passed on. A command killed by a signal exits with 128 + its
 * number, as in a shell.
 */
export function launch(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<LaunchResult> {
  return new Promise((done) => {
    let child: ChildProcess;
    try {
      child = start(command, args, env);
    } catch (err) {
      done(
        err instanceof NotFound
          ? { status: "not-found" }
          : { status: "failed", error: err as Error },
      );
      return;
    }

    const handlers: [NodeJS.Signals, () => void][] = [
      ["SIGINT", () => {}],
      ["SIGTERM", () => child.kill("SIGTERM")],
      ["SIGHUP", () => child.kill("SIGHUP")],
    ];
    for (const [signal, handler] of handlers) process.on(signal, handler);

    let settled = false;
    const settle = (result: LaunchResult) => {
      if (settled) return;
      settled = true;
      for (const [signal, handler] of handlers) process.off(signal, handler);
      done(result);
    };
    child.on("error", (err: NodeJS.ErrnoException) =>
      settle(err.code === "ENOENT" ? { status: "not-found" } : { status: "failed", error: err }),
    );
    child.on("exit", (code, signal) =>
      settle({ status: "exited", code: code ?? 128 + (signal ? constants.signals[signal] : 0) }),
    );
  });
}
