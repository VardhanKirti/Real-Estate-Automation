import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth-gate';
import {
  checkPassword,
  clearFailures,
  clientKey,
  readAuthState,
  recordFailure,
  sessionCookieOptions,
  throttled,
} from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const state = readAuthState();
  if (!state.configured || !state.sessionSecret) {
    return NextResponse.json(
      { error: 'no password is set — open the console on the machine it runs on and set one in Setup' },
      { status: 409 },
    );
  }

  const key = clientKey(req);
  if (throttled(key)) {
    return NextResponse.json({ error: 'too many attempts — wait a minute' }, { status: 429 });
  }

  const parsed = z.object({ password: z.string().min(1).max(512) }).safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 });

  if (!checkPassword(parsed.data.password)) {
    recordFailure(key);
    return NextResponse.json({ error: 'wrong password' }, { status: 401 });
  }

  clearFailures(key);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, state.sessionSecret, sessionCookieOptions());
  return res;
}
