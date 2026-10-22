import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { WorkflowSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** Restores one recorded version onto the live row. Body: `{ versionId }`.
 *  The restore is recorded as a new version ("restore of vN") — history only
 *  ever grows. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = (await request.json().catch(() => null)) as { versionId?: unknown } | null;
  if (typeof body?.versionId !== 'string') return NextResponse.json({ error: 'versionId required' }, { status: 400 });
  const db = getDb();
  const existing = db.workflows.get(params.id);
  if (!existing) return NextResponse.json({ error: `unknown workflow: ${params.id}` }, { status: 404 });
  const v = db.workflowVersions.get(body.versionId);
  if (!v || v.workflowId !== params.id) return NextResponse.json({ error: `unknown version: ${body.versionId}` }, { status: 404 });
  const parsed = WorkflowSchema.safeParse(v.snapshot);
  if (!parsed.success) return NextResponse.json({ error: 'that version no longer validates against the current schema' }, { status: 422 });
  db.workflows.insert(parsed.data, `restore of v${v.version}`);
  return NextResponse.json({ workflow: db.workflows.get(params.id), versions: db.workflowVersions.list(params.id) });
}
