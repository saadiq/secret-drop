# secret-drop — one-day encrypted file dropbox

**Date:** 2026-07-22
**Status:** Approved

## Purpose

Let a single non-technical client upload a secret key (a JSON file) to this
machine over the public internet, with end-to-end encryption, via a page at
`https://drop.saadiq.xyz`. The service runs locally, is exposed through a named
Cloudflare tunnel, and stays up for less than a day. Success = the client
uploads the file with no instructions beyond "open this link, enter the code I
texted you, pick the file, click Send", and the decrypted JSON lands on this
machine.

## Decisions made

- **End-to-end encryption in the browser** (not just HTTPS). Cloudflare's edge
  and anyone who obtains the URL see only ciphertext.
- **Named tunnel on own domain**: `drop.saadiq.xyz` (zone `saadiq.xyz`).
  Trustworthy-looking link for the client.
- **Server stays up until manually stopped.** Uploads are timestamped, never
  overwritten; the client can retry freely. Operator Ctrl-Cs after confirming
  the key decrypts.
- **Runtime:** Bun (per user preference). No frameworks, no build step.

## Architecture

```
client browser ──HTTPS──▶ Cloudflare edge ──tunnel──▶ cloudflared ──▶ Bun server (127.0.0.1:8787)
   (encrypts before upload)                                              └─▶ ./uploads/*.enc
```

The Bun server binds to 127.0.0.1 only; the tunnel is the sole path in.

## Components

| File | Responsibility |
|------|----------------|
| `server.ts` | Serve upload page (injecting passphrase verifier), accept `POST /upload`, save `uploads/upload-<ISO timestamp>.enc` |
| `public/index.html` | Self-contained mobile-friendly page: passphrase field, file picker, in-browser encryption, upload, success/error states |
| `decrypt.ts` | CLI: `bun decrypt.ts uploads/<file>.enc` → prompts for passphrase → writes decrypted JSON alongside |
| `start.sh` | Generate (or accept via `PASS`) a 4-word passphrase, start server + `cloudflared tunnel run`, print public URL + passphrase to text the client |
| `teardown.sh` | Stop server + tunnel processes; with `--full`, also `cloudflared tunnel delete secret-drop` and remove the DNS record |

One-time setup (scripted or documented): `cloudflared tunnel create secret-drop`,
`cloudflared tunnel route dns secret-drop drop.saadiq.xyz`, config file mapping
the tunnel to `http://localhost:8787`.

**Caveat:** the existing `~/.cloudflared/cert.pem` (March 2026) is scoped to one
zone. If that zone is not `saadiq.xyz`, `cloudflared tunnel login` must be
re-run once. Setup detects and reports this.

## Crypto design

- **Key derivation:** PBKDF2-SHA256, 600,000 iterations, random 16-byte salt
  generated per upload in the browser → AES-256-GCM key.
- **Encryption:** AES-256-GCM, random 12-byte IV. Upload payload (JSON):
  `{ salt, iv, data }`, all base64. GCM auth tag makes tampering/corruption and
  wrong-passphrase decryption fail loudly.
- **Passphrase verifier:** at startup the server normalizes the passphrase
  (trim + lowercase) and derives PBKDF2(passphrase, fixed server salt), then
  embeds its SHA-256 hash + salt in the page. The browser recomputes it to
  give immediate "that code doesn't match" feedback *before* upload. Accepted
  trade-off: the verifier is visible in page source, enabling offline
  brute-force — mitigated by a generated ~50-bit (4-word) passphrase at 600k
  iterations, far beyond feasible for the exposure window.
- **Channel separation:** link goes in email; passphrase goes by SMS/Signal.

## Server behavior

- Routes: `GET /` (page), `POST /upload` (JSON body, 2 MB cap), everything else 404.
- Rejects oversized or malformed payloads with client-friendly errors.
- Any file type accepted (client may not know what JSON is); hint text suggests `.json`.
- Filenames are server-generated timestamps — no client input in paths.
- Minimal logging: timestamp + byte size per upload to stdout.

## Error handling

- Wrong code → caught client-side pre-upload ("check the text I sent you").
- Network/upload failure → retry message; retries are safe indefinitely.
- Decrypt failure (tamper/corruption) → GCM verification error, loud CLI message.
- Oversized upload → 413 with friendly message.

## Testing

`bun test`:
1. **Crypto round-trip:** encrypt with the page's exact parameters (Bun's
   WebCrypto matches the browser's), decrypt with `decrypt.ts` logic; includes
   wrong-passphrase and tampered-ciphertext failure cases.
2. **Endpoint tests:** happy-path upload persists a file; oversize → 413;
   malformed JSON → 400.

Manual verification: full walk-through via the real tunnel URL before sending
the link to the client.

## Out of scope

- Multiple clients, accounts, upload listing UI, rate limiting beyond size cap,
  automatic shutdown timers, Cloudflare Access.
