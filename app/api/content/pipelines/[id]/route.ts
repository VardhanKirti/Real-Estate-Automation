import { NextResponse } from 'next/server';
import { PipelineInputSchema, deletePipeline, getPipeline, updatePipeline, validatePipeline, type Pipeline } from '@/lib/content-pipelines';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const pipeline = getPipeline(params.id);
  if (!pipeline) return NextResponse.json({ error: `unknown pipeline: ${params.id}` }, { status: 404 });
  return NextResponse.json({ pipeline });
}

/** Replaces name/description/nodes/edges in place — id and createdAt carry
 *  over. Validated first, same as create. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const existing = getPipeline(params.id);
  if (!existing) return NextResponse.json({ error: `unknown pipeline: ${params.id}` }, { status: 404 });

  const parsed = PipelineInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const draft: Pipeline = { ...existing, ...parsed.data };
  const problems = validatePipeline(draft);
  if (problems.length > 0) return NextResponse.json({ error: 'pipeline is invalid', problems }, { status: 400 });

  const pipeline = updatePipeline(params.id, parsed.data);
  return NextResponse.json({ pipeline });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const removed = deletePipeline(params.id);
  if (!removed) return NextResponse.json({ error: `unknown pipeline: ${params.id}` }, { status: 404 });
  return NextResponse.json({ ok: true });
}
