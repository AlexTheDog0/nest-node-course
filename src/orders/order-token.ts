import { createHmac, timingSafeEqual } from 'node:crypto';

export interface OrderIdentity {
  userId: string;
  expiresAt: number;
}

export function signToken(
  userId: string,
  key: Buffer,
  expiresAt: number,
): string {
  if (
    !/^[1-9]\d*$/.test(userId) ||
    !Number.isSafeInteger(expiresAt) ||
    key.length < 32
  ) {
    throw new Error('Invalid token parameters');
  }
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt })).toString(
    'base64url',
  );
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

export function verifyToken(
  token: unknown,
  key: Buffer,
  now = Date.now(),
): OrderIdentity {
  if (key.length < 32 || typeof token !== 'string' || token.length > 1024) {
    throw new Error('Invalid token');
  }
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))
  ) {
    throw new Error('Invalid token');
  }
  const expected = createHmac('sha256', key).update(parts[0]).digest();
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Invalid token');
  }
  const identity: unknown = JSON.parse(
    Buffer.from(parts[0], 'base64url').toString('utf8'),
  );
  if (
    typeof identity !== 'object' ||
    identity === null ||
    !('userId' in identity) ||
    typeof identity.userId !== 'string' ||
    !/^[1-9]\d*$/.test(identity.userId) ||
    !('expiresAt' in identity) ||
    typeof identity.expiresAt !== 'number' ||
    !Number.isSafeInteger(identity.expiresAt) ||
    identity.expiresAt <= now
  ) {
    throw new Error('Invalid or expired token');
  }
  return { userId: identity.userId, expiresAt: identity.expiresAt };
}
