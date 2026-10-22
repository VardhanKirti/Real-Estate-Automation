import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { launchSupersetDraft, supersetKey } from '@/lib/connectors/superset';
import { resolveCred } from '@/lib/creds';
import { gateResponse } from '@/lib/gates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * "Start draft in Superset" (pages/clients.md §4, CL-3). Starts a real agent,
 * which spends money, so: 403 unless GLADOS_WRITES=1, then 409 unless the body
 * carries `confirm: true` (lib/gates.ts). Only a draft or failed request can
 * launch. Success moves it to running with the workspace id; a CLI failure
 * marks it failed with the CLI's own message, never a fake success.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => null);
  const refused = gateResponse('GLADOS_WRITES', body);
  if (refused) return refused;

  const db = getDb();
  const work = db.clientWork.get(params.id);
  if (!work) return NextResponse.json({ error: 'unknown work request' }, { status: 404 });
  if (work.status !== 'draft' && work.status !== 'failed') {
    return NextResponse.json({ error: `already ${work.status}` }, { status: 409 });
  }
  const client = db.clientConfirmations.get(work.clientId);
  if (!client) return NextResponse.json({ error: 'this client is no longer confirmed' }, { status: 409 });
  if (!supersetKey()) return NextResponse.json({ error: 'Superset is not configured', setupHref: '/integrations#superset' }, { status: 503 });
  const projectId = client.supersetProject ?? resolveCred('SUPERSET_PROJECT_ID', [])?.trim() ?? '';
  if (!projectId) return NextResponse.json({ error: 'no Superset project for this client: set one on the client or SUPERSET_PROJECT_ID' }, { status: 400 });

  db.clientWork.setStatus(work.id, 'queued');
  try {
    const launched = await launchSupersetDraft({ clientName: client.name, brief: work.brief, projectId });
    const next = db.clientWork.setStatus(work.id, 'running', { supersetWorkspace: launched.workspaceId, detail: `branch ${launched.branch}` });
    return NextResponse.json({ ok: true, work: next, workspaceId: launched.workspaceId, branch: launched.branch });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = db.clientWork.setStatus(work.id, 'failed', { detail: message });
    return NextResponse.json({ error: message, work: next }, { status: 502 });
  }
}
