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
  - [`envlope run`](#envlope-run)
  - [`envlope key`](#envlope-key)
- [Common workflows](#common-workflows)
  - [When a teammate updated `.env.encrypted` too](#when-a-teammate-updated-envencrypted-too)
  - [Many repos at once (`--all`)](#many-repos-at-once---all)
  - [Sharing one key across multiple repos](#sharing-one-key-across-multiple-repos)
  - [Multiple env files (dev/staging/prod)](#multiple-env-files-devstagingprod)
  - [Keeping production secrets from interns and contractors](#keeping-production-secrets-from-interns-and-contractors)
  - [Using `ENVLOPE_KEY` for CI/scripts](#using-envlope_key-set-the-key-once-every-command-picks-it-up)
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
✓ Encrypted .env → .env.encrypted · 3 variables · AES-256-GCM
✓ Created .gitignore (added .env, .env.local, .env.encrypted.bak)

╭─ SAVE THIS KEY · shown once ───────────────────────────────╮
│                                                            │
│  envlope_key_IiE85vhkdQLrNxksL9JWrWYOPHW35+gmJX366q8bapU=  │
│  fingerprint  3723·1317 · crystal-castle-bison             │
│                                                            │
╰─ password manager → share over a secure channel ───────────╯

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

Every command accepts an optional positional `[file]` argument (default: `.env`), and every command supports `--json` for structured output. The file must be inside the current folder, because that folder's `.gitignore` is what protects it. `./.env.production` and `.\.env.production` work the same as `.env.production`.

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
| `--all`           | Set up every git repo in this folder, with one key or a key per group of repos. See [Many repos at once](#many-repos-at-once---all). |
| `--only <patterns>` | With `--all`: only the repos whose folder names match, like `"*-back"`.                            |

**Behavior notes:**

- If `<file>.encrypted` already exists, the command warns you, asks for confirmation, and **backs up the old ciphertext to `<file>.encrypted.bak`** before replacing it. That backup is automatically gitignored. Without a terminal (CI, piped stdin) or in `--json` mode it can't ask, so it exits with an error unless you pass `--yes`.
- `.gitignore` entries are only added when no existing rule already covers them. If a broad rule such as `.env*` would also hide `<file>.encrypted`, a `!<file>.encrypted` exception is appended so `git add` works.
- The generated key prints **once** to stdout. The tool does not save it anywhere. If you lose it, the encrypted file is unrecoverable.
- In a terminal, if `ENVLOPE_KEY` already holds a key, `init` offers to use it instead of generating a new one, so a new repo can join the key your other repos use. Scripts still get a new key unless they pass `--key`.
- Next to the key you get its **fingerprint**, e.g. `3723·1317`, also as three words you can read aloud: `crystal-castle-bison`. `encrypt`, `decrypt` and `view` print the fingerprint too (`key 3723·1317`), and [`envlope key`](#envlope-key) shows both forms any time, so teammates can confirm they hold the same key without pasting the key anywhere. `--json` output includes `fingerprint` (`"37231317"`) and `fingerprint_words`.

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
| `--force`         | Encrypt even if `<file>.encrypted` changed since your env file was made, replacing that version. |
| `--json`          | Emit a single JSON object instead of human-readable text.                                |
| `--all`           | Re-encrypt in every git repo in this folder. See [Many repos at once](#many-repos-at-once---all). |
| `--only <patterns>` | With `--all`: only the repos whose folder names match, like `"*-back"`.                |

**Behavior notes:**

- Before re-encrypting, the command verifies the provided key actually matches the current `<file>.encrypted`. If the key has been rotated (via `envlope init`), the old key is rejected with a clear error.
- **It won't silently undo a teammate's update.** If `<file>.encrypted` changed since your env file was made (say a `git pull` brought a teammate's version), encrypting would replace their changes. So `encrypt` shows, by name, what each side changed. In a terminal it then offers to merge, overwrite or cancel; without one it refuses unless you pass `--force`. See [When a teammate updated `.env.encrypted` too](#when-a-teammate-updated-envencrypted-too).
- If the plaintext hasn't changed since it was last encrypted, `<file>.encrypted` is left untouched, so there's no git diff to commit. `--json` output reports this as `"changed": false`.
- After re-encrypting, it lists which variables you added (`+`), changed (`~`) or removed (`-`), by name only. Values are never printed. `--json` output includes the same lists as `variables: {added, changed, removed}`.

  ```
  ✓ Updated .env.encrypted — ready to commit · key 3723·1317

      + SENTRY_DSN
      ~ DATABASE_URL
      - LEGACY_TOKEN

    3 changes · 4 variables · values are never printed
  ```
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
| `--all`           | Decrypt in every git repo in this folder. See [Many repos at once](#many-repos-at-once---all). |
| `--only <patterns>` | With `--all`: only the repos whose folder names match, like `"*-back"`.          |

**Behavior notes:**

- If the plaintext file already exists with the same content, nothing is written and there's nothing to confirm.
- If it differs, the command lists which variables an overwrite would replace, remove or add (names only) and asks before overwriting, unless you pass `--yes`. Without a terminal or in `--json` mode it can't ask, so it exits with an error that names those variables.

  ```
  ▲  .env already exists and differs from .env.encrypted
  │
  │  changed   DATABASE_URL   your local value is replaced
  │  removed   DEBUG          only in your local .env
  │
  ◆  Overwrite .env?
  │  ○ Yes / ● No
  └
  ```
- A wrong key fails fast with `Invalid key — decryption failed.` — no stack trace, no leaked information.

---

### `envlope status`

Quick health check for a project's env file, as a checklist. It reports whether the plaintext and encrypted files exist, whether they're in sync, which ignore rule protects the plaintext, and whether the encrypted file can be committed. Every problem comes with the command or edit that fixes it.

```
envlope status · .env

  ✓ .env                        170 B · edited 3m ago
  ✓ .env.encrypted              275 B · written 2h ago
  ✗ sync                        .env changed after the last encrypt
                                fix: envlope encrypt
  ✓ .env ignored                rule .env (.gitignore line 1)
  ✓ .env.encrypted committable  not ignored

  1 problem
```

```bash
npx envlope status

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
| `--all`    | Check every git repo in this folder. See [Many repos at once](#many-repos-at-once---all). |
| `--only <patterns>` | With `--all`: only the repos whose folder names match, like `"*-back"`.       |

No key is required — `status` only inspects file metadata, never reads the encrypted contents. Ignore rules are checked with `git check-ignore`, so rules in parent directories, `.git/info/exclude` and your global gitignore all count; outside a git repo, the `.gitignore` in the current directory is used. If git already tracks the plaintext file, `status` reports it as unprotected whatever `.gitignore` says, since a tracked file keeps being committed, and shows `git rm --cached` as the fix. `init` and `decrypt` warn about this too. In a git repo, `status` also flags a `<file>.encrypted` that changed since your env file was made, such as a teammate's version from `git pull` (the "up to date" row). It also flags other plaintext env files next to yours, like `.env.bak` or `.env.pre-tunnel`, when git tracks them or could commit them: they hold the same secrets, but no rule envlope writes covers them. Templates (`*.example`) are left out. `--json` output adds `problems`, `issues` (each with `check`, `detail` and `fix`), `gitignore_rule`, `tracked`, `behind`, `encrypted_committable` and `other_env_files` to the fields above.

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

- In an interactive terminal, the value is labeled with its name, length, source file and key fingerprint. When the output goes to a pipe or a `$(…)` command substitution, only the raw value is printed, so scripts are unaffected.
- Returns exit code 1 if the variable isn't found in the env file. The error suggests the closest name (`did you mean DATABASE_URL?`) and lists the available names on stderr, so a script's stdout stays empty.
- Reads the encrypted file in memory only — the plaintext env never touches disk.
- Values are parsed with the same rules as the `dotenv` package, so you get what your app would load: an `export ` prefix and `NAME: value` lines are allowed, quotes (`"…"`, `'…'`, `` `…` ``) are removed and may span multiple lines, `\n` inside double quotes becomes a newline, unquoted values stop at `#` (inline comment), and if a name is defined twice the last one wins.

---

### `envlope run`

Run a command with the decrypted variables in its environment. The plaintext is decrypted in memory and never written to disk, so there's no `.env` lying around to leak.

`run` keeps secrets off disk, not out of sight. The command gets every value, so its code can print them (`console.log(process.env.STRIPE_KEY)`), and whoever has the key can also read them with `envlope view` or `envlope decrypt`. To keep secrets from someone, don't give them that key: see [Keeping production secrets from interns and contractors](#keeping-production-secrets-from-interns-and-contractors).

```bash
# Start your app with the variables from .env.encrypted
npx envlope run -- npm run dev

# Another env file
npx envlope run --file .env.production -- node server.js

# The command's own options pass straight through
npx envlope run -- npm test -- --watch
```

**Options:**

| Flag                | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `<command...>`      | **Required.** The command to run. Put envlope's own options before it.              |
| `-f, --file <file>` | The env file to use. Default: `.env`.                                               |
| `-k, --key <key>`   | The envlope key (otherwise read from `ENVLOPE_KEY` env var, otherwise prompted).   |
| `--override`        | Let the file's values replace variables already set in your environment.            |

**Behavior notes:**

- Variables already set in your environment win, as with dotenv. Pass `--override` to let the file's values replace them.
- `ENVLOPE_KEY` is removed from the command's environment: it gets the secrets it needs, not the key to all of them.
- envlope exits with the command's exit code, or 127 if the command isn't found. Ctrl-C goes to the command, and envlope waits for it to finish.
- In an interactive terminal, one line on stderr says how many variables were loaded and with which key. Scripts and CI see only the command's own output.
- Works on Windows too, including `npm`, `npx` and other `.cmd` launchers, with arguments passed through exactly.
- Shell syntax in the command is expanded by your shell before envlope runs, so `envlope run -- echo $API_URL` prints your shell's value. To use an injected variable in a shell expression, run a shell: `envlope run -- sh -c 'echo $API_URL'`.

---

### `envlope key`

Show which key you have: its fingerprint as three words you can read aloud, the hex fingerprint, where the key came from, and which encrypted files in this folder it opens.

```
$ npx envlope key
key  zephyr-blossom-bronze  (ff14·18fe)
     from ENVLOPE_KEY
     ✓ opens .env.encrypted
     ✗ doesn't open .env.production.encrypted
```

Teammates can compare the words on a call to confirm they hold the same key without sharing it. The words come from the first 24 bits of the fingerprint, so they're a quick check rather than a full match. Exits with code 1 if there are encrypted files here and the key opens none of them. `--json` returns `fingerprint`, `fingerprint_words`, `source` and `files`.

`envlope key --all` checks the key against every git repo in this folder instead, and in a terminal lets you try more keys on the repos it doesn't open, which maps out which key opens which repo. See [Many repos at once](#many-repos-at-once---all).

---

## Common workflows

### Many repos at once (`--all`)

If your repos sit side by side in one folder, run `init`, `encrypt`, `decrypt`, `status` or `key` from that folder with `--all`. It runs in every git repo directly inside the folder (each folder with a `.git`; anything else is left alone), prints a row for each repo as it's done, and ends with totals.

```
$ cd ~/work/acme
$ npx envlope decrypt --all
envlope decrypt --all · 41 repos in acme

key 3723·1317 · crystal-castle-bison · from ENVLOPE_KEY
  ✓ billing-back      decrypted
  ✓ gateway-back      already matches
  ▲ users-back        .env has local changes (decrypting would replace DB_URL)
  ...

○ 3 repos need a different key: admin-front, shop-front, web-front
◆  Try another key on them?
│  ● Enter another key
│  ○ Skip them
```

**Setting up with `init --all`.** In a terminal, `init --all` asks how to lock the repos that have a `.env`:

1. **One key for all of them, or different keys** for different repos, like one for the backend and one for the frontend.
2. With different keys: **how many**, then **which repos each key is for**. envlope suggests groups from the folder names ("Names like `*-back`"), takes a pattern you type, or lets you tick repos in a list. The list scrolls, `a` ticks them all, and the last key starts with every repo still left.
3. **Where each key comes from:** a new key, the key in `ENVLOPE_KEY`, or one you paste, such as the backend key you already use.

It shows the plan and asks before it encrypts anything. Each new key is shown once at the end, with the repos it opens. Repos that already have a `.env.encrypted` are left alone unless you say so (or pass `--yes`), because re-encrypting retires their current key; a repo that the chosen key already opens is never rewritten. Without a terminal, or with `--json`, `init --all` locks every repo with one new key, or with `--key`.

**Day to day.** `decrypt --all`, `encrypt --all` and `key --all` use your key (from `--key`, `ENVLOPE_KEY` or the prompt) on every repo it opens and set the others aside. In a terminal they then offer to try another key on those, as many times as it takes, so one run covers repos with different keys. Questions wait until the end instead of interrupting the run:

- `decrypt --all`: repos where decrypting would overwrite local changes. Keep the changes, go through the repos one by one (see what differs, then decide), or overwrite them all.
- `encrypt --all`: repos where someone else's newer `.env.encrypted` arrived, say with `git pull`. Go through them one by one with `encrypt`'s merge, or leave them for later.

Without a terminal those repos are reported and the exit code is 1: `decrypt --all --yes` overwrites local changes and `encrypt --all --force` replaces the newer version. `status --all` checks every repo and lists each problem with its fix, including stray plaintext copies such as `.env.bak`.

**Choosing repos.** `--only` narrows any `--all` run by folder name. Separate patterns with commas; `*` and `?` are wildcards, `!` leaves names out, and case doesn't matter.

```bash
npx envlope status --all                                  # every repo
npx envlope encrypt --all --only "*-back"                 # just the backend repos
npx envlope decrypt --all --only "*,!legacy-*"            # all but the legacy ones
npx envlope init --all --only "*-front" --key $FRONT_KEY  # scripted: one given key
npx envlope status --all --strict                         # CI: fail on unencrypted edits
```

With `--json` you get one object: `folder`, `command`, `file`, `repos` and `summary`. Each repo has `repo`, `status` (`done`, `unchanged`, `attention`, `other_key`, `skipped` or `problem`), `detail`, any `notes` and `warnings`, and the command's own JSON as `result`. `summary` counts the statuses. `init --all` adds `keys`: each key's `fingerprint`, its `source`, the repos it opens, and the `key` itself when it's new.

---

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

If the repos sit in one folder, `envlope init --all` does this in a single run, and can give different groups of repos different keys. See [Many repos at once](#many-repos-at-once---all).

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

### Keeping production secrets from interns and contractors

Anyone who can run your app with a secret can read it. The app's code can print it (`console.log(process.env.STRIPE_KEY)`), and the key that lets them use `envlope run` also lets them use `envlope decrypt`. No tool can hand someone a working secret and keep it hidden from them. A password on `decrypt` wouldn't help either: whoever has the key can decrypt the file without envlope, since the format is [documented](#how-it-works-technical).

So rather than hiding production secrets from people, don't give them those secrets. Keep one env file per audience, each with its own key:

```bash
# Values everyone on the team may see: test API keys (like Stripe's sk_test_...),
# a local or shared dev database
npx envlope init .env.development    # prints the dev key: share it with interns

# The real thing, for the people and CI that deploy
npx envlope init .env.production     # prints the prod key: keep it to those few
```

An intern gets only the dev key and runs the app with it:

```bash
npx envlope run --file .env.development -- npm run dev
```

- `envlope key` lists which encrypted files a key opens, so you can check that the dev key opens `.env.development.encrypted` and nothing else.
- With many repos, `npx envlope init .env.development --all` sets them all up with one dev key, or a key per group of repos.
- An intern often needs fewer secrets than you'd think: a frontend can talk to a shared staging API instead of holding any backend credentials.
- If someone already has a key they shouldn't keep (an intern who was given the prod key, or anyone who leaves), a new envlope key isn't enough, because they've seen the values. Rotate the secrets where they're issued (a new Stripe key, a new database password), then encrypt the new values under a new key with `envlope init`.

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

Every command emits a single line of JSON to stdout when `--json` is passed. Errors emit `{"error": "...", "code": 1}` on the same channel. Where a script might want to act on the cause, the error also has a `reason`: `no_env`, `not_set_up`, `wrong_key`, `unreadable`, `already_set_up` (from `init`), `local_changes` (from `decrypt`, with the affected names as `variables`) or `newer_version` (from `encrypt`). Results carry `warnings` when there's a risk to know about, like a plaintext file that git tracks.

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

### When a teammate updated `.env.encrypted` too

Say you edited `.env`, and meanwhile a teammate pushed their own change to `.env.encrypted`, which you then pulled. Encrypting your `.env` as it is would quietly undo their change. envlope remembers which version of `.env.encrypted` your `.env` came from (kept inside `.git`, never committed, and only the encrypted form), so `encrypt` notices and shows what each side changed:

```
▲  .env.encrypted changed since your .env was made (a teammate's update?)
│
│  theirs   + SENTRY_DSN  ~ API_KEY
│  yours    ~ DEBUG
│
◆  What do you want to do?
│  ● Merge: keep your changes and theirs
│  ○ Overwrite their version with your .env (their changes are lost)
│  ○ Cancel
└
```

- **Merge** puts their changes and yours into both `.env` and `.env.encrypted`, variable by variable. Comments and line order come from their version.
- If you both changed the same variable to different values, there's no Merge option: back up your `.env`, run `envlope decrypt --yes`, redo your changes, and encrypt again.
- If you have no changes of your own, the first option takes their version instead (the same as `envlope decrypt`).
- Without a terminal (CI, scripts, `--json`), `encrypt` refuses and explains, unless you pass `--force` to replace their version.

This works once envlope has recorded a version for your `.env`, which `init`, `decrypt` and `encrypt` all do, in a git repo.

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
- Rotate the key (`envlope init`) whenever someone leaves the team or you suspect the key was exposed. Rotate the secrets themselves too, where they're issued: a new key keeps that person out of future versions, but they may already have seen the current values.
- The tool does **not** back up the key. If everyone loses it, the encrypted file is computationally unrecoverable.

**What about pushing the encrypted file to a public repo?** Yes, that's exactly what envlope is designed for. AES-256-GCM with a 256-bit random key has no known practical attack — making the ciphertext public exposes nothing as long as the key stays private.

**What envlope does NOT protect against:**

- Anyone who has the key, a compromised teammate included: they can decrypt everything it opens. `envlope run` doesn't hide values from them either, since the command it runs can print them. Give people who should see only some secrets a separate env file with its own key (see [Keeping production secrets from interns and contractors](#keeping-production-secrets-from-interns-and-contractors)).
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

From `envlope view`. The variable name doesn't exist in the decrypted env file. The lines under the error suggest the closest name and list the ones that exist. Check spelling and that you're targeting the right file.

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

**Key fingerprint:** the first 8 hex characters of SHA-256(`"envlope-key-fingerprint\0"` + key). It's safe to share: anyone with the committed ciphertext can already check a guessed key, so the fingerprint gives them nothing new.

**No telemetry, and no network calls except update-notifier's version check.** That check runs at most once a day in a detached background process, and only when envlope's output goes to an interactive terminal. It never runs when output is piped or redirected (as in most scripts and CI), or in `--json` mode. Set `NO_UPDATE_NOTIFIER=1` to turn it off. Apart from update-notifier's own cache file, the tool only reads/writes:

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

### Releasing

Pushing a version tag publishes to npm. [`.github/workflows/publish.yml`](./.github/workflows/publish.yml) checks that the tag matches `package.json`, runs the type-check, tests and build, then publishes with npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token is stored anywhere, and each release gets a provenance statement linking it to the run that built it.

One-time setup: on npmjs.com, open the package's **Settings → Trusted Publisher**, choose **GitHub Actions**, and enter `Moh-jbr`, `envlope` and `publish.yml`. Or, logged in to npm with 2FA on, run `npx npm@12 trust github envlope --file publish.yml --repo Moh-jbr/envlope --allow-publish`. npm expires a new trusted publisher that hasn't published within 2 days, so set it up right before your first tagged release.

```bash
# 1. Add the new version's section to CHANGELOG.md, and commit it

# 2. Bump the version: commits package.json and package-lock.json, and tags it vX.Y.Z
npm version minor        # or patch, or major

# 3. Push the commit and the tag
git push --follow-tags
```

A version with a hyphen, like `v0.3.0-beta.1`, is published under the `next` dist-tag, so `npm install envlope` keeps getting the latest stable version.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

---

## License

[MIT](./LICENSE) — do whatever you want, just don't blame me.
