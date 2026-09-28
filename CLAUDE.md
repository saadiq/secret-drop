# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`secret-drop`: a one-day, end-to-end-encrypted file drop at https://drop.saadiq.xyz for receiving a secret key file from a client. Files are encrypted in the sender's browser with the operator's public key (a fresh AES-256-GCM key per upload, wrapped with RSA-OAEP-4096/SHA-256); the server, Cloudflare, and the network only ever see ciphertext, and only the private key in `keys/` can decrypt. Runs on Bun, no dependencies, no build step — Bun executes the TypeScript directly.

## Commands

- `bun test` — full suite; `bun test tests/server.test.ts` — one file; `bun test -t 'name'` — one test
- `./setup.sh` — one-time: create the named cloudflared tunnel and route DNS
- `bun keygen.ts` — one-time: write `keys/public.jwk.json` + `keys/private.jwk.json` (0600); refuses to overwrite an existing pair
- `./start.sh` — run an exchange: starts server + tunnel, prints the link; Ctrl-C or `./teardown.sh` stops it; refuses to start if pidfiles in `.run/` are alive
- `./teardown.sh --full` — also deletes the tunnel (CNAME must be removed in the Cloudflare dashboard by hand)
- `bun decrypt.ts uploads/<file>.enc` — decrypt an upload with the private key; writes `<upload>-<sender's filename>` next to it (the name travels inside the ciphertext as a one-line JSON header before the file bytes)
- `bun server.ts` — server alone on 127.0.0.1:8787
- `KEYS_DIR=...` overrides the key location (default `keys/` next to the code, not the cwd) for server, keygen, and decrypt

## Architecture

**One crypto module, four consumers.** `public/drop-crypto.js` is the single source of crypto truth, consumed by (1) the browser page via inlining, (2) `keys.ts` for the startup pair check and `server.ts` for the upload shape check (`isPayload`), (3) `decrypt.ts` and `keygen.ts`, and (4) the tests — so the exact code the browser runs is the code the tests exercise. Any change to it affects all four at once.

**The page is assembled, not served from disk.** At startup `server.ts` reads `public/index.html` as a template and string-substitutes two things: the sentinel comment `// __DROP_CRYPTO_INLINE__` is replaced with the crypto module source verbatim (a function replacer, because `$` is special in string replacement; the module's `export` declarations are legal as-is inside an inline module script), and the `__PUBLIC_KEY_JWK__` token is replaced with the public key as a JSON literal. The result is deliberately a **single HTTP response**: a separate `.js` request with "crypto" in its name is exactly what corporate proxies and ad-block lists drop. Don't reintroduce a `/drop-crypto.js` route or add secondary asset requests. A test extracts the assembled inline module and parse-validates it with `Bun.Transpiler` — substring assertions alone can't catch substitution breaking the syntax.

**Never show a dead Send button.** The page has layered failure surfaces: a `<noscript>` notice, and a classic (non-module, old-syntax) watchdog script that reports an error if the module hasn't set `window.__dropReady` shortly after `load`. The module sets that flag as its last line on purpose. The watchdog intentionally duplicates the module's `showError` DOM write — it exists precisely for when the module never ran, so it cannot share code with it.

**Trust model.** No shared secret: the page embeds only the public key, so there is nothing to guess offline and nothing to text the sender. `keys.ts` `loadKeyPair` is the single gate — it requires *both* halves and round-trips a probe through them, so the server refuses to start (and never serves a page whose uploads can't be opened) if the keys are missing or mismatched. `keys/` is git-ignored (a test asserts it); the repo is public, so keys must never be committed. The server binds 127.0.0.1 only; the named tunnel is the sole public path.

**Upload handling** (`server.ts`): 2 MB cap enforced first via Content-Length (413, body drained to preserve keep-alive) with `maxRequestBodySize` at 2× as the hard backstop; payloads are saved timestamped to `uploads/`, never overwritten, so the sender can retry freely.

**Operational flow** (from README): `bun keygen.ts` once, then `./start.sh` and send the sender the link.

Note: `docs/superpowers/plans/2026-07-22-secret-drop.md` is the original planning snapshot and predates the inlining change and the switch from a passphrase to a key pair — don't treat it as current documentation.
