# secret-drop

A one-day, end-to-end-encrypted file drop for receiving a sensitive file
(e.g. a key file) from a non-technical person. They open a link, enter a
short code you texted them, pick the file, click Send. The file is
encrypted in their browser (PBKDF2-SHA256 600k → AES-256-GCM) before it
travels — Cloudflare and the network only ever see ciphertext. The
server binds 127.0.0.1; a named Cloudflare tunnel is the only public
path.

## Prerequisites

- macOS or Linux with [Bun](https://bun.sh): `brew install oven-sh/bun/bun`
  (or `curl -fsSL https://bun.sh/install | bash`)
- A free Cloudflare account
- A domain whose DNS is managed by Cloudflare: in the dashboard, **Add a
  site**, then point the domain's nameservers at the two Cloudflare
  assigns you (done at your registrar; takes minutes to a few hours)
- The Cloudflare tunnel CLI: `brew install cloudflared`
- Authorize it once: `cloudflared tunnel login` — a browser opens; pick
  the domain you just added. This writes `~/.cloudflared/cert.pem`
  scoped to that zone.

## Make it yours

The repo hard-codes its original owner in a few places. Before first
run:

1. **Hostname** — edit the constants at the top of the scripts to your
   subdomain (any name works; `drop.` is a fine convention):
   - `setup.sh`: `PUBLIC_HOSTNAME` (and `TUNNEL_NAME` if you like)
   - `start.sh`: `PUBLIC_HOSTNAME`
   - `teardown.sh`: the tunnel name in the `--full` branch, if you
     changed `TUNNEL_NAME`
2. **Page copy** — search `public/index.html` for `Saadiq` and put your
   own name in the title, headings, and error messages the sender sees.

## One-time setup

    ./setup.sh
    # if it says the cert is scoped to the wrong zone:
    # cloudflared tunnel login  (pick the right domain), then re-run ./setup.sh

This creates the named tunnel, writes `cloudflared-config.yml`, and
routes `https://<your-subdomain>` to it. No ports opened, no DNS records
to create by hand.

## Run an exchange

    ./start.sh            # prints the link and a generated 4-word code

1. **Email them the link**, **text them the code** (separate channels —
   never both in one message).
2. They open the link, enter the code, pick the file, click Send.
3. Decrypt: `bun decrypt.ts uploads/<newest>.enc` (it will ask for the
   code).
4. Confirm the file is what you expect, then Ctrl-C (or
   `./teardown.sh`).
5. Done with the domain? `./teardown.sh --full` and delete the CNAME in
   the Cloudflare dashboard (DNS → records).

## Message templates

Email: "Hi <name> — here's the secure page for sending me that key
file: https://<your-subdomain>. It'll ask for a short code — I'm
texting that to you separately right now. Any trouble, just call me."

Text: "Code for the secure page: <four-word-code>"

## Notes

- Wrong code is caught on the sender's device before anything uploads.
- Every upload is timestamped in `./uploads/` — nothing is overwritten;
  the sender can retry freely while the server is up.
- The page's embedded verifier would allow offline guessing of the
  code, which is why `start.sh` generates ~60-bit passphrases. Don't
  replace the generated code with a weak one.
- Passphrase generation reads `/usr/share/dict/words` (present on macOS
  and most Linuxes). If yours lacks it, supply your own:
  `PASS="four-random-dictionary-words" ./start.sh`.
- The server listens on `127.0.0.1:8787`; if that port is taken, change
  it in `setup.sh` (`PORT`) and `server.ts` before running `./setup.sh`.
- Tests: `bun test`
