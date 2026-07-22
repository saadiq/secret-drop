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
