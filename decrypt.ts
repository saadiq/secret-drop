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
