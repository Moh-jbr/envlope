import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decryptAll, encryptAll, initAll, keyAll, statusAll } from "./all.js";
import { decryptCommand } from "./commands/decrypt.js";
import { encryptCommand } from "./commands/encrypt.js";
import { initCommand } from "./commands/init.js";
import { keyCommand } from "./commands/key.js";
import { runCommand } from "./commands/run.js";
import { statusCommand } from "./commands/status.js";
import { viewCommand } from "./commands/view.js";
import { Output } from "./output.js";

// Read version + name from package.json (one dir up from dist/cli.js or src/cli.ts).
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  name: string;
  version: string;
};

// Everything after `--` belongs to the command `envlope run` starts, not to envlope.
const args = process.argv.slice(2);
const dashDash = args.indexOf("--");
const isJsonMode = (dashDash === -1 ? args : args.slice(0, dashDash)).includes("--json");

/**
 * Show update-notifier's "update available" box after the command's own output.
 * It runs its version check in a detached background process and only ever prints
 * to an interactive terminal — and importing it costs ~150ms — so it's loaded only
 * then. Piped or redirected output and --json never pay for it.
 */
async function notifyIfUpdateAvailable(): Promise<void> {
  if (isJsonMode || !process.stdout.isTTY || "NO_UPDATE_NOTIFIER" in process.env) return;
  try {
    const { default: updateNotifier } = await import("update-notifier");
    updateNotifier({
      pkg,
      updateCheckInterval: 1000 * 60 * 60 * 24, // 24h
    }).notify({
      defer: false,
      message:
        "Update available: {currentVersion} → {latestVersion}\n" +
        "Run `npm i envlope@latest` (add `-g` if installed globally) to update.",
    });
  } catch {
    // Silently ignore notifier errors (offline, restricted network, etc.).
  }
}

async function finish(code: number, { notify = true } = {}): Promise<never> {
  if (notify) await notifyIfUpdateAvailable();
  process.exit(code);
}

/**
 * The command to run: the --all version when asked for. --only narrows --all, so on
 * its own it's an error rather than silently ignored.
 */
function pick(
  options: { all?: boolean; only?: string; json?: boolean },
  one: () => Promise<number>,
  all: () => Promise<number>,
): () => Promise<number> {
  return async () => {
    if (options.only !== undefined && !options.all) {
      new Output(options.json).fail('--only works with --all, like: --all --only "*-back"');
      return 1;
    }
    return options.all ? all() : one();
  };
}

const ONLY = [
  "--only <patterns>",
  'With --all: only repos whose folder names match, like "*-back" or "api-*,!api-old" (comma-separated, * wildcard, ! leaves out)',
] as const;

const program = new Command();

program
  .name("envlope")
  .description(
    "Encrypt your .env file with a key, push it to git safely, unlock with the same key.",
  )
  .version(pkg.version)
  // Lets `run` pass its command's own options through untouched.
  .enablePositionalOptions();

program
  .command("init [file]")
  .description("Generate a key (or use a provided one) and encrypt the env file in this directory.")
  .option("-y, --yes", "Skip the re-init confirmation prompt (use in scripts/CI)")
  .option(
    "-k, --key <key>",
    "Use this key instead of generating a new random one (for reusing one key across multiple repos)",
  )
  .option("--json", "Emit JSON output instead of human-readable text")
  .option(
    "--all",
    "Set up every git repo in this folder; in a terminal, asks whether they share one key or which repos get which key",
  )
  .option(...ONLY)
  .action(async (file, options) => {
    const command = pick(
      options,
      () => initCommand({ ...options, file }),
      () => initAll({ ...options, file }),
    );
    await finish(await runWithErrorHandling(command, options));
  });

