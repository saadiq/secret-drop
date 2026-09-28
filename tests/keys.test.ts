import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRIVATE_KEY_FILE, PUBLIC_KEY_FILE, loadKeyPair, writeKeyPair } from '../keys.ts';
import { runCli, tempDir, testPairs } from './helpers.ts';

function runKeygen(keysDir: string) {
  return runCli('keygen.ts', [], keysDir);
}

describe('keygen CLI', () => {
  test('writes a loadable pair with the private key owner-only', async () => {
    const dir = join(tempDir('keys-test-'), 'keys');
    const { code } = await runKeygen(dir);
    expect(code).toBe(0);
    expect(statSync(join(dir, PRIVATE_KEY_FILE)).mode & 0o777).toBe(0o600);
    await loadKeyPair(dir);
  });

  test('refuses to overwrite an existing pair', async () => {
    // keygen only checks that the files exist, so placeholders suffice.
    const dir = tempDir('keys-test-');
    writeFileSync(join(dir, PUBLIC_KEY_FILE), 'pub');
    writeFileSync(join(dir, PRIVATE_KEY_FILE), 'priv');
    const before = readFileSync(join(dir, PRIVATE_KEY_FILE), 'utf8');
    const { code, err } = await runKeygen(dir);
    expect(code).toBe(1);
    expect(err).toContain('already exist');
    expect(readFileSync(join(dir, PRIVATE_KEY_FILE), 'utf8')).toBe(before);
  });
});

describe('writeKeyPair', () => {
  test('a lone leftover half blocks writing, so no mismatched pair appears', async () => {
    const dir = tempDir('keys-test-');
    writeFileSync(join(dir, PRIVATE_KEY_FILE), 'priv');
    const [pair] = await testPairs();
    expect(() => writeKeyPair(dir, pair)).toThrow('already exist');
    expect(existsSync(join(dir, PUBLIC_KEY_FILE))).toBe(false);
  });
});

describe('loadKeyPair', () => {
  test('fails with a keygen hint when keys are missing', async () => {
    const dir = tempDir('keys-test-');
    await expect(loadKeyPair(dir)).rejects.toThrow('bun keygen.ts');
  });

  test('with one half missing, points at the backup rather than a bare keygen', async () => {
    const dir = tempDir('keys-test-');
    writeFileSync(join(dir, PRIVATE_KEY_FILE), '{}');
    await expect(loadKeyPair(dir)).rejects.toThrow('Restore it from your backup');
  });

  test('names the key file that is not valid JSON', async () => {
    const dir = tempDir('keys-test-');
    writeFileSync(join(dir, PUBLIC_KEY_FILE), '{');
    writeFileSync(join(dir, PRIVATE_KEY_FILE), '{}');
    await expect(loadKeyPair(dir)).rejects.toThrow(join(dir, PUBLIC_KEY_FILE));
  });

  test('fails when the two halves do not belong together', async () => {
    const dir = tempDir('keys-test-');
    const [a, b] = await testPairs();
    writeKeyPair(dir, { publicJwk: a.publicJwk, privateJwk: b.privateJwk });
    await expect(loadKeyPair(dir)).rejects.toThrow("don't match");
  });
});

describe('repo hygiene', () => {
  test('the default keys directory is git-ignored', async () => {
    for (const file of [PUBLIC_KEY_FILE, PRIVATE_KEY_FILE]) {
      const proc = Bun.spawn(['git', 'check-ignore', '-q', `keys/${file}`]);
      expect(await proc.exited).toBe(0);
    }
  });
});
