# secret-drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-run Bun web app at `https://drop.saadiq.xyz` (named Cloudflare tunnel) where a non-technical client uploads a secret-key JSON file that is end-to-end encrypted in her browser before upload and decrypted on this machine with a CLI.

**Architecture:** One shared WebCrypto module (`public/drop-crypto.js`) is imported by the browser page, the Bun server (for the passphrase verifier), the decrypt CLI, and the tests — the exact code the browser runs is the code the tests exercise. The server binds `127.0.0.1:8787` only; a named `cloudflared` tunnel is the sole public path. Shell scripts handle tunnel setup, run, and teardown.

**Tech Stack:** Bun (server, tests, CLI), WebCrypto (PBKDF2-SHA256 + AES-256-GCM), vanilla HTML/JS (no build step), cloudflared.

**Spec:** `docs/superpowers/specs/2026-07-22-secret-drop-design.md`

## Global Constraints

- Use `bun` / `bunx`, never npm/npx. No runtime dependencies — Bun built-ins and WebCrypto only.
- Max 300 lines per file (error); max 100 lines per function.
- PBKDF2-SHA256, **600,000 iterations**; AES-256-GCM; 16-byte random salt per upload; 12-byte random IV.
- Upload payload JSON shape: `{ "salt": string, "iv": string, "data": string }` — all base64.
- **Passphrases are always lowercase words joined by hyphens** (e.g. `plum-otter-band-echo`). The page lowercases input; generation and decryption must respect this invariant. The server normalizes (trim + lowercase) before deriving the verifier.
- Server binds `127.0.0.1` only, port `8787`. Upload size cap 2 MB (friendly 413).
- Public hostname: `drop.saadiq.xyz`. Tunnel name: `secret-drop`. Zone: `saadiq.xyz`.
- Page copy addresses the client warmly and never uses jargon (no "PBKDF2", no "payload").
- Every commit message ends with the trailer:
  `Claude-Session: https://claude.ai/code/session_01WUaBEmmQnwjc4tALtbH6U4`

---

### Task 1: Scaffolding + shared crypto module

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `public/drop-crypto.js`
- Test: `tests/crypto.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces (used by every later task):
  - `PBKDF2_ITERATIONS: number`
  - `bytesToB64(bytes: Uint8Array): string` / `b64ToBytes(b64: string): Uint8Array`
  - `encryptPayload(passphrase: string, plaintextBytes: Uint8Array): Promise<{salt: string, iv: string, data: string}>`
  - `decryptPayload(passphrase: string, payload: {salt, iv, data}): Promise<Uint8Array>` — rejects on wrong passphrase / tampering (GCM tag failure)
  - `computeVerifier(passphrase: string, saltB64: string): Promise<string>` — base64(SHA-256(PBKDF2 bits))

- [ ] **Step 1: Create scaffolding**

`package.json`:
```json
{
  "name": "secret-drop",
  "private": true,
  "scripts": {
    "test": "bun test"
  }
}
```

`.gitignore`:
```
uploads/
.run/
cloudflared-config.yml
node_modules/
```

- [ ] **Step 2: Write the failing tests**

`tests/crypto.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import {
  encryptPayload,
  decryptPayload,
  computeVerifier,
  bytesToB64,
} from '../public/drop-crypto.js';

const PASS = 'correct-horse-battery-staple';
const secret = new TextEncoder().encode('{"api_key":"sk-12345"}');

