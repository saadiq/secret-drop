import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { decryptPayload, isPayload } from './public/drop-crypto.js';
import { loadKeyPair } from './keys.ts';

// Leaves room for the `upload-<time>-` prefix under the 255-byte filename limit.
const MAX_NAME_BYTES = 200;

// The name comes from the sender, and anyone with the link can send: basename
// keeps it inside this folder, control characters never reach the terminal or
// the filesystem, and over-long names keep their tail (the extension).
function safeName(name: string) {
  const chars = Array.from(basename(name).replace(/[\u0000-\u001f\u007f-\u009f]/g, '_'));
  while (Buffer.byteLength(chars.join('')) > MAX_NAME_BYTES) chars.shift();
  return chars.join('');
}

const path = process.argv[2];
if (!path) {
  console.error('Usage: bun decrypt.ts uploads/<file>.enc');
  process.exit(1);
}

const { privateJwk } = await loadKeyPair().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

let payload: unknown;
try {
  payload = JSON.parse(await Bun.file(path).text());
} catch {}
if (!isPayload(payload)) {
  console.error(`Could not read ${path} — is it the right file?`);
  process.exit(1);
}

let file: { name: string; bytes: Uint8Array };
try {
  file = await decryptPayload(privateJwk, payload);
} catch {
  console.error('Decryption failed: made with a different key pair, or the file is corrupted/tampered.');
  process.exit(1);
}

// The upload's own prefix keeps two same-named files from colliding.
const outPath = `${path.replace(/\.enc$/, '')}-${safeName(file.name)}`;
try {
  // Owner-only, like the private key: this is the plaintext secret.
  writeFileSync(outPath, file.bytes, { mode: 0o600 });
} catch (err) {
  console.error(`Decrypted, but could not write ${outPath}: ${(err as Error).message}`);
  process.exit(1);
}
console.log(`Decrypted → ${outPath}`);
