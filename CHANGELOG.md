# Changelog

All notable changes to `envlope` are documented here. This project follows [Semantic Versioning](https://semver.org/) and the [Keep a Changelog](https://keepachangelog.com/) format.

## [0.2.0] — 2026-10-17

### Added

- **`--all` runs a command in every git repo in the folder**, for `init`, `encrypt`, `decrypt`, `status` and `key`. Each repo gets a row as it's done, then the totals; folders without a `.git` are left alone. `--only "*-back,!legacy-*"` narrows the run by folder name.
  - `init --all` asks, in a terminal, whether the repos share one key or which repos get which key: how many keys, then each key's repos, suggested from the folder names (`*-back`), matched by a pattern you type, or ticked in a scrolling list. Each key can be new, the one in `ENVLOPE_KEY`, or pasted. It confirms the plan before writing, then shows each new key once with the repos it opens. Repos that already have an encrypted file are only re-encrypted when you say so or pass `--yes`, and never when the chosen key already opens them. Without a terminal it uses one new key, or `--key`.
  - `decrypt --all`, `encrypt --all` and `key --all` set aside the repos your key doesn't open, and in a terminal offer to try another key on them, so one run covers repos with different keys. Questions are asked once the run is done: whether to overwrite local changes (keep, review one by one, or overwrite all), and how to handle repos where a newer encrypted file arrived (merge one by one, or leave). Without a terminal those repos make the exit code 1; `--yes` and `--force` work as for one repo.
  - `--json` returns one object with every repo's status, detail, warnings and the command's own result, a summary, and for `init --all` the keys.
- `init` offers, in a terminal, to use the key already in `ENVLOPE_KEY` instead of generating a new one, so a new repo can join the key your other repos use. `--json` output adds `variables`, the number of variables encrypted.
- `status` flags other plaintext env files next to yours, such as `.env.bak` or `.env.pre-tunnel`, when git tracks them or could commit them. `--json` adds `other_env_files` and `issues` (each problem with its `check`, `detail` and `fix`).
- `--json` errors carry a `reason` where a script might act on it (`no_env`, `not_set_up`, `wrong_key`, `unreadable`, `already_set_up`, `local_changes`, `newer_version`), and results carry `warnings` for risks like a plaintext file git tracks.
- **`envlope run -- <command>`** runs a command with the decrypted variables in its environment, decrypting in memory so no plaintext file is written. Variables already set in your environment win unless you pass `--override`, `ENVLOPE_KEY` is removed from the command's environment, and the command's exit code is passed through. It works with Windows `.cmd` launchers such as `npm` and `npx`, with arguments passed through exactly.
- **A conflict guard for `encrypt`.** envlope remembers which version of `<file>.encrypted` your env file came from, keeping it inside `.git` in encrypted form. If a teammate's newer version has arrived since, `encrypt` shows what each side changed by name, then in a terminal offers to merge, overwrite or cancel. Without a terminal it refuses unless you pass `--force`. `status` flags it too, and `status --json` adds `behind`.
- **Word fingerprints and `envlope key`.** Fingerprints now also come as three easy words, like `crystal-castle-bison`, for comparing keys out loud. `envlope key` shows your key's words, its hex fingerprint, where it came from, and which encrypted files here it opens. `--json` outputs that include `fingerprint` now include `fingerprint_words` too.
- **Key fingerprints.** `init` shows the new key in a card together with its fingerprint (8 hex characters, e.g. `3723·1317`), and `encrypt`, `decrypt` and `view` print the fingerprint of the key they used. Teammates can compare fingerprints to confirm they hold the same key without sharing it. `--json` output includes `fingerprint`.
- `encrypt` lists the variables you added, changed or removed, by name only. `--json` output includes them as `variables`.
- `decrypt` compares an existing plaintext file with the decrypted content before overwriting it. If they match, it does nothing. If not, it lists which variables would be replaced, removed or added before asking, and names them in the error when it can't ask.
- `status` is now a checklist: each check gets a row, each problem shows the command or edit that fixes it, and a count of problems closes the report. It names the ignore rule that protects the plaintext file and checks that the encrypted file isn't ignored. Ignore rules are checked with `git check-ignore`, so parent `.gitignore` files, `.git/info/exclude` and global excludes count. `--json` output adds `problems`, `gitignore_rule` and `encrypted_committable`.
- `view` labels the value with its name, length and source when printing to an interactive terminal; piped output is still the bare value. When a name isn't found, it suggests the closest one and lists the available names on stderr.
- **Tracked-file warnings.** `status`, `init` and `decrypt` now flag a plaintext env file that git already tracks. No `.gitignore` rule stops a tracked file from being committed, so they tell you to run `git rm --cached <file>` and to treat the values already in history as exposed. `status --json` adds `tracked`.

### Changed

- **Every command starts about 160 ms faster.** update-notifier (~150 ms to import) is now loaded only when output goes to an interactive terminal, after the command's output, and @clack/prompts only when a prompt is shown. Runs whose output is piped or redirected (as in most scripts and CI) and `--json` runs never load update-notifier. The update notice now appears after the command's output instead of before it.
- `status` output has a new layout (see Added). The `--json` fields from 0.1.0 are unchanged, except that `gitignored` now reflects every ignore source git uses, and is `false` for a file git tracks.
- Env files outside the current folder are refused, because that folder's `.gitignore` can't protect them. Run envlope from the folder that contains the file.
- **`view` output can differ from 0.1.0.** Values are now parsed with the same rules as `dotenv`, so `view` prints what your app actually loads: `export` prefixes and `NAME: value` lines are accepted, surrounding quotes are removed (quoted values may span lines, and `\n` inside double quotes becomes a newline), unquoted values are trimmed and end at `#`, and the last definition of a repeated name wins. 0.1.0 returned everything after the first `=` verbatim. If a script relied on that, check values that are quoted, have trailing spaces, or contain an unquoted `#` (`PASS=abc#123` now prints `abc`, which is also what dotenv loads; quote it as `PASS="abc#123"` to keep the `#`).
- The package now ships only the ESM CLI. The unused CommonJS build and the `main`/`module` fields are removed: they made `require("envlope")` run the CLI, and the CommonJS bundle crashed with `ERR_REQUIRE_ESM` on Node versions that can't `require()` ES modules, such as Node 18. The `envlope` command itself always used the ESM build and is unaffected.

### Fixed

- `status` no longer reports drift (and `--strict` no longer exits 1) right after `decrypt` in a fresh clone. `decrypt` now moves the ciphertext's modification time up to the new plaintext file's, leaving the plaintext's own time alone for build tools that rely on it.
- **File arguments written as `./.env.production`, or `.\.env.production` (PowerShell tab completion), no longer produce `.gitignore` rules that match nothing.** Before, such a call could leave the plaintext file unprotected. Names are now normalized, and wildcard characters in file names are escaped in the rules envlope writes.
- `init` and `decrypt` now understand `.gitignore` patterns such as `.env*` instead of matching exact lines. When such a rule would also hide `<file>.encrypted`, a `!<file>.encrypted` exception is added so `git add` works (previously it failed with "paths are ignored"). `status` reports these files as protected.
- `encrypt` leaves `<file>.encrypted` untouched when the plaintext hasn't changed, instead of rewriting it with a new IV and producing a meaningless git diff. JSON output now includes `changed`.
- `view` no longer reports `export NAME=value` lines as missing, or returns a repeated name's first value when dotenv uses the last (see **Changed** above).
- Re-running `init`, or `decrypt` over an existing file, without `--yes` in a non-interactive shell now fails with a clear "pass --yes" message instead of `TTY initialization failed`.
- `init --key` validates the key before backing up the existing ciphertext, so an invalid key no longer overwrites `<file>.encrypted.bak`.

## [0.1.0] — 2026-05-17

Initial release.

### Core

- AES-256-GCM symmetric encryption with random 256-bit keys (`envlope_key_<base64>` format).
- Single-line ciphertext file: `envlope:1:<base64(iv || ciphertext || tag)>`. Safe to commit to git.
- Automatic `.gitignore` management so plaintext env files never accidentally leak into commits.

### Commands

- `envlope init [file]` — generate a fresh key (or accept one via `--key`) and encrypt the env file. Backs up any existing `<file>.encrypted` to `<file>.encrypted.bak` before replacing it. Includes a re-init confirmation flow with `--yes` bypass for scripts.
- `envlope encrypt [file]` — re-encrypt the env file using an existing key. Refuses keys that don't match the current ciphertext, so accidental key rotation can't happen here.
- `envlope decrypt [file]` — decrypt the encrypted env file. Prompts before overwriting an existing plaintext file unless `--yes` is passed.
- `envlope status [file]` — health check showing whether `.env` and `.env.encrypted` are in sync, when the ciphertext was last updated, and whether `.gitignore` protects the plaintext. `--strict` exits with code 1 on drift (good for CI).
- `envlope view <VARIABLE> [file]` — print a single decrypted variable's value to stdout without ever writing the plaintext env to disk. Perfect for shell scripts that need exactly one secret.

### Workflow

- **Multi-file support** — every command accepts an optional positional filename argument. `envlope init .env.production`, `envlope encrypt .env.staging`, etc.
- **`init --key <key>`** — reuse an existing key when bootstrapping a new repo, so teams managing many `.env` files only need one shared key in their password manager.
- **`ENVLOPE_KEY` environment variable** — set the key once via env var and every command picks it up automatically. Priority is `--key flag → ENVLOPE_KEY env → interactive prompt`.

### Output

- **`--json` mode on every command** — suppresses human-readable output and emits a single structured JSON object to stdout. Errors emit `{"error": "...", "code": 1}`. Designed for scripting and CI pipelines.
- **Update notifier** — gently informs you when a new version of envlope is available, suppressed in `--json` mode.
