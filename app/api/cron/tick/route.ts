import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { cronPlan, defaultJobRunner, runDue } from '@/lib/cron-runner';
import { cronEnabled } from '@/lib/gates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The cron runner's tick (pages/feature-additions.md F10).
 *
 * GET   the dry run: every job (the 07:00 digest plus the agent crons) with
 *       its last and next firing and what is due now. Reads SQLite only; spends
 *       nothing; answers on every instance (the Scheduled card reads it).
 * POST  fire every due job. 403 unless GLADOS_CRON=1 (off by default; the
 *       always-on host only). lib/cron-loop.ts calls this every 60 s.
 */
export async function GET() {
  return NextResponse.json({ enabled: cronEnabled(), ...cronPlan(getDb()) });
}

export async function POST() {
  if (!cronEnabled()) {
    return NextResponse.json({ error: 'The cron runner is off on this instance. Set GLADOS_CRON=1 on the always-on host.', gate: 'GLADOS_CRON' }, { status: 403 });
  }
  const db = getDb();
  return NextResponse.json(await runDue(db, await defaultJobRunner(db)));
}
