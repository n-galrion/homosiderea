import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param plaintext - The string to encrypt
 * @param keyHex - 64-char hex string (32 bytes)
 * @returns Format: {iv_hex}:{authTag_hex}:{ciphertext_hex}
 */
export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string encrypted with encrypt().
 * @param ciphertext - Format: {iv_hex}:{authTag_hex}:{ciphertext_hex}
 * @param keyHex - 64-char hex string (32 bytes)
 * @returns The original plaintext
 */
export function decrypt(ciphertext: string, keyHex: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
