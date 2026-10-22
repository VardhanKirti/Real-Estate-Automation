import { NextResponse } from 'next/server';
import { PipelineInputSchema, createPipeline, readPipelines, validatePipeline, type Pipeline } from '@/lib/content-pipelines';

export const dynamic = 'force-dynamic';

/** The saved pipeline list — read by the Pipelines board. */
export async function GET() {
  return NextResponse.json({ pipelines: readPipelines() });
}

/**
 * Creates a new pipeline. Validated first: a draft with a broken edge, a
 * cycle, an unknown model, or a mistyped media socket is rejected with the
 * problem list rather than saved half-working.
 */
export async function POST(request: Request) {
  const parsed = PipelineInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const draft: Pipeline = { id: 'draft', createdAt: '', updatedAt: '', ...parsed.data };
  const problems = validatePipeline(draft);
  if (problems.length > 0) return NextResponse.json({ error: 'pipeline is invalid', problems }, { status: 400 });

  const pipeline = createPipeline(parsed.data);
  return NextResponse.json({ pipeline }, { status: 201 });
}
