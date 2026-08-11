import { createHmac, timingSafeEqual } from 'node:crypto';

export type AuthPayload = {
  userId: string;
  username: string;
};

function jwtSecret(): string {
  const s = (process.env.JWT_SECRET ?? '').trim();
  if (!s) {
    // Dev fallback — set JWT_SECRET on Hetzner for production.
    return 'betttr-dev-jwt-secret-change-me';
  }
  return s;
}

function b64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function signHs256(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function signToken(payload: AuthPayload, expiresInSec = 60 * 60 * 24 * 30): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + expiresInSec,
    }),
  );
  const sig = signHs256(`${header}.${body}`, jwtSecret());
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const expected = signHs256(`${header}.${body}`, jwtSecret());
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AuthPayload & {
      exp?: number;
    };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.userId || !payload.username) return null;
    return { userId: payload.userId, username: payload.username };
  } catch {
    return null;
  }
}

export function bearerUser(req: { headers: { authorization?: string } }): AuthPayload | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}
