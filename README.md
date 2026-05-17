# envlope

[![npm version](https://img.shields.io/npm/v/envlope.svg?style=flat-square)](https://www.npmjs.com/package/envlope)
[![npm downloads](https://img.shields.io/npm/dm/envlope.svg?style=flat-square)](https://www.npmjs.com/package/envlope)
[![license](https://img.shields.io/npm/l/envlope.svg?style=flat-square)](./LICENSE)
[![node](https://img.shields.io/node/v/envlope.svg?style=flat-square)](https://nodejs.org)

> Encrypt your `.env` files with a key, push them to git safely, unlock with the same key.

No server. No accounts. No telemetry. Just a CLI that turns your `.env` into an AES-256-GCM ciphertext blob safe to commit alongside your code — and back again, with a key only your team knows.

---

## TL;DR

```bash
npx envlope init
```

That's it. The command encrypts `.env` → `.env.encrypted`, adds `.env` to `.gitignore`, and prints a key. Save the key. Commit the encrypted file. A teammate runs `npx envlope decrypt`, pastes the key, and they have your `.env`.

---

## Table of contents

- [Why envlope](#why-envlope)
- [How envlope compares](#how-envlope-compares)
- [Install](#install)
- [Quick start](#quick-start)
- [Commands](#commands)
  - [`envlope init`](#envlope-init)
  - [`envlope encrypt`](#envlope-encrypt)
  - [`envlope decrypt`](#envlope-decrypt)
  - [`envlope status`](#envlope-status)
  - [`envlope view`](#envlope-view)
- [Common workflows](#common-workflows)
  - [Sharing one key across multiple repos](#sharing-one-key-across-multiple-repos)
  - [Multiple env files (dev/staging/prod)](#multiple-env-files-devstagingprod)
  - [Using `ENVLOPE_KEY` for CI/scripts](#using-envlope_key-for-ciscripts)
  - [`--json` for automation](#--json-for-automation)
  - [Updating `.env` values](#updating-env-values)
  - [Rotating the key](#rotating-the-key)
  - [Recovering from a lost key](#recovering-from-a-lost-key)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [How it works (technical)](#how-it-works-technical)
- [Development](#development)
- [Changelog](#changelog)
- [License](#license)

---

## Why envlope

- **Zero infrastructure.** No vault, no service to pay for, no account to set up. The key lives wherever you put it.
- **Git-native.** The encrypted file is a single line of text. Diff-friendly, branch-friendly, PR-friendly.
- **Modern crypto.** AES-256-GCM with a fresh random IV per encryption. The ciphertext is computationally indistinguishable from random.
- **Designed for teams.** One shared key unlocks every repo your team uses. New teammate? Share one key, they're in.
- **CI-friendly.** `ENVLOPE_KEY` env var, `--json` output mode, and `--strict` exit codes mean it slots into pipelines cleanly.
- **Trivially auditable.** ~400 lines of TypeScript, four small dependencies, all of which you've seen before.

---

## How envlope compares

| Feature                          | **envlope**       | dotenvx            | sops               | git-crypt          |
| -------------------------------- | ------------------ | ------------------ | ------------------ | ------------------ |
| Setup time                       | seconds            | ~1 min             | ~5 min             | ~10 min            |
| Server required                  | No                 | No                 | No                 | No                 |
| Symmetric key                    | ✓                  | ✓                  | ✓                  | ✓                  |
| Asymmetric / multi-recipient     | ✗                  | ✓                  | ✓                  | ✓                  |
| Multi-file (`.env.staging` etc.) | ✓                  | ✓                  | ✓                  | ✓                  |
| CI integration                   | env var, `--json`  | ✓                  | ✓                  | ✗                  |
| Built-in status / drift checks   | ✓                  | ✗                  | ✗                  | ✗                  |
| Built-in update notifier         | ✓                  | ✗                  | ✗                  | ✗                  |
| Lines of code (rough)            | ~400               | ~10k               | ~50k               | ~5k                |
| Dependency footprint             | 4 deps             | 30+                | huge               | none (Go binary)   |

**Pick envlope when:** you want the minimum-viable encrypted-env workflow, you trust one shared key, your team is small-to-medium, and you value being able to audit the whole tool in 20 minutes.

**Pick something else when:** you need per-teammate keys (sops, dotenvx), enterprise compliance with audit logs (sops), or transparent file-level encryption inside git itself (git-crypt).

---

## Install

You have three options, ordered from least to most setup:

### 1. No install — use `npx` (recommended for occasional use)

```bash
npx envlope <command>
```

`npx` fetches envlope from npm the first time and caches it locally. Subsequent runs are instant. No global state, no `node_modules` clutter.

### 2. Global install — bare `envlope` command everywhere

```bash
npm install -g envlope
```

Now you can run `envlope <command>` in any directory without the `npx` prefix.

### 3. Project dev dependency

```bash
npm install --save-dev envlope
```

Use inside the project via `npx envlope` or add it to your `package.json` scripts:

```json
{
  "scripts": {
    "env:status": "envlope status",
    "env:encrypt": "envlope encrypt",
    "env:decrypt": "envlope decrypt"
  }
}
```

---

## Quick start

### Step 1 — encrypt your `.env`

In a project with a `.env` file you want to share with your team:

```bash
npx envlope init
```

Output:

```
✓ Encrypted .env → .env.encrypted
✓ Created .gitignore (added .env, .env.local, .env.encrypted.bak)

SAVE THIS KEY — it cannot be recovered:
────────────────────────────────────────────────────────────────
   envlope_key_IiE85vhkdQLrNxksL9JWrWYOPHW35+gmJX366q8bapU=
────────────────────────────────────────────────────────────────
Save it in your password manager and share with teammates over a secure channel.

Next:
  $ git add .env.encrypted .gitignore
  $ git commit -m "Add encrypted env"
```

### Step 2 — commit and push the encrypted file

```bash
git add .env.encrypted .gitignore
git commit -m "Add encrypted env"
git push
```

Your plaintext `.env` stays on your machine (it's gitignored automatically). Only `.env.encrypted` goes to the remote.

### Step 3 — your teammate clones and decrypts

```bash
git clone <your-repo>
cd <your-repo>
npx envlope decrypt
# Enter your envlope key: ****************************************
```

They paste the key (you sent it via 1Password, Signal, or another secure channel), and `.env` appears locally.

---

## Commands

Every command accepts an optional positional `[file]` argument (default: `.env`), and every command supports `--json` for structured output.

### `envlope init`

Encrypt an env file for the first time. Generates a fresh random key (or accepts an existing one via `--key`), writes `<file>.encrypted`, and ensures the plaintext file is in `.gitignore`.

```bash
# Generate a new random key
npx envlope init

# Reuse an existing key (multi-repo flow)
npx envlope init --key envlope_key_<paste-here>

# Init for a specific env file
npx envlope init .env.production

# Re-init without the confirmation prompt (for scripts / CI)
npx envlope init --yes

# JSON output for scripts
npx envlope init --json
```

**Options:**

| Flag              | Description                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `[file]`          | Positional. The env file to encrypt. Default: `.env`.                                                |
| `-k, --key <key>` | Use a specific key instead of generating a new one. Useful for sharing one key across multiple repos. |
| `-y, --yes`       | Skip the confirmation prompt when `<file>.encrypted` already exists.                                  |
| `--json`          | Emit a single JSON object instead of human-readable text.                                            |

**Behavior notes:**

- If `<file>.encrypted` already exists, the command warns you, asks for confirmation, and **backs up the old ciphertext to `<file>.encrypted.bak`** before replacing it. That backup is automatically gitignored.
- The generated key prints **once** to stdout. The tool does not save it anywhere. If you lose it, the encrypted file is unrecoverable.

---

### `envlope encrypt`

Re-encrypt an env file after editing values locally. Requires the existing key — refuses keys that don't match the current encrypted file, so accidental key rotation can't happen here.

```bash
# Prompts for the key (hidden input)
npx envlope encrypt

# Pass the key inline
npx envlope encrypt --key envlope_key_<paste-here>

# Encrypt a specific env file
npx envlope encrypt .env.production --key ...

# Use ENVLOPE_KEY env var instead of --key
export ENVLOPE_KEY=envlope_key_<paste-here>
npx envlope encrypt

# JSON output
npx envlope encrypt --json
```

**Options:**

| Flag              | Description                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `[file]`          | Positional. The env file to re-encrypt. Default: `.env`.                                 |
| `-k, --key <key>` | The envlope key (otherwise read from `ENVLOPE_KEY` env var, otherwise prompted).        |
| `--json`          | Emit a single JSON object instead of human-readable text.                                |

**Behavior notes:**

- Before re-encrypting, the command verifies the provided key actually matches the current `<file>.encrypted`. If the key has been rotated (via `envlope init`), the old key is rejected with a clear error.
- Errors cleanly if no `<file>.encrypted` exists yet (use `init` first).

---

### `envlope decrypt`

Decrypt `<file>.encrypted` back to `<file>` using the team's shared key.

```bash
# Prompts for the key (hidden input)
npx envlope decrypt

# Pass the key inline
npx envlope decrypt --key envlope_key_<paste-here>

# Decrypt a specific file
npx envlope decrypt .env.production --key ...

# Use ENVLOPE_KEY env var
export ENVLOPE_KEY=envlope_key_<paste-here>
npx envlope decrypt

# Skip the "overwrite existing .env?" prompt
npx envlope decrypt --key ... --yes

# JSON output
npx envlope decrypt --json --key ... --yes
```

**Options:**

| Flag              | Description                                                                        |
| ----------------- | ---------------------------------------------------------------------------------- |
| `[file]`          | Positional. The env file to decrypt. Default: `.env`.                              |
| `-k, --key <key>` | The envlope key (otherwise read from `ENVLOPE_KEY` env var, otherwise prompted). |
| `-y, --yes`       | Overwrite an existing decrypted file without prompting.                            |
| `--json`          | Emit a single JSON object instead of human-readable text.                          |

**Behavior notes:**

- If the plaintext file already exists, the command prompts before overwriting (unless `--yes`).
- A wrong key fails fast with `Invalid key — decryption failed.` — no stack trace, no leaked information.

---

### `envlope status`

Quick health check for a project's env file. Reports whether the plaintext and encrypted files exist, whether they're in sync, when the ciphertext was last updated, and whether `.gitignore` is protecting the plaintext.

```bash
npx envlope status

# Output:
# File: .env
# ✓ .env exists
# ✓ .env.encrypted exists (last encrypted 2h ago)
# ✓ .env and .env.encrypted are in sync
# ✓ .gitignore protects .env

# Check a specific file
npx envlope status .env.production

# JSON output for CI
npx envlope status --json

# Exit code 1 if out of sync (good for CI guards)
npx envlope status --strict
```

**Options:**

| Flag       | Description                                                                            |
| ---------- | -------------------------------------------------------------------------------------- |
| `[file]`   | Positional. The env file to check. Default: `.env`.                                    |
| `--json`   | Emit a single JSON object instead of human-readable text.                              |
| `--strict` | Exit with code 1 if the plaintext file is newer than the encrypted file (drift check). |

No key is required — `status` only inspects file metadata, never reads the encrypted contents.

---

### `envlope view`

Print the decrypted value of a single variable to stdout, without ever writing the plaintext env file to disk. Perfect for shell scripts that need exactly one secret.

```bash
# Print one value
npx envlope view DATABASE_URL

# In a script — assign without touching disk
DATABASE_URL=$(npx envlope view DATABASE_URL)

# Pass the key inline (or via ENVLOPE_KEY env var)
npx envlope view DATABASE_URL --key envlope_key_<paste-here>

# View a variable from a specific env file
npx envlope view STRIPE_KEY .env.production --key ...

# JSON output: {"variable":"DATABASE_URL","value":"postgres://..."}
npx envlope view DATABASE_URL --json
```

**Options:**

| Flag              | Description                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `<variable>`      | **Required.** The variable name to look up.                                                 |
| `[file]`          | Positional. The env file to read from. Default: `.env`.                                    |
| `-k, --key <key>` | The envlope key (otherwise read from `ENVLOPE_KEY` env var, otherwise prompted).         |
| `--json`          | Emit `{"variable":"...", "value":"..."}` instead of just the value.                        |

**Behavior notes:**

- Returns exit code 1 if the variable isn't found in the env file, with a clear error message.
- Reads the encrypted file in memory only — the plaintext env never touches disk.
- Parsing is intentionally simple: `KEY=VALUE` per line. Comments (`#`) and blank lines are skipped. Quoted values and multi-line values are not interpreted specially; the entire string after the first `=` is returned verbatim.

---

## Common workflows

### Sharing one key across multiple repos

If your team works across many projects, you usually don't want a separate key for every `.env`. Generate one key the first time, then reuse it everywhere with `--key`:

```bash
# First project — generate and save the key
cd ~/projects/repo-1
npx envlope init

# Every other project — paste the same key
cd ~/projects/repo-2
npx envlope init --key envlope_key_<paste-here>

cd ~/projects/repo-3
npx envlope init --key envlope_key_<paste-here>
```

Now one shared key unlocks every repo's secrets. Onboarding a new teammate becomes **one** key, not twenty.

---

### Multiple env files (dev/staging/prod)

Each env file is encrypted independently. You can use the same key across all of them, or rotate per environment.

```bash
# Encrypt each environment independently
npx envlope init .env.development
npx envlope init .env.staging
npx envlope init .env.production

# Or share one key across them
KEY=envlope_key_<paste-here>
npx envlope init .env.development --key $KEY
npx envlope init .env.staging --key $KEY
npx envlope init .env.production --key $KEY

# View a single secret from production
npx envlope view DATABASE_URL .env.production --key $KEY

# Check sync state of one file
npx envlope status .env.production
```

Each `<file>.encrypted` is its own ciphertext; teammates only need the key for the environments they have access to.

---

### Using `ENVLOPE_KEY` (set the key once, every command picks it up)

Once `ENVLOPE_KEY` is set, every command works without `--key`.

> ⚠️ **`ENVLOPE_KEY` is an OS-level environment variable. It does NOT go inside your `.env` file.**
>
> Your `.env` is what envlope *encrypts* — it never reads it. Putting the key inside `.env` would be circular (you'd need to decrypt `.env` to read the key that decrypts `.env`). Set it at the shell/OS level instead, as shown below.

The key resolution priority is:

1. `--key <key>` CLI flag (highest)
2. `ENVLOPE_KEY` environment variable
3. Interactive prompt (only when running in a TTY)

#### Windows (PowerShell)

```powershell
# Current PowerShell session only (resets when the window closes)
$env:ENVLOPE_KEY = "envlope_key_<paste-here>"

# Persistent for your user account (survives reboots, takes effect in NEW terminals)
[Environment]::SetEnvironmentVariable("ENVLOPE_KEY", "envlope_key_<paste-here>", "User")

# Verify it's set in a new PowerShell window
$env:ENVLOPE_KEY

# Remove it later
[Environment]::SetEnvironmentVariable("ENVLOPE_KEY", $null, "User")
```

You can also set it through the GUI: **Win+R → `sysdm.cpl` → Advanced → Environment Variables → New**.

#### Windows (CMD)

```cmd
:: Current session only
set ENVLOPE_KEY=envlope_key_<paste-here>

:: Persistent for your user
setx ENVLOPE_KEY "envlope_key_<paste-here>"
```

#### macOS / Linux (bash / zsh)

```bash
# Current shell session only
export ENVLOPE_KEY="envlope_key_<paste-here>"

# Persistent — add this line to ~/.bashrc, ~/.zshrc, or ~/.config/fish/config.fish
echo 'export ENVLOPE_KEY="envlope_key_<paste-here>"' >> ~/.zshrc
source ~/.zshrc
```

#### Real-world dev workflow (Vite, Next.js, NestJS, etc.)

Add an `envlope decrypt` call to your `package.json` scripts using npm's `pre*` lifecycle hooks. Teammates set `ENVLOPE_KEY` once on their machine, then run their dev server normally — decryption happens automatically:

```json
{
  "scripts": {
    "predev": "envlope decrypt --yes",
    "dev": "vite",

    "prestart": "envlope decrypt --yes",
    "start": "nest start",

    "prebuild": "envlope decrypt --yes",
    "build": "next build"
  }
}
```

A new teammate's flow becomes:

```bash
git clone <repo>
cd <repo>
npm install
# (one-time: set ENVLOPE_KEY using one of the methods above)
npm run dev     # ← envlope auto-decrypts .env, then vite starts
```

#### GitHub Actions / CI

```yaml
- name: Decrypt env
  env:
    ENVLOPE_KEY: ${{ secrets.ENVLOPE_KEY }}
  run: npx envlope decrypt --yes
```

Store the key as a repository secret (`Settings → Secrets and variables → Actions`), reference it via `${{ secrets.ENVLOPE_KEY }}`.

---

### `--json` for automation

Every command emits a single line of JSON to stdout when `--json` is passed. Errors emit `{"error": "...", "code": 1}` on the same channel.

```bash
# Check sync state in CI
RESULT=$(npx envlope status --json)
IN_SYNC=$(echo "$RESULT" | jq -r .in_sync)
if [ "$IN_SYNC" != "true" ]; then
  echo "Env file out of sync — re-encrypt before committing"
  exit 1
fi

# Init in CI and capture the new key
NEW=$(npx envlope init --yes --json)
KEY=$(echo "$NEW" | jq -r .key)
```

In `--json` mode the CLI never prompts. Pass `--key` (or set `ENVLOPE_KEY`), and pass `--yes` for any destructive operation, otherwise the command exits with a clear error.

---

### Updating `.env` values

After you edit `.env` locally, sync the encrypted file before committing:

```bash
# Edit .env however you like
echo "NEW_VAR=value" >> .env

# Re-encrypt with your existing key
npx envlope encrypt --key envlope_key_<paste-here>

# Commit the updated ciphertext
git add .env.encrypted
git commit -m "Update env vars"
git push
```

When teammates pull, they re-run `envlope decrypt` to pick up the changes.

Tip: run `envlope status` before committing to confirm `.env` and `.env.encrypted` are in sync.

---

### Rotating the key

If someone leaves the team, or you suspect the key was exposed, generate a new one. **This invalidates the old key** — anyone still holding it can no longer decrypt new versions.

```bash
# In the project where the encrypted file lives:
npx envlope init
# Warning: .env.encrypted already exists. Generating a new key will replace it...
# ✓ Backed up old .env.encrypted → .env.encrypted.bak
# Generate a new key and re-encrypt? (y/N) y
```

The old ciphertext is automatically backed up to `.env.encrypted.bak` (gitignored) before being replaced — so if you regret the rotation in the next few seconds, `cp .env.encrypted.bak .env.encrypted` restores the previous state.

Output prints the new key. Save it. Share the new key with the remaining team via a secure channel. Old key is now useless against the freshly-encrypted file.

For non-interactive use (scripts/CI):

```bash
npx envlope init --yes
```

---

### Recovering from a lost key

If everyone on the team has lost the key, the encrypted file cannot be recovered — that's the whole security premise.

You can, however, start over from your current local `.env`:

```bash
# Make sure your local .env is up to date
# Then run init again — it will prompt to replace the encrypted file
npx envlope init --yes
```

This generates a fresh key and a fresh encrypted file. The old ciphertext goes to `.env.encrypted.bak` (where it's still unrecoverable without the lost key, but at least preserved on disk). Old encrypted versions in your git history remain unrecoverable.

---

## Security model

**The key IS the secret.** Once your team has the key, they can decrypt any past, present, or future version of the encrypted file. Treat it like a master password:

- Store it in a password manager (1Password, Bitwarden, etc.), not in plaintext anywhere.
- Share over a secure channel (encrypted DM, password manager sharing, in person) — never in a public Slack channel, email body, or commit message.
- Rotate the key (`envlope init`) whenever someone leaves the team or you suspect the key was exposed.
- The tool does **not** back up the key. If everyone loses it, the encrypted file is computationally unrecoverable.

**What about pushing the encrypted file to a public repo?** Yes, that's exactly what envlope is designed for. AES-256-GCM with a 256-bit random key has no known practical attack — making the ciphertext public exposes nothing as long as the key stays private.

**What envlope does NOT protect against:**

- A compromised teammate who has the key — they can decrypt everything.
- A keylogger on a teammate's machine that captures the key when they type it.
- A leaked `.env` file (the plaintext one) committed to git by accident — the encryption only protects what you encrypt.
- An attacker with shell access to a machine that has the decrypted `.env` sitting on disk.

These are the same trade-offs as every shared-secret system. envlope protects **at-rest** secrets that travel through your repo.

---

## Troubleshooting

### `Invalid key — decryption failed.`

The key you provided doesn't decrypt the current `.env.encrypted`. Either:

1. You typed/pasted the key wrong (most common — re-check from your password manager).
2. A teammate rotated the key via `envlope init` and you have the old one — ask them for the current key.

### `This key does not match the current .env.encrypted.`

Same root cause as above, but triggered by `encrypt`. The tool refuses to re-encrypt with a stale key because doing so would silently grant access to whoever still holds that key.

### `No key provided. Pass --key, set ENVLOPE_KEY env var, or run interactively.`

You ran `encrypt`, `decrypt`, or `view` without a `--key`, without `ENVLOPE_KEY` in the environment, and stdin wasn't a TTY (so the tool couldn't prompt). Use one of the three options the message suggests.

### I added `ENVLOPE_KEY=...` to my `.env` file but envlope still prompts for the key

**`ENVLOPE_KEY` is an OS environment variable, not a line in `.env`.** envlope doesn't read your `.env` file looking for its own key — that'd be circular (you'd need to decrypt `.env` to read the key to decrypt `.env`). See the [Using `ENVLOPE_KEY`](#using-envlope_key-set-the-key-once-every-command-picks-it-up) section above for how to set it correctly per platform (`$env:ENVLOPE_KEY` in PowerShell, `export` in bash, etc.).

### `No .env file found in this directory.`

You ran `envlope init` or `envlope encrypt` in a directory without a `.env` file. Create one first, or pass a different file as a positional arg (`envlope encrypt .env.staging`).

### `No .env.encrypted file found in this directory.`

You ran a command that requires an existing encrypted file but it isn't here. Either you're in the wrong directory, or no one has run `envlope init` for this project yet.

### `Variable 'XYZ' not found in .env.encrypted.`

From `envlope view`. The variable name doesn't exist in the decrypted env file. Check spelling and that you're targeting the right file.

### `envlope: command not found` after `npm i envlope`

Local installs don't put binaries on your PATH. Either use `npx envlope <command>`, or install globally with `npm install -g envlope`.

### Re-init prompts fail in scripts / CI

The confirmation prompt for re-init requires a TTY. In non-interactive environments, pass `--yes`:

```bash
npx envlope init --yes
npx envlope decrypt --key ... --yes
```

In `--json` mode the tool refuses to prompt at all — pass `--yes` explicitly or provide all required keys/files via flags or env vars.

---

## How it works (technical)

- **Algorithm:** AES-256-GCM (authenticated encryption — provides both confidentiality and tamper-detection)
- **Key:** 32 random bytes from `crypto.randomBytes`, base64-encoded with an `envlope_key_` prefix
- **IV:** 12 random bytes per encryption — every encrypt produces a different ciphertext, even for identical plaintext
- **Auth tag:** 16-byte GCM tag — any tampering with the ciphertext is detected at decrypt time and rejected
- **Key derivation:** none. The key is already high-entropy random bytes; no PBKDF2/Argon2 needed.

The encrypted file is a single line:

```
envlope:1:<base64(iv || ciphertext || tag)>
```

The `envlope:1:` prefix is a version tag — if the format ever changes in a backwards-incompatible way (it won't on a whim), old files will be readable by version-aware tooling.

**Crypto implementation lives in [`src/crypto.ts`](./src/crypto.ts)** — ~50 lines, uses only Node's built-in `node:crypto` module. No third-party crypto dependencies.

**No background processes, no network calls (except the optional update-notifier version check), no telemetry.** The tool only reads/writes:

- `.env` (or whichever env file you pointed it at — the plaintext)
- `.env.encrypted` (the ciphertext)
- `.env.encrypted.bak` (created automatically when `init` replaces an existing ciphertext)
- `.gitignore` (to ensure plaintext files never accidentally end up in git)

That's it.

---

## Development

```bash
# Clone and install
git clone <repo>
cd envlope
npm install

# Run tests (vitest)
npm test

# Watch mode while developing
npm run test:watch

# Run the CLI from source
npm run dev -- <command>

# Type-check
npm run typecheck

# Build production bundle to dist/
npm run build
```

Test coverage spans crypto round-trips, key format validation, multi-file flows, env var resolution, JSON output, and end-to-end CLI tests against temp directories. See [`tests/`](./tests/).

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

---

## License

[MIT](./LICENSE) — do whatever you want, just don't blame me.
