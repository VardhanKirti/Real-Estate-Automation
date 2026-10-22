import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth-gate';
import {
  checkPassword,
  clearFailures,
  clientKey,
  isConfigured,
  passwordShapeError,
  recordFailure,
  removePassword,
  rotateSession,
  sessionCookieOptions,
  setPassword,
  throttled,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The password manager behind Setup → Security.
 *
 *   set     no password yet → write one (reachable only on loopback, see middleware)
 *   change  current + new   → new hash, new session secret (other devices signed out)
 *   rotate  current         → new session secret only
 *   remove  current         → back to open-on-this-machine-only
 *
 * Every action that needs `current` re-checks the password even though the
 * caller already holds a session: a left-open tab must not be enough.
 */
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), password: z.string() }),
  z.object({ action: z.literal('change'), current: z.string(), password: z.string() }),
  z.object({ action: z.literal('rotate'), current: z.string() }),
  z.object({ action: z.literal('remove'), current: z.string() }),
]);

function withSession(secret: string) {
  const res = NextResponse.json({ ok: true, configured: true });
  res.cookies.set(SESSION_COOKIE, secret, sessionCookieOptions());
  return res;
}

export async function POST(req: Request) {
  // A plain HTML form cannot send JSON cross-site without a preflight; this
  // plus the middleware's Origin check keeps a hostile page from setting a
  // password on a fresh, open install.
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'expected application/json' }, { status: 415 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });
  const body = parsed.data;
  const configured = isConfigured();

  if (body.action === 'set') {
    if (configured) return NextResponse.json({ error: 'a password is already set' }, { status: 409 });
    const shape = passwordShapeError(body.password);
    if (shape) return NextResponse.json({ error: shape }, { status: 400 });
    return withSession(setPassword(body.password));
  }

  if (!configured) return NextResponse.json({ error: 'no password is set' }, { status: 409 });

  const key = clientKey(req);
  if (throttled(key)) return NextResponse.json({ error: 'too many attempts — wait a minute' }, { status: 429 });
  if (!checkPassword(body.current)) {
    recordFailure(key);
    return NextResponse.json({ error: 'current password is wrong' }, { status: 401 });
  }
  clearFailures(key);

  switch (body.action) {
    case 'change': {
      const shape = passwordShapeError(body.password);
      if (shape) return NextResponse.json({ error: shape }, { status: 400 });
      return withSession(setPassword(body.password));
    }
    case 'rotate':
      return withSession(rotateSession());
    case 'remove': {
      removePassword();
      const res = NextResponse.json({ ok: true, configured: false });
      res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
      return res;
    }
  }
}
