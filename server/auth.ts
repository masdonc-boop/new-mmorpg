import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Passwords and session tokens (docs/MULTIPLAYER.md 3.4). Passwords are hashed with scrypt (built
 * into Node) with a random salt; the stored string records the parameters so they can be raised
 * later. Session tokens are 256-bit random values; only their SHA-256 hash is stored.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const USERNAME = /^[A-Za-z][A-Za-z0-9_-]{2,11}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function passwordProblem(password: string, username: string): string | null {
  if (password.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return 'That password is too long.';
  if (password.toLowerCase() === username.toLowerCase()) return "Your password can't be your name.";
  return null;
}

/**
 * Sign-in rate limits: a key (an account name or a network address) gets `max` failures within
 * `windowMs`, then is locked out until the window passes. Successful sign-ins clear the account key.
 */
export class RateLimiter {
  private failures = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
    private now: () => number = () => Date.now(),
  ) {}

  blocked(key: string): boolean {
    return this.recent(key).length >= this.max;
  }

  fail(key: string) {
    const list = this.recent(key);
    list.push(this.now());
    this.failures.set(key, list);
  }

  clear(key: string) {
    this.failures.delete(key);
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }
}
