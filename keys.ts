import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptPayload, encryptPayload } from './public/drop-crypto.js';

export const PUBLIC_KEY_FILE = 'public.jwk.json';
export const PRIVATE_KEY_FILE = 'private.jwk.json';
const KEY_FILES = [PUBLIC_KEY_FILE, PRIVATE_KEY_FILE];

// Next to the code, not the cwd, so every entry point finds the same pair.
// KEYS_DIR overrides it (tests use throwaway pairs). `||`, not `??`: an empty
// KEYS_DIR would otherwise mean the cwd — e.g. the repo root, not git-ignored.
export function keysDir() {
  return process.env.KEYS_DIR || fileURLToPath(new URL('./keys', import.meta.url));
}

function readJwk(path: string): JsonWebKey {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read the key file ${path}: ${(err as Error).message}`);
  }
}

export async function loadKeyPair(dir = keysDir()): Promise<KeyPair> {
  const missing = KEY_FILES.filter((f) => !existsSync(join(dir, f)));
  if (missing.length > 0) {
    // keygen refuses while either half exists, so only suggest it for an empty dir.
    const fix = missing.length === KEY_FILES.length
      ? 'Run `bun keygen.ts` first.'
      : 'Restore it from your backup, or move the other one aside and run `bun keygen.ts`.';
    throw new Error(`Key pair not found in ${dir} (missing ${missing.join(', ')}). ${fix}`);
  }
  const publicJwk = readJwk(join(dir, PUBLIC_KEY_FILE));
  const privateJwk = readJwk(join(dir, PRIVATE_KEY_FILE));

  // A page built from a stray public key would accept uploads nobody can open.
  const probe = new Uint8Array([1, 2, 3]);
  try {
    await decryptPayload(privateJwk, await encryptPayload(publicJwk, probe, 'probe'));
  } catch {
    throw new Error(`The keys in ${dir} don't match each other. Restore the right pair, or move them aside and run \`bun keygen.ts\`.`);
  }
  return { publicJwk, privateJwk };
}

export type KeyPair = { publicJwk: JsonWebKey; privateJwk: JsonWebKey };

// Never overwrite: replacing the pair would make every upload made with the
// old one unreadable. Both files are checked so a lone leftover half can't end
// up beside a new, mismatched one. keygen calls this before the slow RSA-4096
// generation; writeKeyPair calls it again.
export function refuseExistingKeys(dir: string) {
  if (KEY_FILES.some((f) => existsSync(join(dir, f)))) {
    throw new Error(
      `Keys already exist in ${dir} — refusing to overwrite them. Uploads made with ` +
        'the current pair need its private key. Move them aside first if you really mean it.',
    );
  }
}

// Owner-only private key; 'wx' is the backstop against a race.
export function writeKeyPair(dir: string, pair: KeyPair) {
  refuseExistingKeys(dir);
  const [publicPath, privatePath] = KEY_FILES.map((f) => join(dir, f));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(publicPath, JSON.stringify(pair.publicJwk, null, 2) + '\n', { flag: 'wx' });
  try {
    writeFileSync(privatePath, JSON.stringify(pair.privateJwk, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } catch (err) {
    // Don't leave a lone public half behind: it would block the next keygen.
    unlinkSync(publicPath);
    throw err;
  }
  return [publicPath, privatePath];
}
