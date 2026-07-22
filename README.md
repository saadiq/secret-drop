# secret-drop

One-day, end-to-end-encrypted file drop at https://drop.saadiq.xyz for
receiving a secret key from a client. Files are encrypted in her browser
(PBKDF2-SHA256 600k → AES-256-GCM); Cloudflare and the network only ever
see ciphertext. Server binds 127.0.0.1; a named Cloudflare tunnel is the
only public path.

## One-time setup

    ./setup.sh
    # if it says the cert is scoped to the wrong zone:
    # cloudflared tunnel login  (pick saadiq.xyz), then re-run ./setup.sh

## Run an exchange

    ./start.sh            # prints the link and a generated 4-word code

1. **Email her the link**, **text her the code** (separate channels — never
   both in one message).
2. She opens the link, enters the code, picks the file, clicks Send.
3. Decrypt: `bun decrypt.ts uploads/<newest>.enc` (it will ask for the code).
4. Confirm the `.json` is what you expect, then Ctrl-C (or `./teardown.sh`).
5. Done with the domain? `./teardown.sh --full` and delete the `drop`
   CNAME in the Cloudflare dashboard.

## Message templates

Email: "Hi <name> — here's the secure page for sending me that key file:
https://drop.saadiq.xyz. It'll ask for a short code — I'm texting that to
you separately right now. Any trouble, just call me."

Text: "Code for the secure page: <four-word-code>"

## Notes

- Wrong code is caught on her device before anything uploads.
- Every upload is timestamped in ./uploads/ — nothing is overwritten;
  she can retry freely while the server is up.
- The page's embedded verifier would allow offline guessing of the code,
  which is why start.sh generates ~60-bit passphrases. Don't replace the
  generated code with a weak one.
- Tests: `bun test`

