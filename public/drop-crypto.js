// Shared by the browser page, keys.ts, decrypt.ts, keygen.ts, and tests.
// WebCrypto only — identical behavior in browser and Bun.
//
// Hybrid encryption: each upload gets a fresh AES-256-GCM key, which is
// wrapped with the operator's RSA-OAEP public key. Only the private key,
// which never leaves the operator's machine, can unwrap it.
//
// The sender's filename rides inside the ciphertext, never beside it: the
// AES plaintext is a one-line JSON header, a newline, then the file bytes.
// JSON.stringify escapes newlines, so the first 0x0A always ends the header.

// Server-enforced cap on the encrypted upload body.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// Client-side cap on the raw file: after base64 (~4/3) plus JSON wrapping,
// the payload must stay under MAX_UPLOAD_BYTES.
export const MAX_RAW_FILE_BYTES = 1_500_000;

const subtle = globalThis.crypto.subtle;

const RSA = {
  name: 'RSA-OAEP',
  modulusLength: 4096,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256',
};

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

export async function generateKeyPair() {
  const pair = await subtle.generateKey(RSA, true, ['encrypt', 'decrypt']);
  return {
    publicJwk: await subtle.exportKey('jwk', pair.publicKey),
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
  };
}

export async function encryptPayload(publicJwk, fileBytes, name) {
  const header = new TextEncoder().encode(JSON.stringify({ name }) + '\n');
  const plaintextBytes = new Uint8Array(header.length + fileBytes.length);
  plaintextBytes.set(header);
  plaintextBytes.set(fileBytes, header.length);
  const publicKey = await subtle.importKey('jwk', publicJwk, RSA, false, ['encrypt']);
  const fileKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await subtle.importKey('raw', fileKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintextBytes),
  );
  const wrappedKey = new Uint8Array(await subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, fileKey));
  return { key: bytesToB64(wrappedKey), iv: bytesToB64(iv), data: bytesToB64(ciphertext) };
}

// The shape encryptPayload returns; the server checks uploads against it.
export function isPayload(obj) {
  return obj !== null && typeof obj === 'object' &&
    ['key', 'iv', 'data'].every((f) => typeof obj[f] === 'string');
}

export async function decryptPayload(privateJwk, payload) {
  const privateKey = await subtle.importKey('jwk', privateJwk, RSA, false, ['decrypt']);
  const fileKey = await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, b64ToBytes(payload.key));
  const aesKey = await subtle.importKey('raw', fileKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = new Uint8Array(await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(payload.iv) },
    aesKey,
    b64ToBytes(payload.data),
  ));
  // Anyone holding the public key can build a payload, so check the header.
  const end = plaintext.indexOf(0x0a);
  const header = end === -1 ? null : JSON.parse(new TextDecoder().decode(plaintext.subarray(0, end)));
  if (typeof header?.name !== 'string') throw new Error('Missing filename header');
  return { name: header.name, bytes: plaintext.subarray(end + 1) };
}
