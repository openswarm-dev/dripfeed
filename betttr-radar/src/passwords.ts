import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

export function validateUsername(username: string): string | null {
  if (typeof username !== 'string') return 'Username required';
  const u = username.trim();
  if (u.length < USERNAME_MIN) return `Username must be at least ${USERNAME_MIN} characters`;
  if (u.length > USERNAME_MAX) return `Username must be at most ${USERNAME_MAX} characters`;
  if (!/^[a-zA-Z0-9_]+$/.test(u)) return 'Username can only use letters, numbers, and underscore';
  return null;
}

export function validatePassword(password: string): string | null {
  if (typeof password !== 'string') return 'Password required';
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters`;
  }
  if (password.length > PASSWORD_MAX) {
    return `Password must be at most ${PASSWORD_MAX} characters`;
  }
  if (/\s/.test(password)) return 'Password cannot contain spaces';
  return null;
}

function scryptDerive(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** Format: scrypt$N$r$p$salt$derived */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptDerive(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'base64url');
    expected = Buffer.from(parts[5]!, 'base64url');
  } catch {
    return false;
  }
  if (salt.length < 8 || expected.length < 16) return false;

  const derived = await scryptDerive(password, salt, expected.length, { N: n, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
