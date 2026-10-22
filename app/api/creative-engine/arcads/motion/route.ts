import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CapError, submitMotion } from '@/lib/creative-engine/generate';
import { ConsoleControlsSchema } from '@/lib/creative-engine/schemas';
import { readCampaign } from '@/lib/creative-engine/store';
import { explainArcadsError } from '@/lib/arcads/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const Body = z.object({ campaignId: z.string(), controls: ConsoleControlsSchema.partial(), productId: z.string().nullable().optional(), scriptId: z.string().nullable().optional(), override: z.boolean().optional() });

/**
 * Submit N motion requests. The answer says exactly what happened:
 * `submitted` ran, `failed` did not (with the Arcads error class each).
 * 207 when some failed, 4xx/5xx when none went through.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  try {
    const { generation, runs, failed, prompt } = await submitMotion({ campaign, controls: parsed.data.controls, productId: parsed.data.productId ?? null, scriptId: parsed.data.scriptId ?? null, override: parsed.data.override });
    const failedIds = new Set(failed.map((f) => f.runId));
    const submitted = runs.filter((r) => !failedIds.has(r.id)).map((r) => r.id);
    if (submitted.length === 0 && failed.length) {
      return NextResponse.json({ ok: false, error: failed[0].reason, kind: failed[0].kind, submitted, failed, prompt }, { status: failed[0].kind === 'auth' ? 401 : failed[0].kind === 'credits' ? 402 : failed[0].kind === 'rate' ? 429 : failed[0].kind === 'content' ? 422 : 502 });
    }
    return NextResponse.json({ ok: true, generationId: generation?.id ?? null, runIds: submitted, submitted, failed, prompt }, { status: failed.length ? 207 : 200 });
  } catch (err) {
    if (err instanceof CapError) return NextResponse.json({ ok: false, error: err.message, kind: 'cap', spent: err.spent, cap: err.cap }, { status: 409 });
    const message = err instanceof Error ? err.message : 'submit failed';
    if (/not configured/i.test(message)) return NextResponse.json({ ok: false, error: message, kind: 'not-configured' }, { status: 503 });
    if (/blocked/.test(message)) return NextResponse.json({ ok: false, error: message, kind: 'blocked' }, { status: 422 });
    const ex = explainArcadsError(err);
    return NextResponse.json({ ok: false, error: ex.message, kind: ex.kind }, { status: ex.httpStatus });
  }
}
