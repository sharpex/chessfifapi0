import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function comparePassword(plain, hash) {
  if (!plain || !hash) return Promise.resolve(false);
  return bcrypt.compare(plain, hash);
}
