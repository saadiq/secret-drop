import { describe, expect, test } from 'bun:test';
import {
  encryptPayload,
  decryptPayload,
  computeVerifier,
  bytesToB64,
  b64ToBytes,
  randomSalt,
} from '../public/drop-crypto.js';

const PASS = 'correct-horse-battery-staple';
const secret = new TextEncoder().encode('{"api_key":"sk-12345"}');

describe('crypto round-trip', () => {
  test('decrypts what it encrypts', async () => {
    const payload = await encryptPayload(PASS, secret);
    expect(typeof payload.salt).toBe('string');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.data).toBe('string');
    const out = await decryptPayload(PASS, payload);
    expect(new TextDecoder().decode(out)).toBe('{"api_key":"sk-12345"}');
  });

  test('wrong passphrase rejects', async () => {
    const payload = await encryptPayload(PASS, secret);
    await expect(decryptPayload('wrong-passphrase-here-now', payload)).rejects.toThrow();
  });

  test('tampered ciphertext rejects', async () => {
    const payload = await encryptPayload(PASS, secret);
    const bytes = b64ToBytes(payload.data);
    bytes[0] ^= 0xff;
    payload.data = bytesToB64(bytes);
    await expect(decryptPayload(PASS, payload)).rejects.toThrow();
  });

  test('salt and iv are fresh per encryption', async () => {
    const a = await encryptPayload(PASS, secret);
    const b = await encryptPayload(PASS, secret);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});

describe('verifier', () => {
  test('matches for same passphrase, differs for wrong one', async () => {
    const salt = bytesToB64(randomSalt());
    const expected = await computeVerifier(PASS, salt);
    expect(await computeVerifier(PASS, salt)).toBe(expected);
    expect(await computeVerifier('typo-pass', salt)).not.toBe(expected);
  });
});
