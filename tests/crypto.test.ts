import { beforeAll, describe, expect, test } from 'bun:test';
import {
  b64ToBytes,
  bytesToB64,
  decryptPayload,
  encryptPayload,
} from '../public/drop-crypto.js';
import type { KeyPair } from '../keys.ts';
import { testPairs } from './helpers.ts';

const secret = new TextEncoder().encode('{"api_key":"sk-12345"}');
let pair: KeyPair;
let other: KeyPair;

beforeAll(async () => {
  [pair, other] = await testPairs();
});

describe('key pair', () => {
  test('public half carries no private material', () => {
    expect(pair.publicJwk.d).toBeUndefined();
    expect(pair.privateJwk.d).toBeString();
  });
});

describe('crypto round-trip', () => {
  test('decrypts what it encrypts, filename included', async () => {
    const payload = await encryptPayload(pair.publicJwk, secret, 'client-key.json');
    expect(typeof payload.key).toBe('string');
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.data).toBe('string');
    const out = await decryptPayload(pair.privateJwk, payload);
    expect(out.name).toBe('client-key.json');
    expect(new TextDecoder().decode(out.bytes)).toBe('{"api_key":"sk-12345"}');
  });

  test('the filename travels only inside the ciphertext', async () => {
    const payload = await encryptPayload(pair.publicJwk, secret, 'client-key.json');
    expect(JSON.stringify(payload)).not.toContain('client-key');
  });

  test('newlines in the name or the content survive the round-trip', async () => {
    const bytes = new Uint8Array([0x0a, 0x00, 0x0a, 0xff]);
    const payload = await encryptPayload(pair.publicJwk, bytes, 'odd\nname.bin');
    const out = await decryptPayload(pair.privateJwk, payload);
    expect(out.name).toBe('odd\nname.bin');
    expect(out.bytes).toEqual(bytes);
  });

  test('a different private key rejects', async () => {
    const payload = await encryptPayload(pair.publicJwk, secret, 'k.json');
    await expect(decryptPayload(other.privateJwk, payload)).rejects.toThrow();
  });

  test('tampered ciphertext rejects', async () => {
    const payload = await encryptPayload(pair.publicJwk, secret, 'k.json');
    const bytes = b64ToBytes(payload.data);
    bytes[0] ^= 0xff;
    payload.data = bytesToB64(bytes);
    await expect(decryptPayload(pair.privateJwk, payload)).rejects.toThrow();
  });

  test('file key and iv are fresh per encryption', async () => {
    const a = await encryptPayload(pair.publicJwk, secret, 'k.json');
    const b = await encryptPayload(pair.publicJwk, secret, 'k.json');
    expect(a.key).not.toBe(b.key);
    expect(a.iv).not.toBe(b.iv);
  });
});
