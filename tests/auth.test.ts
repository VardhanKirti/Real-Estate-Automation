import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  PASSWORD_HASH_KEY,
  SESSION_SECRET_KEY,
  checkPassword,
  hashPassword,
  isConfigured,
  passwordShapeError,
  readAuthState,
  removePassword,
  resetThrottle,
  rotateSession,
  sessionIsValid,
  setPassword,
  verifyPassword,
} from '@/lib/auth';

// Own .env.local so the operator's real file is never touched (lib/creds reads
// GLADOS_ENV_LOCAL fresh on every call).
const prevOverride = process.env.GLADOS_ENV_LOCAL;
let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glados-auth-'));
  process.env.GLADOS_ENV_LOCAL = path.join(tmp, '.env.local');
  resetThrottle();
});
afterAll(() => {
  if (prevOverride === undefined) delete process.env.GLADOS_ENV_LOCAL;
  else process.env.GLADOS_ENV_LOCAL = prevOverride;
});

const readFile = () => fs.readFileSync(process.env.GLADOS_ENV_LOCAL!, 'utf8');
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/auth/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? '';
const sessionOf = (res: Response) => /glados_session=([^;]*)/.exec(cookieOf(res))?.[1] ?? '';

describe('password hashing', () => {
  test('round-trips and rejects the wrong password', () => {
    const stored = hashPassword('correct horse battery');
    expect(stored.startsWith('scrypt:16384:8:1:')).toBe(true);
    expect(stored).not.toContain('$'); // Next's env loader expands $WORD
    expect(verifyPassword('correct horse battery', stored)).toBe(true);
    expect(verifyPassword('correct horse batter', stored)).toBe(false);
  });
  test('two hashes of one password differ (fresh salt) and both verify', () => {
    const a = hashPassword('same');
    const b = hashPassword('same');
    expect(a).not.toBe(b);
    expect(verifyPassword('same', a) && verifyPassword('same', b)).toBe(true);
  });
  test('malformed or hostile stored values never verify', () => {
    for (const bad of ['', 'plaintext', 'scrypt:1:1:1:zz:zz', 'scrypt:2097152:8:1:00:00', 'bcrypt:a:b:c:d:e']) {
      expect(verifyPassword('anything', bad), bad).toBe(false);
    }
  });
  test('shape rules', () => {
    expect(passwordShapeError('short')).toMatch(/at least 8/);
    expect(passwordShapeError(' padded  ')).toMatch(/whitespace/);
    expect(passwordShapeError('x'.repeat(600))).toMatch(/at most/);
    expect(passwordShapeError('a fine passphrase')).toBeNull();
  });
});

describe('.env.local as the password store', () => {
  test('fresh install: nothing configured, no session valid', () => {
    expect(isConfigured()).toBe(false);
    expect(sessionIsValid('anything')).toBe(false);
    expect(checkPassword('anything')).toBe(false);
  });
  test('setPassword writes a hash and a secret, never the password', () => {
    const secret = setPassword('a fine passphrase');
    const file = readFile();
    expect(file).toContain(`${PASSWORD_HASH_KEY}=scrypt:`);
    expect(file).toContain(`${SESSION_SECRET_KEY}=${secret}`);
    expect(file).not.toContain('a fine passphrase');
    expect(isConfigured()).toBe(true);
    expect(checkPassword('a fine passphrase')).toBe(true);
    expect(sessionIsValid(secret)).toBe(true);
    expect(sessionIsValid(secret.slice(1))).toBe(false);
  });
  test('rotateSession keeps the password and invalidates the old cookie', () => {
    const first = setPassword('a fine passphrase');
    const second = rotateSession();
    expect(second).not.toBe(first);
    expect(sessionIsValid(first)).toBe(false);
    expect(sessionIsValid(second)).toBe(true);
    expect(checkPassword('a fine passphrase')).toBe(true);
  });
  test('removePassword drops both lines and leaves other keys alone', () => {
    fs.writeFileSync(process.env.GLADOS_ENV_LOCAL!, 'SLACK_BOT_TOKEN=xoxb-1\n');
    setPassword('a fine passphrase');
    removePassword();
    expect(readFile()).toBe('SLACK_BOT_TOKEN=xoxb-1\n');
    expect(readAuthState()).toEqual({ configured: false, passwordHash: undefined, sessionSecret: undefined });
  });
});