describe('crypto round-trip', () => {
  test('decrypts what it encrypts', async () => {
    const payload = await encryptPayload(PASS, secret);
    expect(typeof payload.salt).toBe('string');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.data).toBe('string');
    const out = await decryptPayload(PASS, payload);
    expect(new TextDecoder().decode(out)).toBe('{"api_key":"sk-12345"}');
  });

  test('wrong passphrase rejects', async () => {
    const payload = await encryptPayload(PASS, secret);
    await expect(decryptPayload('wrong-passphrase-here-now', payload)).rejects.toThrow();
  });

  test('tampered ciphertext rejects', async () => {
    const payload = await encryptPayload(PASS, secret);
    const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    payload.data = btoa(String.fromCharCode(...bytes));
    await expect(decryptPayload(PASS, payload)).rejects.toThrow();
  });

  test('salt and iv are fresh per encryption', async () => {
    const a = await encryptPayload(PASS, secret);
    const b = await encryptPayload(PASS, secret);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe('verifier', () => {
  test('matches for same passphrase, differs for wrong one', async () => {
    const salt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
    const expected = await computeVerifier(PASS, salt);
    expect(await computeVerifier(PASS, salt)).toBe(expected);
    expect(await computeVerifier('typo-pass', salt)).not.toBe(expected);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/crypto.test.ts`
Expected: FAIL — cannot resolve `../public/drop-crypto.js`.

- [ ] **Step 4: Implement the crypto module**

`public/drop-crypto.js`:
```js
// Shared by the browser page, the Bun server, decrypt.ts, and tests.
// WebCrypto only — identical behavior in browser and Bun.
export const PBKDF2_ITERATIONS = 600_000;

const subtle = globalThis.crypto.subtle;

export function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBits(passphrase, salt) {
  const material = await subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    256,
  );
  return new Uint8Array(bits);
}

async function deriveKey(passphrase, salt, usages) {
  const bits = await deriveBits(passphrase, salt);
  return subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, usages);
}

export async function encryptPayload(passphrase, plaintextBytes) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ['encrypt']);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes),
  );
  return { salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(ciphertext) };
}

export async function decryptPayload(passphrase, payload) {
  const key = await deriveKey(passphrase, b64ToBytes(payload.salt), ['decrypt']);
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.iv) },
    key,
    b64ToBytes(payload.data),
  );
  return new Uint8Array(plaintext);
}

export async function computeVerifier(passphrase, saltB64) {
  const bits = await deriveBits(passphrase, b64ToBytes(saltB64));
  const hash = new Uint8Array(await subtle.digest('SHA-256', bits));
  return bytesToB64(hash);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/crypto.test.ts`
Expected: PASS, 5 tests. (PBKDF2 at 600k iterations runs ~0.2–0.5 s per derivation — a few seconds total is normal.)

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore public/drop-crypto.js tests/crypto.test.ts
git commit -m "feat: shared WebCrypto module (PBKDF2 600k + AES-256-GCM) with tests"
```

---

### Task 2: Bun server with verifier injection and upload endpoint

**Files:**
- Create: `server.ts`
- Create: `public/index.html` (minimal stub — Task 4 replaces it with the real page; keep the placeholder tokens)
- Test: `tests/server.test.ts`

**Interfaces:**
- Consumes: `computeVerifier`, `bytesToB64`, `encryptPayload`, `decryptPayload` from `public/drop-crypto.js` (Task 1).
- Produces:
  - `createServer(opts: { pass: string; port?: number; uploadsDir?: string }): Promise<Bun.Server>` — port defaults 8787, uploadsDir defaults `'uploads'`; binds `127.0.0.1`.
  - Page template tokens `__VERIFIER_SALT__` and `__VERIFIER_HASH__` (each appears exactly once in `public/index.html`; server replaces both at startup).
  - Routes: `GET /` (page), `GET /drop-crypto.js`, `POST /upload` (200 `{ok:true}` | 400 | 413), else 404.
  - Saved upload files: `<uploadsDir>/upload-<ISO timestamp, colons→hyphens>.enc` containing the payload JSON verbatim.
  - Run directly: `PASS="..." bun server.ts` (exits 1 with a usage message if `PASS` unset).

- [ ] **Step 1: Create the page stub**

`public/index.html` (stub — real page comes in Task 4; the tokens and script reference must survive):
```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Secure file drop</title></head>
<body>
<p>Placeholder page — real UI arrives in Task 4.</p>
<script type="module">
  import { computeVerifier } from './drop-crypto.js';
  const VERIFIER_SALT = '__VERIFIER_SALT__';
  const VERIFIER_HASH = '__VERIFIER_HASH__';
  console.log(VERIFIER_SALT, VERIFIER_HASH, typeof computeVerifier);
</script>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests**

`tests/server.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.ts';
import { decryptPayload, encryptPayload } from '../public/drop-crypto.js';

const PASS = 'plum-otter-band-echo';
let server: Awaited<ReturnType<typeof createServer>>;
let base: string;
let uploadsDir: string;

beforeAll(async () => {
  uploadsDir = mkdtempSync(join(tmpdir(), 'drop-test-'));
  server = await createServer({ pass: PASS, port: 0, uploadsDir });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => server.stop(true));

function postJson(body: string) {
  return fetch(`${base}/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('GET /', () => {
  test('serves page with verifier tokens replaced', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain('__VERIFIER_SALT__');
    expect(html).not.toContain('__VERIFIER_HASH__');
    expect(html).toContain('drop-crypto.js');
  });

  test('serves the crypto module', async () => {
    const res = await fetch(`${base}/drop-crypto.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('encryptPayload');
  });
});

