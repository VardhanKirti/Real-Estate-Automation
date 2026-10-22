import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { authorizePush } from '@/lib/push-auth';
import { TradingPushSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The Markets agent's push (pages/trading.md §2): one account snapshot plus
 * its positions (at most 200), and optionally its open orders (replaced
 * wholesale), trade log rows and the run's analysis. Authenticated by
 * `Authorization: Bearer <TRADING_PUSH_TOKEN>` or the operator session
 * (lib/push-auth.ts). Validated whole before anything is written: a bad body
 * is a 400 and writes nothing (T-2).
 */
export async function POST(req: Request) {
  const auth = authorizePush(req, 'TRADING_PUSH_TOKEN');
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const parsed = TradingPushSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid push', issues: parsed.error.flatten() }, { status: 400 });
  const { snapshot, positions, openOrders, activity, analysis } = parsed.data;
  const { accountId, capturedAt } = snapshot;

  const t = getDb().trading;
  // Every row inherits the snapshot's account, so a push can never write into another account.
  t.recordSnapshot(snapshot, positions.map((p) => ({ ...p, accountId, capturedAt })));
  if (openOrders) t.replaceOpenOrders(accountId, openOrders.map((o) => ({ ...o, accountId })));
  for (const a of activity) t.recordActivity({ ...a, accountId });
  if (analysis) t.recordAnalysis({ ...analysis, accountId });

  return NextResponse.json({
    ok: true,
    via: auth.via,
    accountId,
    capturedAt,
    positions: positions.length,
    openOrders: openOrders?.length ?? null,
    activity: activity.length,
    analysis: Boolean(analysis),
  });
}
