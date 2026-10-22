import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readEnvLocal, removeEnvLocal, upsertEnvLocal } from '@/lib/creds';

/**
 * Operator password + session secret. Both live in `.env.local` on the host,
 * written by the app from Setup → Security, never in git:
 *
 *   GLADOS_PASSWORD_HASH   scrypt:<N>:<r>:<p>:<salt hex>:<key hex>
 *   GLADOS_SESSION_SECRET  64 hex chars; the value the session cookie carries
 *
 * `.env.local` is read fresh on every call (lib/creds), so a password set in
 * the UI takes effect without a restart. The session secret rotates whenever
 * the password is set or changed, which signs every other device out.
 *
 * Forgot the password: delete the GLADOS_PASSWORD_HASH line from .env.local,
 * restart, and set a new one from the machine the app runs on.
 */

export const PASSWORD_HASH_KEY = 'GLADOS_PASSWORD_HASH';
export const SESSION_SECRET_KEY = 'GLADOS_SESSION_SECRET';
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 512;

// ':' as the separator on purpose: Next's env loader expands `$WORD`, and a
// `$`-delimited hash would come through process.env mangled.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
const MAX_N = 1 << 20;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), key.toString('hex')].join(':');
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltHex, keyHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  const hex = /^[0-9a-f]+$/i;
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0) || N > MAX_N) return false;
  if (!hex.test(saltHex) || !hex.test(keyHex) || keyHex.length % 2 !== 0) return false;
  const expected = Buffer.from(keyHex, 'hex');
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time compare so a secret cannot be guessed a character at a time. */
export function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type AuthState = { configured: boolean; passwordHash?: string; sessionSecret?: string };

export function readAuthState(): AuthState {
  const env = readEnvLocal();
  const passwordHash = env[PASSWORD_HASH_KEY]?.trim() || undefined;
  const sessionSecret = env[SESSION_SECRET_KEY]?.trim() || undefined;
  return { configured: Boolean(passwordHash && sessionSecret), passwordHash, sessionSecret };
}

export function isConfigured(): boolean {
  return readAuthState().configured;
}

export function sessionIsValid(cookie: string | undefined | null): boolean {
  const { configured, sessionSecret } = readAuthState();
  if (!configured || !cookie || !sessionSecret) return false;
  return sameSecret(cookie, sessionSecret);
}

export function checkPassword(password: string): boolean {
  const { configured, passwordHash } = readAuthState();
  return configured && !!passwordHash && verifyPassword(password, passwordHash);
}

/** Null when acceptable, otherwise the message to show the operator. */
export function passwordShapeError(password: unknown): string | null {
  if (typeof password !== 'string') return 'password must be text';
  if (password.length < MIN_PASSWORD_LENGTH) return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  if (password.trim() !== password) return 'password cannot start or end with whitespace';
  if (/[\r\n]/.test(password)) return 'password cannot contain line breaks';
  return null;
}

function newSecret(): string {
  return randomBytes(32).toString('hex');
}

/** Write a new hash and a fresh session secret. Returns the secret to put in
 *  the caller's cookie so this device stays signed in. */
export function setPassword(password: string): string {
  const secret = newSecret();
  upsertEnvLocal({ [PASSWORD_HASH_KEY]: hashPassword(password), [SESSION_SECRET_KEY]: secret });
  return secret;
}

/** New session secret, same password: every other device is signed out. */
export function rotateSession(): string {
  const secret = newSecret();
  upsertEnvLocal({ [SESSION_SECRET_KEY]: secret });
  return secret;
}

export function removePassword(): void {
  removeEnvLocal([PASSWORD_HASH_KEY, SESSION_SECRET_KEY]);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true, // JavaScript on the page can never read it
    sameSite: 'lax' as const, // not sent on cross-site POSTs → blocks CSRF
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
    secure: false, // served over plain http on localhost / a private interface
  };
}

/* ---- online-guessing throttle: a handful of tries per minute per client ---- */

const attempts = new Map<string, { n: number; at: number }>();
const WINDOW_MS = 60_000;
const MAX_TRIES = 8;

export function clientKey(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export function throttled(key: string, now = Date.now()): boolean {
  const rec = attempts.get(key);
  return !!rec && now - rec.at < WINDOW_MS && rec.n >= MAX_TRIES;
}

export function recordFailure(key: string, now = Date.now()): void {
  const rec = attempts.get(key);
  attempts.set(key, rec && now - rec.at < WINDOW_MS ? { n: rec.n + 1, at: rec.at } : { n: 1, at: now });
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** For tests. */
export function resetThrottle(): void {
  attempts.clear();
}

export function cookieFromHeader(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
