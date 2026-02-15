import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import config from '../../config/index.js';
import { EncryptionError } from '../../pkg/errors.js';

const ALGORITHM = config.encryption.algorithm; // aes-256-gcm
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Derive the 32-byte encryption key from the hex config value.
 */
function getKey() {
  const keyHex = config.encryption.key;
  if (keyHex.length === 64) {
    return Buffer.from(keyHex, 'hex');
  }
  // If not exactly 64 hex chars, hash it to get 32 bytes
  return createHash('sha256').update(keyHex).digest();
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64-encoded string containing: IV + authTag + ciphertext.
 */
export function encrypt(plaintext) {
  try {
    const key = getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Pack: IV (12) + authTag (16) + ciphertext
    const packed = Buffer.concat([iv, authTag, encrypted]);
    return packed.toString('base64');
  } catch (err) {
    throw new EncryptionError(`Encryption failed: ${err.message}`);
  }
}

/**
 * Decrypt a base64-encoded AES-256-GCM encrypted string.
 */
export function decrypt(encryptedBase64) {
  try {
    const packed = Buffer.from(encryptedBase64, 'base64');

    if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
      throw new Error('Invalid encrypted data: too short');
    }

    const key = getKey();
    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (err) {
    if (err instanceof EncryptionError) throw err;
    throw new EncryptionError(`Decryption failed: ${err.message}`);
  }
}

/**
 * Hash a token string using SHA-256 for storage lookup.
 * Tokens are stored as hashes, never in plaintext.
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
