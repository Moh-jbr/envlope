# Changelog

All notable changes to `envlope` are documented here. This project follows [Semantic Versioning](https://semver.org/) and the [Keep a Changelog](https://keepachangelog.com/) format.

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
