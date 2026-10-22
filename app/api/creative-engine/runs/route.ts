import { NextResponse } from 'next/server';
import { advanceArcadsRuns } from '@/lib/creative-engine/generate';
import { syncWorkflows } from '@/lib/creative-engine/workflow-run';
import { listRuns } from '@/lib/creative-engine/runs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Runs with DERIVED status. Reading advances any running Arcads job older than 15 s (no queue worker exists). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaignId');
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 50)));
  let advanced = 0;
  try {
    advanced = await advanceArcadsRuns();
    await syncWorkflows(); // delivered runs move their workflows forward
  } catch {
    advanced = 0; // polling problems never break the list
  }
  return NextResponse.json({ ok: true, advanced, runs: listRuns(campaignId).slice(0, limit) });
}
