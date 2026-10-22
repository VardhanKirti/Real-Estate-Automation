import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { isConfirmed } from '@/lib/gates';
import { authorizePush } from '@/lib/push-auth';
import { clampLimits } from '@/lib/trading-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The trading agent's limits (pages/trading.md §2, T-5).
 *
 * GET   the stored row, or `limits: null` ("No limits saved"; never code
 *       defaults dressed as stored). The Markets agent reads it at the start
 *       of every run with its TRADING_PUSH_TOKEN, or the operator's session.
 * PATCH operator session only (a push token is refused). The 7 numbers are
 *       clamped into the schema ranges and the clamped list is returned.
 *       Turning autopilot ON needs `confirm: true` (409 without it): the
 *       Markets agent will place real orders inside these limits. GladOS
 *       itself places no orders; turning it off needs no confirm.
 */
export async function GET(req: Request) {
  const auth = authorizePush(req, 'TRADING_PUSH_TOKEN');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ limits: getDb().trading.limits() });
}

export async function PATCH(req: Request) {
  const auth = authorizePush(req, 'TRADING_PUSH_TOKEN');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.via === 'token') return NextResponse.json({ error: 'limits are changed by the operator only' }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'JSON body required' }, { status: 400 });

  const t = getDb().trading;
  const current = t.limits();
  // A partial PATCH fills from the stored row; with nothing stored every field is required.
  const merged = { ...(current ?? {}), ...body };
  const { limits, clamped, invalid } = clampLimits(merged);
  if (invalid.length) return NextResponse.json({ error: 'every limit must be a number', fields: invalid }, { status: 400 });
  if (body.autopilot !== undefined && typeof body.autopilot !== 'boolean') {
    return NextResponse.json({ error: 'autopilot must be true or false' }, { status: 400 });
  }
  const autopilot = typeof body.autopilot === 'boolean' ? body.autopilot : (current?.autopilot ?? false);
  if (autopilot && !current?.autopilot && !isConfirmed(body)) {
    return NextResponse.json(
      { error: 'Turning on autopilot lets the Markets agent place real orders inside these limits. Resend with "confirm": true.', needsConfirm: true },
      { status: 409 },
    );
  }
  t.saveLimits({ ...limits, autopilot });
  return NextResponse.json({ ok: true, limits: t.limits(), clamped });
}
