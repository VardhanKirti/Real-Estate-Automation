import { NextResponse } from 'next/server';
import { z } from 'zod';
import { submitImage } from '@/lib/creative-engine/generate';
import { IMAGE_MODELS } from '@/lib/creative-engine/schemas';
import { readCampaign } from '@/lib/creative-engine/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const Body = z.object({ campaignId: z.string(), model: z.enum(IMAGE_MODELS).default('nano-banana-2'), prompt: z.string().min(10).max(2000), aspectRatio: z.enum(['1:1', '16:9', '9:16']).default('1:1'), productId: z.string().nullable().optional() });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  const campaign = readCampaign(parsed.data.campaignId);
  if (!campaign) return NextResponse.json({ ok: false, error: 'campaign not found' }, { status: 404 });
  try {
    const { generation, run } = await submitImage({ campaign, model: parsed.data.model, prompt: parsed.data.prompt, aspectRatio: parsed.data.aspectRatio, productId: parsed.data.productId ?? null });
    return NextResponse.json({ ok: true, generationId: generation.id, runId: run.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'submit failed';
    return NextResponse.json({ ok: false, error: message }, { status: /not configured/i.test(message) ? 503 : 502 });
  }
}
