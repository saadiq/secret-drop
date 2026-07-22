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

  test('fails cleanly when the file does not exist', async () => {
    const { code, err } = await runDecrypt('/nonexistent/upload-z.enc', PASS);
    expect(code).toBe(1);
    expect(err).toContain('Could not read');
    expect(err).not.toContain('ENOENT');
  });

  test('fails cleanly when the file is not JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dec-test-'));
    const encPath = join(dir, 'upload-bad.enc');
    await Bun.write(encPath, 'not valid json at all');
    const { code, err } = await runDecrypt(encPath, PASS);
    expect(code).toBe(1);
    expect(err).toContain('Could not read');
  });
});