describe('POST /upload', () => {
  test('saves a payload that later decrypts', async () => {
    const payload = await encryptPayload(PASS, new TextEncoder().encode('{"k":"v"}'));
    const res = await postJson(JSON.stringify(payload));
    expect(res.status).toBe(200);
    const files = readdirSync(uploadsDir).filter((f) => f.endsWith('.enc'));
    expect(files.length).toBe(1);
    const saved = JSON.parse(readFileSync(join(uploadsDir, files[0]), 'utf8'));
    const out = await decryptPayload(PASS, saved);
    expect(new TextDecoder().decode(out)).toBe('{"k":"v"}');
  });

  test('rejects oversized upload with friendly 413', async () => {
    const res = await postJson(
      JSON.stringify({ salt: 'a', iv: 'b', data: 'x'.repeat(3 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain('too large');
  });

  test('rejects malformed JSON with 400', async () => {
    expect((await postJson('not json')).status).toBe(400);
  });

  test('rejects missing fields with 400', async () => {
    expect((await postJson(JSON.stringify({ salt: 'only' }))).status).toBe(400);
  });
});

describe('other routes', () => {
  test('404s', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/upload`)).status).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/server.test.ts`
Expected: FAIL — cannot resolve `../server.ts`.

- [ ] **Step 4: Implement the server**

`server.ts`:
```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToB64, computeVerifier } from './public/drop-crypto.js';

const MAX_BYTES = 2 * 1024 * 1024;

export interface ServerOptions {
  pass: string;
  port?: number;
  uploadsDir?: string;
}

export async function createServer(opts: ServerOptions) {
  const uploadsDir = opts.uploadsDir ?? 'uploads';
  mkdirSync(uploadsDir, { recursive: true });

  const verifierSalt = bytesToB64(crypto.getRandomValues(new Uint8Array(16)));
  const verifierHash = await computeVerifier(opts.pass, verifierSalt);
  const template = await Bun.file(new URL('./public/index.html', import.meta.url)).text();
  const page = template
    .replace('__VERIFIER_SALT__', verifierSalt)
    .replace('__VERIFIER_HASH__', verifierHash);

  return Bun.serve({
    hostname: '127.0.0.1',
    port: opts.port ?? 8787,
    // Backstop only — the friendly 413 below fires first via Content-Length.
    maxRequestBodySize: MAX_BYTES * 2,
    async fetch(req) {
      const path = new URL(req.url).pathname;

      if (req.method === 'GET' && path === '/') {
        return new Response(page, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }

      if (req.method === 'GET' && path === '/drop-crypto.js') {
        return new Response(Bun.file(new URL('./public/drop-crypto.js', import.meta.url)));
      }

      if (req.method === 'POST' && path === '/upload') {
        const length = Number(req.headers.get('content-length') ?? '0');
        if (length > MAX_BYTES) {
          return json(413, { error: 'That file is too large (limit 2 MB).' });
        }
        let payload: { salt?: unknown; iv?: unknown; data?: unknown };
        try {
          payload = await req.json();
        } catch {
          return json(400, { error: 'Could not read the upload. Please try again.' });
        }
        if (
          typeof payload.salt !== 'string' ||
          typeof payload.iv !== 'string' ||
          typeof payload.data !== 'string'
        ) {
          return json(400, { error: 'Could not read the upload. Please try again.' });
        }
        const stamp = new Date().toISOString().replaceAll(':', '-');
        const dest = join(uploadsDir, `upload-${stamp}.enc`);
        const body = JSON.stringify(payload);
        await Bun.write(dest, body);
        console.log(`[${new Date().toISOString()}] saved ${dest} (${body.length} bytes)`);
        return json(200, { ok: true });
      }

      return json(404, { error: 'Not found' });
    },
  });
}

function json(status: number, body: object) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

if (import.meta.main) {
  const pass = process.env.PASS;
  if (!pass) {
    console.error('PASS is required, e.g.: PASS="plum-otter-band-echo" bun server.ts');
    process.exit(1);
  }
  const server = await createServer({ pass });
  console.log(`secret-drop listening on http://${server.hostname}:${server.port}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/server.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Run the full suite**

Run: `bun test`
Expected: PASS — crypto + server suites, 12 tests total.

- [ ] **Step 7: Commit**

```bash
git add server.ts public/index.html tests/server.test.ts
git commit -m "feat: localhost-only Bun server with verifier injection and upload endpoint"
```

---

### Task 3: Decrypt CLI

**Files:**
- Create: `decrypt.ts`
- Test: `tests/decrypt.test.ts`

**Interfaces:**
- Consumes: `decryptPayload`, `encryptPayload` from `public/drop-crypto.js` (Task 1); `.enc` file format from Task 2 (payload JSON verbatim).
- Produces: CLI `bun decrypt.ts <path>.enc` — passphrase from `PASS` env var or interactive `prompt()`; lowercases/trims it (matches the page's normalization); writes `<path>.json` beside the input; exit 0 on success, exit 1 + `Decryption failed` on stderr for wrong passphrase/tampering.

- [ ] **Step 1: Write the failing tests**

`tests/decrypt.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encryptPayload } from '../public/drop-crypto.js';

const PASS = 'plum-otter-band-echo';

async function writeEnc(name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'dec-test-'));
  const payload = await encryptPayload(PASS, new TextEncoder().encode('{"k":"v"}'));
  const encPath = join(dir, name);
  await Bun.write(encPath, JSON.stringify(payload));
  return { dir, encPath };
}

async function runDecrypt(encPath: string, pass: string) {
  const proc = Bun.spawn(['bun', 'decrypt.ts', encPath], {
    env: { ...process.env, PASS: pass },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  return { code, err: await new Response(proc.stderr).text() };
}

describe('decrypt CLI', () => {
  test('writes decrypted json next to the .enc file', async () => {
    const { dir, encPath } = await writeEnc('upload-a.enc');
    const { code } = await runDecrypt(encPath, PASS);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'upload-a.json'), 'utf8')).toBe('{"k":"v"}');
  });

  test('normalizes passphrase case/whitespace like the page does', async () => {
    const { dir, encPath } = await writeEnc('upload-b.enc');
    const { code } = await runDecrypt(encPath, '  Plum-Otter-Band-Echo ');
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'upload-b.json'), 'utf8')).toBe('{"k":"v"}');
  });

  test('fails cleanly on wrong passphrase', async () => {
    const { encPath } = await writeEnc('upload-c.enc');
    const { code, err } = await runDecrypt(encPath, 'wrong-words-here-now');
    expect(code).toBe(1);
    expect(err).toContain('Decryption failed');
  });

  test('fails with usage message when no path given', async () => {
    const proc = Bun.spawn(['bun', 'decrypt.ts'], { stdout: 'pipe', stderr: 'pipe' });
    expect(await proc.exited).toBe(1);
    expect(await new Response(proc.stderr).text()).toContain('Usage');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/decrypt.test.ts`
Expected: FAIL — `bun decrypt.ts` exits non-zero with a module-not-found error, so the first two tests fail on exit code / missing output file.

- [ ] **Step 3: Implement the CLI**

`decrypt.ts`:
```ts
import { decryptPayload } from './public/drop-crypto.js';

const path = process.argv[2];
if (!path) {
  console.error('Usage: bun decrypt.ts uploads/<file>.enc');
  process.exit(1);
}

const raw = process.env.PASS ?? prompt('Passphrase:');
if (!raw) {
  console.error('No passphrase given.');
  process.exit(1);
}
const passphrase = raw.trim().toLowerCase();

const payload = JSON.parse(await Bun.file(path).text());
try {
  const plaintext = await decryptPayload(passphrase, payload);
  const outPath = path.replace(/\.enc$/, '') + '.json';
  await Bun.write(outPath, plaintext);
  console.log(`Decrypted → ${outPath}`);
} catch {
  console.error('Decryption failed: wrong passphrase, or the file is corrupted/tampered.');
  process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/decrypt.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add decrypt.ts tests/decrypt.test.ts
git commit -m "feat: decrypt CLI with passphrase normalization"
```

---

### Task 4: Real upload page + local end-to-end check

**Files:**
- Modify: `public/index.html` (replace the Task 2 stub entirely)

**Interfaces:**
- Consumes: `encryptPayload`, `computeVerifier` from `/drop-crypto.js`; `__VERIFIER_SALT__` / `__VERIFIER_HASH__` tokens (Task 2); `POST /upload` contract (Task 2).
- Produces: the client-facing page. Normalizes the code with `.trim().toLowerCase()` (same as `decrypt.ts`). Client-side file cap 1.5 MB (base64 expansion keeps the request under the 2 MB server cap).

- [ ] **Step 1: Replace the stub with the real page**

`public/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Send a file to Saadiq — securely</title>
<style>
  body {
    font-family: -apple-system, system-ui, sans-serif;
    margin: 0; min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    background: #f2f4f8; color: #1a1a2e;
  }
  main {
    background: #fff; border-radius: 16px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    padding: 32px; max-width: 420px; width: calc(100% - 48px);
    margin: 24px 0;
  }
  h1 { font-size: 1.3rem; margin: 0 0 8px; }
  p { color: #555; line-height: 1.5; margin: 8px 0; }
  label { display: block; font-weight: 600; margin: 20px 0 6px; }
  input {
    width: 100%; box-sizing: border-box; padding: 12px;
    border: 1px solid #ccc; border-radius: 10px; font-size: 1rem;
    background: #fff; color: inherit;
  }
  button {
    margin-top: 24px; width: 100%; padding: 14px;
    border: 0; border-radius: 10px;
    background: #0a7cff; color: #fff;
    font-size: 1.05rem; font-weight: 600; cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .hint { font-size: 0.85rem; color: #888; margin: 6px 0 0; }
  .error { color: #c0392b; margin-top: 12px; min-height: 1.2em; }
  .success { text-align: center; }
  .success .check { font-size: 3rem; }
  .hidden { display: none; }
</style>
</head>
<body>
<main>
  <div id="form-view">
    <h1>Send your file to Saadiq</h1>
    <p>This page locks your file on your own device before it travels —
       only Saadiq can unlock it.</p>
    <label for="code">Code from Saadiq's text message</label>
    <input id="code" type="password" autocomplete="off" autocapitalize="none"
           placeholder="the-four-word-code">
    <label for="file">Your file</label>
    <input id="file" type="file">
    <p class="hint">Usually a small file ending in <b>.json</b> — the one Saadiq asked you for.</p>
    <button id="send">Send securely</button>
    <p id="error" class="error"></p>
  </div>
  <div id="done-view" class="success hidden">
    <div class="check">✅</div>
    <h1>Received — all set!</h1>
    <p>Your file was locked and delivered safely. You can close this page.
       Feel free to send again if Saadiq asks for a redo.</p>
    <button id="again">Send another file</button>
  </div>
</main>
<script type="module">
  import { computeVerifier, encryptPayload } from './drop-crypto.js';

  const VERIFIER_SALT = '__VERIFIER_SALT__';
  const VERIFIER_HASH = '__VERIFIER_HASH__';
  const MAX_FILE_BYTES = 1_500_000;

  const codeEl = document.getElementById('code');
  const fileEl = document.getElementById('file');
  const sendEl = document.getElementById('send');
  const errorEl = document.getElementById('error');
  const formView = document.getElementById('form-view');
  const doneView = document.getElementById('done-view');

  document.getElementById('again').addEventListener('click', () => {
    doneView.classList.add('hidden');
    formView.classList.remove('hidden');
  });

  sendEl.addEventListener('click', async () => {
    errorEl.textContent = '';
    const code = codeEl.value.trim().toLowerCase();
    const file = fileEl.files[0];
    if (!code) return showError('Please enter the code from the text message.');
    if (!file) return showError('Please choose the file to send.');
    if (file.size > MAX_FILE_BYTES) {
      return showError('That file looks too large for a key file — please double-check, or contact Saadiq.');
    }

    sendEl.disabled = true;
    sendEl.textContent = 'Locking…';
    try {
      const verifier = await computeVerifier(code, VERIFIER_SALT);
      if (verifier !== VERIFIER_HASH) {
        return showError("That code doesn't match — please check the text message and try again.");
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const payload = await encryptPayload(code, bytes);
      sendEl.textContent = 'Sending…';
      const res = await fetch('/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return showError(body.error ?? 'Something went wrong — please try again.');
      }
      formView.classList.add('hidden');
      doneView.classList.remove('hidden');
    } catch {
      showError('Something went wrong — please check your connection and try again.');
    } finally {
      sendEl.disabled = false;
      sendEl.textContent = 'Send securely';
    }
  });

  function showError(msg) {
    errorEl.textContent = msg;
  }
</script>
</body>
</html>
```

- [ ] **Step 2: Confirm the automated suite still passes**

Run: `bun test`
Expected: PASS — the server tests assert the tokens are still present-and-replaced and `drop-crypto.js` is still referenced.

- [ ] **Step 3: Manual local end-to-end**

```bash
mkdir -p uploads
PASS="plum-otter-band-echo" bun server.ts
```

In a browser at `http://127.0.0.1:8787`:
1. Wrong code (`nope`) + any file → inline error "That code doesn't match…", nothing uploaded.
2. Correct code `plum-otter-band-echo` + a small test JSON file → success view.
3. Verify decryption:

```bash
ls uploads/            # one upload-<timestamp>.enc
PASS="plum-otter-band-echo" bun decrypt.ts uploads/upload-<timestamp>.enc
cat uploads/upload-<timestamp>.json   # exact original file content
```

(Executor note: if no browser automation is available, verify steps 1–2 by driving the page's own module from Bun against the running server — fetch `/`, extract the injected salt/hash with a regex, `computeVerifier('nope', salt) !== hash` proves the wrong-code path, then `encryptPayload` + `fetch('/upload')` and decrypt the saved file. The click-through in a real browser then happens in Task 6's public E2E, which cannot be skipped.)

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: client-facing upload page with in-browser encryption"
```

---

### Task 5: Tunnel scripts — setup, start, teardown

**Files:**
- Create: `setup.sh`, `start.sh`, `teardown.sh` (all `chmod +x`)

**Interfaces:**
- Consumes: `server.ts` run form `PASS=… bun server.ts` (Task 2); cloudflared auth already on machine (`~/.cloudflared/cert.pem`).
- Produces:
  - `./setup.sh` — one-time: ensures tunnel `secret-drop` exists, writes `cloudflared-config.yml` (gitignored), routes DNS for `drop.saadiq.xyz`; exits 1 with a "run cloudflared tunnel login" hint if the cert is scoped to the wrong zone.
  - `./start.sh` — generates a 4-word lowercase passphrase (or honors `PASS`), starts server + tunnel, writes `.run/server.pid` / `.run/tunnel.pid`, prints link + code, stays in foreground; Ctrl-C tears down.
  - `./teardown.sh [--full]` — kills PIDs; `--full` also deletes the tunnel and prints the DNS-record cleanup reminder.

- [ ] **Step 1: Write setup.sh**

`setup.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

TUNNEL_NAME="secret-drop"
PUBLIC_HOSTNAME="drop.saadiq.xyz"
PORT=8787

existing_id() {
  cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2 == n { print $1 }'
}

TUNNEL_ID="$(existing_id)"
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Creating tunnel $TUNNEL_NAME…"
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID="$(existing_id)"
fi
echo "Tunnel: $TUNNEL_NAME ($TUNNEL_ID)"

cat > cloudflared-config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $PUBLIC_HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
EOF

echo "Routing DNS $PUBLIC_HOSTNAME → tunnel…"
if ! cloudflared tunnel route dns "$TUNNEL_NAME" "$PUBLIC_HOSTNAME"; then
  echo ""
  echo "DNS routing failed. Your cert.pem is likely scoped to a different zone."
  echo "Fix: cloudflared tunnel login   (pick the saadiq.xyz zone), then re-run ./setup.sh"
  exit 1
fi
echo "Setup complete. Run ./start.sh next."
```

- [ ] **Step 2: Write start.sh**

`start.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PUBLIC_HOSTNAME="drop.saadiq.xyz"

if [[ ! -f cloudflared-config.yml ]]; then
  echo "cloudflared-config.yml missing — run ./setup.sh first." >&2
  exit 1
fi

if [[ -z "${PASS:-}" ]]; then
  PASS="$(bun -e '
    const words = (await Bun.file("/usr/share/dict/words").text())
      .split("\n").filter((w) => /^[a-z]{4,7}$/.test(w));
    const pick = () =>
      words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
    console.log([pick(), pick(), pick(), pick()].join("-"));
  ')"
fi
export PASS

mkdir -p .run uploads
bun server.ts &
echo $! > .run/server.pid
cloudflared tunnel --config cloudflared-config.yml run &
echo $! > .run/tunnel.pid

sleep 3
echo ""
echo "================================================="
echo "  Link (email it):   https://$PUBLIC_HOSTNAME"
echo "  Code (text it):    $PASS"
echo "================================================="
echo "  Uploads land in ./uploads/ — decrypt with:"
echo "  PASS=\"$PASS\" bun decrypt.ts uploads/<file>.enc"
echo "  Ctrl-C stops everything."
echo ""

trap './teardown.sh' INT TERM
wait
```

- [ ] **Step 3: Write teardown.sh**

`teardown.sh`:
```bash
#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"

for pidfile in .run/server.pid .run/tunnel.pid; do
  if [[ -f "$pidfile" ]]; then
    kill "$(cat "$pidfile")" 2>/dev/null && echo "Stopped $(basename "$pidfile" .pid)."
    rm -f "$pidfile"
  fi
done

if [[ "${1:-}" == "--full" ]]; then
  cloudflared tunnel delete -f secret-drop && echo "Tunnel deleted."
  echo "NOTE: also delete the 'drop' CNAME in the Cloudflare dashboard"
  echo "      (dash.cloudflare.com → saadiq.xyz → DNS → records)."
fi
```

- [ ] **Step 4: Make executable and sanity-check locally (no tunnel yet)**

```bash
chmod +x setup.sh start.sh teardown.sh
bash -n setup.sh start.sh teardown.sh   # syntax check, no output expected
bun -e '
  const words = (await Bun.file("/usr/share/dict/words").text())
    .split("\n").filter((w) => /^[a-z]{4,7}$/.test(w));
  console.log("dict words usable:", words.length);
'
```
Expected: `bash -n` silent; word count > 20,000 (≈60+ bits of entropy for 4 words).

- [ ] **Step 5: Run real setup**

Run: `./setup.sh`
Expected: `Tunnel: secret-drop (<uuid>)`, `Setup complete.` — and a `cloudflared-config.yml` appears (gitignored).
**If it prints the "cert.pem is likely scoped to a different zone" message: STOP and ask the user to run `! cloudflared tunnel login` (choosing the saadiq.xyz zone), then re-run `./setup.sh`.**

- [ ] **Step 6: Commit**

```bash
git add setup.sh start.sh teardown.sh
git commit -m "feat: tunnel setup, start, and teardown scripts"
```

---

### Task 6: Public end-to-end verification + README

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: verified public deployment + operator runbook with copy-paste messages for the client.

- [ ] **Step 1: Start the service**

```bash
./start.sh
```
Expected: banner with `https://drop.saadiq.xyz` and a generated 4-word code. Note both for the next steps.

- [ ] **Step 2: Verify the public endpoint**

```bash
curl -s https://drop.saadiq.xyz/ | grep -c "Send your file"     # → 1
curl -s https://drop.saadiq.xyz/ | grep -c "__VERIFIER"         # → 0
curl -s -o /dev/null -w "%{http_code}" https://drop.saadiq.xyz/nope   # → 404
```
(DNS may take ~1–2 minutes on first setup; retry if the first curl fails.)

- [ ] **Step 3: Full browser E2E over the public URL**

In a real browser at `https://drop.saadiq.xyz`:
1. Padlock/TLS present.
2. Wrong code → "That code doesn't match…" error, no upload.
3. Correct code + small test JSON file → success screen.

Then on this machine:
```bash
ls uploads/                                        # new .enc file
PASS="<the generated code>" bun decrypt.ts uploads/<newest>.enc
cat uploads/<newest>.json                          # original content, byte-for-byte
```

- [ ] **Step 4: Verify teardown**

```bash
./teardown.sh          # NOT --full — keep the tunnel for the real exchange
curl -s -o /dev/null -m 10 -w "%{http_code}" https://drop.saadiq.xyz/   # 5xx or timeout — origin down
```

- [ ] **Step 5: Write the README**

`README.md`:
```markdown
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
3. Decrypt: `PASS="<code>" bun decrypt.ts uploads/<newest>.enc`
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

```

- [ ] **Step 6: Full test suite one last time**

Run: `bun test`
Expected: PASS, all suites green.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: operator runbook and client message templates"
```

---

## Post-plan verification (execution-time reminders)

- The real client exchange (emailing the link, texting the code) is the user's step, not the executor's — stop after Task 6 and report the link + how to start.
- `start.sh` prints the passphrase to the terminal by design (the operator must text it); it is never written to disk.
- If Bun's `maxRequestBodySize` behavior changes the 413 test (edge Bun versions), the Content-Length check in `server.ts` is authoritative — debug there first.
