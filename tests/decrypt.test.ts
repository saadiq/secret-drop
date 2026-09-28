import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { encryptPayload } from '../public/drop-crypto.js';
import type { KeyPair } from '../keys.ts';
import { runCli, tempDir, tempKeysDir, testPairs } from './helpers.ts';

let pair: KeyPair;
let other: KeyPair;
let keysDir: string;

beforeAll(async () => {
  [pair, other] = await testPairs();
  keysDir = tempKeysDir(pair);
});

async function writeEnc(
  name: string,
  content: string | Uint8Array = '{"k":"v"}',
  fileName = 'key.json',
) {
  const dir = tempDir('dec-test-');
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const payload = await encryptPayload(pair.publicJwk, bytes, fileName);
  const encPath = join(dir, name);
  await Bun.write(encPath, JSON.stringify(payload));
  return { dir, encPath };
}

function runDecrypt(args: string[], keys = keysDir) {
  return runCli('decrypt.ts', args, keys);
}

describe('decrypt CLI', () => {
  test("writes the file next to the .enc under the sender's filename", async () => {
    const text = 'dev key: abc123\ntoken: xyz789\n';
    const { dir, encPath } = await writeEnc('upload-a.enc', text, 'client.env');
    const { code } = await runDecrypt([encPath]);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'upload-a-client.env'), 'utf8')).toBe(text);
  });

  test('writes binary content byte for byte', async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80]);
    const { dir, encPath } = await writeEnc('upload-x.enc', bytes, 'cert.p12');
    const { code } = await runDecrypt([encPath]);
    expect(code).toBe(0);
    expect(new Uint8Array(readFileSync(join(dir, 'upload-x-cert.p12')))).toEqual(bytes);
  });

  test('keeps a path-like filename from escaping the upload folder', async () => {
    const { dir, encPath } = await writeEnc('upload-p.enc', 'x', '../../escape.txt');
    const { code } = await runDecrypt([encPath]);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'upload-p-escape.txt'), 'utf8')).toBe('x');
  });

  test('strips control characters so the name cannot drive the terminal', async () => {
    const { dir, encPath } = await writeEnc('upload-e.enc', 'x', 'a\u001b]0;hi\u0007.txt');
    const { code } = await runDecrypt([encPath]);
    expect(code).toBe(0);
    expect(readFileSync(join(dir, 'upload-e-a_]0;hi_.txt'), 'utf8')).toBe('x');
  });

  test('shortens an over-long name, keeping its extension', async () => {
    const { dir, encPath } = await writeEnc('upload-l.enc', 'x', `${'n'.repeat(250)}.txt`);
    const { code } = await runDecrypt([encPath]);
    expect(code).toBe(0);
    const written = readdirSync(dir).find((f) => f.startsWith('upload-l-'))!;
    expect(written.endsWith('.txt')).toBe(true);
    expect(readFileSync(join(dir, written), 'utf8')).toBe('x');
  });

  test('writes the plaintext owner-only', async () => {
    const { dir, encPath } = await writeEnc('upload-m.enc', 'x', 'secret.txt');
    await runDecrypt([encPath]);
    expect(statSync(join(dir, 'upload-m-secret.txt')).mode & 0o777).toBe(0o600);
  });

  test('fails cleanly with a different key pair', async () => {
    const { encPath } = await writeEnc('upload-c.enc');
    const otherKeys = tempKeysDir(other);
    const { code, err } = await runDecrypt([encPath], otherKeys);
    expect(code).toBe(1);
    expect(err).toContain('Decryption failed');
  });

  test('fails with a keygen hint when there are no keys', async () => {
    const { encPath } = await writeEnc('upload-k.enc');
    const { code, err } = await runDecrypt([encPath], tempDir('dec-keys-'));
    expect(code).toBe(1);
    expect(err).toContain('bun keygen.ts');
  });

  test('fails with usage message when no path given', async () => {
    const { code, err } = await runDecrypt([]);
    expect(code).toBe(1);
    expect(err).toContain('Usage');
  });

  test('fails cleanly when the file does not exist', async () => {
    const { code, err } = await runDecrypt(['/nonexistent/upload-z.enc']);
    expect(code).toBe(1);
    expect(err).toContain('Could not read');
    expect(err).not.toContain('ENOENT');
  });

  test('fails cleanly when the file is not JSON', async () => {
    const dir = tempDir('dec-test-');
    const encPath = join(dir, 'upload-bad.enc');
    await Bun.write(encPath, 'not valid json at all');
    const { code, err } = await runDecrypt([encPath]);
    expect(code).toBe(1);
    expect(err).toContain('Could not read');
  });

  test('fails cleanly on JSON that is not an upload (e.g. a passphrase-era one)', async () => {
    const dir = tempDir('dec-test-');
    const encPath = join(dir, 'upload-old.enc');
    await Bun.write(encPath, JSON.stringify({ salt: 'AAAA', iv: 'AAAA', data: 'AAAA' }));
    const { code, err } = await runDecrypt([encPath]);
    expect(code).toBe(1);
    expect(err).toContain('Could not read');
  });
});
