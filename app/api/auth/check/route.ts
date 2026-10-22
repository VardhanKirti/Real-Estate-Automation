import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-gate';
import { cookieFromHeader, readAuthState, sameSecret } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The middleware's eyes. Answers two booleans and nothing else: is a password
 * configured, and is the presented cookie the current session secret. Open
 * path by design — it reveals no secret and cannot change state.
 */
export async function GET(req: Request) {
  const state = readAuthState();
  const cookie = cookieFromHeader(req.headers.get('cookie'), SESSION_COOKIE);
  const authed = state.configured && !!cookie && !!state.sessionSecret && sameSecret(cookie, state.sessionSecret);
  return NextResponse.json(
    { configured: state.configured, authed },
    { headers: { 'cache-control': 'no-store' } },
  );
}
