import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

/** @param {string} password */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { salt, hash };
}

/**
 * @param {string} password
 * @param {string} salt
 * @param {string} hash
 */
export function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== KEY_LENGTH) return false;
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  return timingSafeEqual(stored, candidate);
}

export function newSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function randomPassword() {
  const words = ['brasa', 'carvao', 'espeto', 'sabor', 'fumaca', 'tempero'];
  const word = words[randomBytes(1)[0] % words.length];
  const number = randomBytes(2).readUInt16BE(0) % 9000 + 1000;
  return `${word}-${number}`;
}
