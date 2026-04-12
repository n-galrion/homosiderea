import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../src/shared/crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes in hex

describe('crypto', () => {
  it('encrypts and decrypts a string', () => {
    const plaintext = 'sk-my-secret-api-key-12345';
    const ciphertext = encrypt(plaintext, TEST_KEY);
    expect(ciphertext).not.toEqual(plaintext);
    expect(ciphertext).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    const decrypted = decrypt(ciphertext, TEST_KEY);
    expect(decrypted).toEqual(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'same-input';
    const c1 = encrypt(plaintext, TEST_KEY);
    const c2 = encrypt(plaintext, TEST_KEY);
    expect(c1).not.toEqual(c2);
    expect(decrypt(c1, TEST_KEY)).toEqual(plaintext);
    expect(decrypt(c2, TEST_KEY)).toEqual(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('test', TEST_KEY);
    const parts = ciphertext.split(':');
    parts[2] = 'ff' + parts[2].slice(2);
    expect(() => decrypt(parts.join(':'), TEST_KEY)).toThrow();
  });

  it('throws on wrong key', () => {
    const ciphertext = encrypt('test', TEST_KEY);
    const wrongKey = 'b'.repeat(64);
    expect(() => decrypt(ciphertext, wrongKey)).toThrow();
  });

  it('handles empty string', () => {
    const ciphertext = encrypt('', TEST_KEY);
    expect(decrypt(ciphertext, TEST_KEY)).toEqual('');
  });
});
