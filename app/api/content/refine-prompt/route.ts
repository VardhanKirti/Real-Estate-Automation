import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runClaude } from '@/app/api/workflows/draft/logic';
import { contentCampaigns } from '@/lib/content-campaigns';
import { findModel } from '@/lib/higgsfield/catalog';
import { buildRefinePrompt, parseRefineReply } from './logic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // shells out to a local binary — keep off the edge runtime

/**
 * Rewrites a composer's creative direction in the campaign's voice by
 * shelling out to the `claude` CLI — same pattern as the workflow drafting
 * route: strict-JSON-only instruction, one retry with the validation error
 * fed back, and an honest degrade (503, "Refinement unavailable") when the
 * CLI can't run. Never writes anywhere; the caller applies the returned
 * prompt to its own draft state.
 */

const RefineRequestSchema = z.object({
  prompt: z.string().min(1).max(4000),
  modelId: z.string().min(1),
  campaignId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const parsed = RefineRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'a prompt and model are required' }, { status: 400 });
  }

  const model = findModel(parsed.data.modelId);
  const modelName = model?.name ?? parsed.data.modelId;
  const campaign = parsed.data.campaignId
    ? (contentCampaigns().find((c) => c.id === parsed.data.campaignId) ?? null)
    : null;
  const campaignBrief = campaign
    ? [campaign.angle, campaign.framing, campaign.briefQuote].filter(Boolean).join('\n')
    : null;

  const args = { direction: parsed.data.prompt, modelName, campaignBrief };

  const first = await runClaude(buildRefinePrompt(args));
  if (!first.ok) {
    return NextResponse.json(
      {
        ok: false,
        unavailable: first.unavailable,
        error: first.unavailable ? 'Refinement unavailable' : `refinement failed: ${first.error}`,
      },
      { status: first.unavailable ? 503 : 502 },
    );
  }
  const firstReply = parseRefineReply(first.stdout);
  if (firstReply.ok) return NextResponse.json({ ok: true, prompt: firstReply.data.prompt });

  // One retry, with the validation error fed back in.
  const second = await runClaude(buildRefinePrompt({ ...args, priorError: firstReply.error }));
  if (!second.ok) {
    return NextResponse.json(
      {
        ok: false,
        unavailable: second.unavailable,
        error: second.unavailable ? 'Refinement unavailable' : `refinement failed: ${second.error}`,
      },
      { status: second.unavailable ? 503 : 502 },
    );
  }
  const secondReply = parseRefineReply(second.stdout);
  if (secondReply.ok) return NextResponse.json({ ok: true, prompt: secondReply.data.prompt });

  return NextResponse.json(
    { ok: false, unavailable: false, error: `refinement returned invalid output twice — try again (${secondReply.error})` },
    { status: 502 },
  );
}
