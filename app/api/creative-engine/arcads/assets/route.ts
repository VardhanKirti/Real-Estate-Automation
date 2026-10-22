import fs from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { createArcadsClient, explainArcadsError } from '@/lib/arcads/client';
import { isDry } from '@/lib/creative-engine/dry';
import { readSettings } from '@/lib/creative-engine/store';
import { assetKindFromPath, checkPathProblem } from '@/lib/creative-engine/console-ui';

function checkPath(p: string | null) {
  const problem = checkPathProblem(p);
  if (problem || !p) return NextResponse.json({ ok: false, error: problem ?? 'path required' }, { status: 400 });
  try {
    const st = fs.statSync(path.normalize(p));
    if (!st.isFile()) return NextResponse.json({ ok: true, exists: false, kind: null, bytes: null });
    return NextResponse.json({ ok: true, exists: true, kind: assetKindFromPath(p), bytes: st.size });
  } catch {
    return NextResponse.json({ ok: true, exists: false, kind: null, bytes: null });
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The Arcads library of the default product: newest first, free text over prompts and scripts. Honest when unkeyed. */
export async function GET(request: Request) {
  const u = new URL(request.url);
  // ?check=<absolute path>: does a host-local reference file exist, and what kind is it (S05a FR-10).
  // stat only, never reads content; relative paths and `..` segments are refused.
  if (u.searchParams.has('check')) return checkPath(u.searchParams.get('check'));
  const q = u.searchParams.get('q') ?? undefined;
  const kind = (u.searchParams.get('kind') as 'video' | 'photo' | null) ?? undefined;
  const productId = u.searchParams.get('productId') ?? readSettings().arcadsProductId;
  if (isDry()) return NextResponse.json({ ok: true, state: 'dry', count: 0, items: [] });
  const client = createArcadsClient();
  if (!client) return NextResponse.json({ ok: true, state: 'not_configured', count: 0, items: [] });
  if (!productId) return NextResponse.json({ ok: true, state: 'no_product', count: 0, items: [] });
  try {
    const r = await client.assetsLibrary({ productId, q, kind, pageSize: 24 });
    return NextResponse.json({ ok: true, state: 'connected', count: r.count, items: r.items.filter((a) => a.status === 'generated' || a.status === 'uploaded') });
  } catch (err) {
    const ex = explainArcadsError(err);
    return NextResponse.json({ ok: true, state: 'error', error: ex.message, count: 0, items: [] });
  }
}
