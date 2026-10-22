import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CapError, submitUgc } from '@/lib/creative-engine/generate';
import { readCampaign } from '@/lib/creative-engine/store';
import { explainArcadsError } from '@/lib/arcads/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({ campaignId: z.string(), scriptId: z.string(), situationId: z.string(), voiceId: z.string().nullable().optional(), productId: z.string().nullable().optional(), override: z.boolean().optional() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  try {
    const { generation, run } = await submitUgc({ campaign, scriptId: parsed.data.scriptId, situationId: parsed.data.situationId, voiceId: parsed.data.voiceId ?? null, productId: parsed.data.productId ?? null, override: parsed.data.override });
    return NextResponse.json({ ok: true, generationId: generation.id, runId: run.id });
  } catch (err) {
    if (err instanceof CapError) return NextResponse.json({ ok: false, error: err.message, kind: 'cap', spent: err.spent, cap: err.cap }, { status: 409 });
    const message = err instanceof Error ? err.message : 'submit failed';
    if (/not configured/i.test(message)) return NextResponse.json({ ok: false, error: message, kind: 'not-configured' }, { status: 503 });
    if (/approve a script/.test(message)) return NextResponse.json({ ok: false, error: message, kind: 'blocked' }, { status: 422 });
    const ex = explainArcadsError(err);
    return NextResponse.json({ ok: false, error: ex.message, kind: ex.kind }, { status: ex.httpStatus });
  }
}
