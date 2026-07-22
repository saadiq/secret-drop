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