program
  .command("encrypt [file]")
  .description("Re-encrypt the env file using your existing key.")
  .option(
    "-k, --key <key>",
    "The envlope key (otherwise read from ENVLOPE_KEY env var or prompted)",
  )
  .option(
    "--force",
    "Encrypt even if the encrypted file changed since your env file was made, replacing that version",
  )
  .option("--json", "Emit JSON output instead of human-readable text")
  .option(
    "--all",
    "Re-encrypt in every git repo in this folder, trying more keys if one isn't enough",
  )
  .option(...ONLY)
  .action(async (file, options) => {
    const command = pick(
      options,
      () => encryptCommand({ ...options, file }),
      () => encryptAll({ ...options, file }),
    );
    await finish(await runWithErrorHandling(command, options));
  });

program
  .command("decrypt [file]")
  .description("Decrypt the encrypted env file using your key.")
  .option(
    "-k, --key <key>",
    "The envlope key (otherwise read from ENVLOPE_KEY env var or prompted)",
  )
  .option("-y, --yes", "Overwrite an existing decrypted file without prompting")
  .option("--json", "Emit JSON output instead of human-readable text")
  .option("--all", "Decrypt in every git repo in this folder, trying more keys if one isn't enough")
  .option(...ONLY)
  .action(async (file, options) => {
    const command = pick(
      options,
      () => decryptCommand({ ...options, file }),
      () => decryptAll({ ...options, file }),
    );
    await finish(await runWithErrorHandling(command, options));
  });

program
  .command("status [file]")
  .description("Show the health of the env file: sync state, gitignore, last encrypted.")
  .option("--json", "Emit JSON output instead of human-readable text")
  .option("--strict", "Exit code 1 if the env file is out of sync with the encrypted file")
  .option("--all", "Check every git repo in this folder")
  .option(...ONLY)
  .action(async (file, options) => {
    const command = pick(
      options,
      () => statusCommand({ ...options, file }),
      () => statusAll({ ...options, file }),
    );
    await finish(await runWithErrorHandling(command, options));
  });

program
  .command("view <variable> [file]")
  .description(
    "Print the decrypted value of a single variable to stdout without writing the env file to disk.",
  )
  .option(
    "-k, --key <key>",
    "The envlope key (otherwise read from ENVLOPE_KEY env var or prompted)",
  )
  .option("--json", "Emit JSON output instead of human-readable text")
  .action(async (variable, file, options) => {
    await finish(
      await runWithErrorHandling(
        () => viewCommand(variable, { ...options, file }),
        options,
      ),
    );
  });

program
  .command("run")
  .description(
    "Run a command with the decrypted variables in its environment, without writing the env file to disk.",
  )
  .argument("<command...>", "The command to run, e.g. npm start")
  .option("-f, --file <file>", "The env file to use (default: .env)")
  .option(
    "-k, --key <key>",
    "The envlope key (otherwise read from ENVLOPE_KEY env var or prompted)",
  )
  .option(
    "--override",
    "Let the env file's values replace variables already set in your environment",
  )
  .passThroughOptions()
  .action(async (command: string[], options) => {
    // The update notice would land after the command's own output, so skip it here.
    await finish(await runWithErrorHandling(() => runCommand(command, options), options), {
      notify: false,
    });
  });

program
  .command("key")
  .description(
    "Show your key's fingerprint, as words to compare out loud, and which encrypted files here it opens.",
  )
  .option(
    "-k, --key <key>",
    "The envlope key (otherwise read from ENVLOPE_KEY env var or prompted)",
  )
  .option("--json", "Emit JSON output instead of human-readable text")
  .option(
    "--all",
    "Show which git repos in this folder the key opens, and try more keys on the rest",
  )
  .option(...ONLY)
  .option(
    "-f, --file <file>",
    "With --all: the env file whose encrypted copy to check (default: .env)",
  )
  .action(async (options) => {
    const command = pick(
      options,
      () => keyCommand(options),
      () => keyAll(options),
    );
    await finish(await runWithErrorHandling(command, options));
  });

program.parseAsync().catch((err) => {
  const out = new Output(isJsonMode);
  out.fail(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

async function runWithErrorHandling(
  fn: () => Promise<number>,
  options: { json?: boolean } = {},
): Promise<number> {
  try {
    return await fn();
  } catch (err) {
    const out = new Output(options.json);
    out.fail(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
