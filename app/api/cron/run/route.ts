import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { cronJobs, defaultJobRunner, fireJob } from '@/lib/cron-runner';
import { gateResponse } from '@/lib/gates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const Body = z.object({ cronId: z.string().min(1) });

/**
 * "Run now" for one scheduled job (F10). An agent run can call a paid model,
 * so: 403 unless GLADOS_CRON=1, then 409 unless `confirm: true`. The run is
 * recorded in cron_runs with trigger "manual", success or failure.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const refused = gateResponse('GLADOS_CRON', body);
  if (refused) return refused;
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'cronId is required' }, { status: 400 });
  const db = getDb();
  const job = cronJobs(db).find((j) => j.id === parsed.data.cronId);
  if (!job) return NextResponse.json({ error: 'unknown cron' }, { status: 404 });
  const result = await fireJob(db, job, await defaultJobRunner(db), 'manual');
  if ('skipped' in result) return NextResponse.json({ error: 'this job is already running' }, { status: 409 });
  return NextResponse.json(result);
}
