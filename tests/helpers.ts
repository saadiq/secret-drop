import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../public/drop-crypto.js';
import { type KeyPair, writeKeyPair } from '../keys.ts';

// RSA-4096 generation is slow and jittery; bun test runs every file in one
// process, so the whole suite shares these two pairs.
let pairs: Promise<[KeyPair, KeyPair]> | undefined;
export function testPairs() {
  return (pairs ??= Promise.all([generateKeyPair(), generateKeyPair()]));
}

export function tempDir(prefix: string) {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function tempKeysDir(pair: KeyPair) {
  const dir = tempDir('keys-');
  writeKeyPair(dir, pair);
  return dir;
}

export async function runCli(script: string, args: string[], keysDir: string) {
  const proc = Bun.spawn(['bun', script, ...args], {
    env: { ...process.env, KEYS_DIR: keysDir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  return { code, err: await new Response(proc.stderr).text() };
}