describe('GET /api/auth/check', () => {
  test('reports configured + authed from the cookie header only', async () => {
    const { GET } = await import('@/app/api/auth/check/route');
    let res = await GET(new Request('http://localhost/api/auth/check'));
    expect(await res.json()).toEqual({ configured: false, authed: false });

    const secret = setPassword('a fine passphrase');
    res = await GET(new Request('http://localhost/api/auth/check'));
    expect(await res.json()).toEqual({ configured: true, authed: false });
    res = await GET(new Request('http://localhost/api/auth/check', { headers: { cookie: `other=1; glados_session=${secret}` } }));
    expect(await res.json()).toEqual({ configured: true, authed: true });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('POST /api/auth/login', () => {
  test('409 while no password is set', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const res = await POST(json({ password: 'whatever' }));
    expect(res.status).toBe(409);
  });
  test('wrong password 401, right password sets the current secret as the cookie', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const secret = setPassword('a fine passphrase');
    expect((await POST(json({ password: 'nope nope' }))).status).toBe(401);
    const ok = await POST(json({ password: 'a fine passphrase' }));
    expect(ok.status).toBe(200);
    expect(sessionOf(ok)).toBe(secret);
    expect(cookieOf(ok)).toMatch(/HttpOnly/i);
    expect(cookieOf(ok)).toMatch(/SameSite=Lax/i);
  });
  test('throttles after eight failures from one client', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    setPassword('a fine passphrase');
    for (let i = 0; i < 8; i += 1) await POST(json({ password: 'bad' }, { 'x-forwarded-for': '10.9.9.9' }));
    const res = await POST(json({ password: 'a fine passphrase' }, { 'x-forwarded-for': '10.9.9.9' }));
    expect(res.status).toBe(429);
  });
});

describe('POST /api/auth/password', () => {
  test('refuses non-JSON bodies (form posts) outright', async () => {
    const { POST } = await import('@/app/api/auth/password/route');
    const res = await POST(
      new Request('http://localhost/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'action=set&password=hijacked-password',
      }),
    );
    expect(res.status).toBe(415);
    expect(isConfigured()).toBe(false);
  });
  test('set: only on a fresh install, enforces shape, signs this device in', async () => {
    const { POST } = await import('@/app/api/auth/password/route');
    expect((await POST(json({ action: 'set', password: 'short' }))).status).toBe(400);
    const ok = await POST(json({ action: 'set', password: 'a fine passphrase' }));
    expect(ok.status).toBe(200);
    expect(sessionIsValid(sessionOf(ok))).toBe(true);
    expect((await POST(json({ action: 'set', password: 'another passphrase' }))).status).toBe(409);
    expect(checkPassword('a fine passphrase')).toBe(true);
  });
  test('change / rotate / remove all re-check the current password', async () => {
    const { POST } = await import('@/app/api/auth/password/route');
    const first = setPassword('a fine passphrase');
    for (const action of ['change', 'rotate', 'remove'] as const) {
      const res = await POST(json({ action, current: 'wrong wrong', password: 'new passphrase!' }));
      expect(res.status, action).toBe(401);
    }
    expect(checkPassword('a fine passphrase')).toBe(true);

    const changed = await POST(json({ action: 'change', current: 'a fine passphrase', password: 'new passphrase!' }));
    expect(changed.status).toBe(200);
    expect(checkPassword('new passphrase!')).toBe(true);
    expect(sessionIsValid(first)).toBe(false); // other devices signed out
    const afterChange = sessionOf(changed);
    expect(sessionIsValid(afterChange)).toBe(true);

    const rotated = await POST(json({ action: 'rotate', current: 'new passphrase!' }));
    expect(rotated.status).toBe(200);
    expect(sessionIsValid(afterChange)).toBe(false);
    expect(sessionIsValid(sessionOf(rotated))).toBe(true);

    const removed = await POST(json({ action: 'remove', current: 'new passphrase!' }));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true, configured: false });
    expect(cookieOf(removed)).toMatch(/Max-Age=0/i);
    expect(isConfigured()).toBe(false);
  });
  test('change etc. are 409 when nothing is configured', async () => {
    const { POST } = await import('@/app/api/auth/password/route');
    expect((await POST(json({ action: 'rotate', current: 'x' }))).status).toBe(409);
  });
});
