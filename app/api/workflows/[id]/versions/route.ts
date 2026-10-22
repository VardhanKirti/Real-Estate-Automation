import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/** Every recorded version of one workflow, newest first. Versions are
 *  written by the DB layer on each save, so nothing here is reconstructed. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const db = getDb();
  if (!db.workflows.get(params.id)) return NextResponse.json({ error: `unknown workflow: ${params.id}` }, { status: 404 });
  return NextResponse.json({ versions: db.workflowVersions.list(params.id) });
}
