import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from '../server.ts';
import { decryptPayload, encryptPayload } from '../public/drop-crypto.js';
import type { KeyPair } from '../keys.ts';
import { tempDir, tempKeysDir, testPairs } from './helpers.ts';

let pair: KeyPair;
let server: Awaited<ReturnType<typeof createServer>>;
let base: string;
let uploadsDir: string;

beforeAll(async () => {
  uploadsDir = tempDir('drop-test-');
  [pair] = await testPairs();
  server = await createServer({ keysDir: tempKeysDir(pair), port: 0, uploadsDir });
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
  // The page is built once at startup; fetch it once and assert on the string.
  let html: string;
  beforeAll(async () => {
    html = await (await fetch(`${base}/`)).text();
  });

  test('embeds the public key and nothing private', () => {
    expect(html).not.toContain('__PUBLIC_KEY_JWK__');
    expect(html).toContain(pair.publicJwk.n!);
    expect(html).not.toContain(pair.privateJwk.d!);
  });

  test('serves page with the crypto module inlined, no second script request', () => {
    expect(html).toContain('function encryptPayload');
    expect(html).not.toContain("from './drop-crypto.js'");
    expect(html).not.toContain('__DROP_CRYPTO_INLINE__');
  });

  test('page surfaces an error instead of a dead button when scripts never run', () => {
    expect(html).toContain('__dropReady');
    expect(html).toContain('could not finish loading');
    expect(html).toContain('<noscript>');
  });

  test('assembled inline module is syntactically valid', () => {
    // The substring checks above can't catch a syntax error introduced by the
    // template substitution; scan() throws on one.
    const module = html.match(/<script type="module">([\s\S]*?)<\/script>/)![1];
    expect(module).toContain('function encryptPayload');
    new Bun.Transpiler({ loader: 'js' }).scan(module);
  });
});

describe('POST /upload', () => {
  test('saves a payload that later decrypts', async () => {
    const payload = await encryptPayload(pair.publicJwk, new TextEncoder().encode('{"k":"v"}'), 'k.json');
    const res = await postJson(JSON.stringify(payload));
    expect(res.status).toBe(200);
    const files = readdirSync(uploadsDir).filter((f) => f.endsWith('.enc'));
    expect(files.length).toBe(1);
    const saved = JSON.parse(readFileSync(join(uploadsDir, files[0]), 'utf8'));
    const out = await decryptPayload(pair.privateJwk, saved);
    expect(out.name).toBe('k.json');
    expect(new TextDecoder().decode(out.bytes)).toBe('{"k":"v"}');
  });

  test('rejects oversized upload with friendly 413', async () => {
    const res = await postJson(
      JSON.stringify({ key: 'a', iv: 'b', data: 'x'.repeat(3 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error).toContain('too large');
  });

  test('rejects malformed JSON with 400', async () => {
    expect((await postJson('not json')).status).toBe(400);
  });

  test('rejects JSON null body with 400', async () => {
    expect((await postJson('null')).status).toBe(400);
  });

  test('rejects missing fields with 400', async () => {
    expect((await postJson(JSON.stringify({ key: 'only' }))).status).toBe(400);
  });
});

describe('other routes', () => {
  test('404s', async () => {
    expect((await fetch(`${base}/nope`)).status).toBe(404);
    expect((await fetch(`${base}/upload`)).status).toBe(404);
    // The crypto module is inlined into the page; no standalone route remains.
    expect((await fetch(`${base}/drop-crypto.js`)).status).toBe(404);
  });
});

describe('startup', () => {
  test('refuses to run without a generated key pair', async () => {
    const empty = tempDir('drop-keys-');
    const uploads = tempDir('drop-test-');
    await expect(createServer({ keysDir: empty, port: 0, uploadsDir: uploads })).rejects.toThrow(
      'bun keygen.ts',
    );
  });
});
