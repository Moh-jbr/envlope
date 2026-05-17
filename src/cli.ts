import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import updateNotifier from "update-notifier";

import { decryptCommand } from "./commands/decrypt.js";
import { encryptCommand } from "./commands/encrypt.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { viewCommand } from "./commands/view.js";
import { Output } from "./output.js";

// Read version + name from package.json (one dir up from dist/cli.js or src/cli.ts).
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as {
  name: string;
  version: string;
};

// Update notifier — runs version check in a detached background process; the
// foreground CLI just reads the cached result. Suppress in --json mode so it
// doesn't corrupt structured output.
const isJsonMode = process.argv.includes("--json");
if (!isJsonMode) {
  try {
    const notifier = updateNotifier({
      pkg,
      updateCheckInterval: 1000 * 60 * 60 * 24, // 24h
    });
    notifier.notify({
      defer: false,
      message:
        "Update available: {currentVersion} → {latestVersion}\n" +
        "Run `npm i envlope@latest` (add `-g` if installed globally) to update.",
    });
  } catch {
    // Silently ignore notifier errors (offline, restricted network, etc.).
  }
}

const program = new Command();

program
  .name("envlope")
  .description(
    "Encrypt your .env file with a key, push it to git safely, unlock with the same key.",
  )
  .version(pkg.version);

program
  .command("init [file]")
  .description("Generate a key (or use a provided one) and encrypt the env file in this directory.")
  .option("-y, --yes", "Skip the re-init confirmation prompt (use in scripts/CI)")
  .option(
    "-k, --key <key>",
    "Use this key instead of generating a new random one (for reusing one key across multiple repos)",
  )
  .option("--json", "Emit JSON output instead of human-readable text")
  .action(async (file, options) => {
    process.exit(
      await runWithErrorHandling(() => initCommand({ ...options, file }), options),
    );
  });

program
  .command("encrypt [file]")
  .description("Re-encrypt the env file using your existing key.")
  .option(
    "-k, --key <key>",
    "The envlope key (otherwise read from ENVLOPE_KEY env var or prompted)",
  )
  .option("--json", "Emit JSON output instead of human-readable text")
  .action(async (file, options) => {
    process.exit(
      await runWithErrorHandling(() => encryptCommand({ ...options, file }), options),
    );
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
  .action(async (file, options) => {
    process.exit(
      await runWithErrorHandling(() => decryptCommand({ ...options, file }), options),
    );
  });

program
  .command("status [file]")
  .description("Show the health of the env file: sync state, gitignore, last encrypted.")
  .option("--json", "Emit JSON output instead of human-readable text")
  .option("--strict", "Exit code 1 if the env file is out of sync with the encrypted file")
  .action(async (file, options) => {
    process.exit(
      await runWithErrorHandling(() => statusCommand({ ...options, file }), options),
    );
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
    process.exit(
      await runWithErrorHandling(
        () => viewCommand(variable, { ...options, file }),
        options,
      ),
    );
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
