import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildPipelinePrompt, parsePipelineDraft, runClaude } from './logic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs'; // shells out to a local binary — keep off the edge runtime

const DraftRequestSchema = z.object({ brief: z.string().min(1).max(4000) });

/**
 * Drafts a pipeline from a free-text brief by shelling out to the `claude`
 * CLI — same drafting pattern as app/api/workflows/draft/route.ts. Never
 * writes to the pipeline store; the draft only opens in the builder for the
 * operator to review and explicitly save. Honest 503 when the CLI is
 * missing, errors, or the reply never parses into a valid pipeline after
 * one retry — this route never fabricates a pipeline.
 */
export async function POST(request: Request) {
  const parsed = DraftRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'a brief is required' }, { status: 400 });

  const first = await runClaude(buildPipelinePrompt(parsed.data.brief));
  if (!first.ok) {
    return NextResponse.json(
      { error: first.unavailable ? 'Drafting unavailable' : `Drafting unavailable: ${first.error}` },
      { status: 503 },
    );
  }

  const firstDraft = parsePipelineDraft(first.stdout);
  if (firstDraft.ok) return NextResponse.json({ pipeline: firstDraft.data });

  // One retry, with the validation error fed back in.
  const second = await runClaude(buildPipelinePrompt(parsed.data.brief, firstDraft.error));
  if (!second.ok) {
    return NextResponse.json(
      { error: second.unavailable ? 'Drafting unavailable' : `Drafting unavailable: ${second.error}` },
      { status: 503 },
    );
  }
  const secondDraft = parsePipelineDraft(second.stdout);
  if (secondDraft.ok) return NextResponse.json({ pipeline: secondDraft.data });

  return NextResponse.json(
    { error: `drafting assistant returned an invalid pipeline twice — build manually (${secondDraft.error})` },
    { status: 502 },
  );
}
