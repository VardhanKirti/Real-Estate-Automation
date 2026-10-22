import { NextResponse } from 'next/server';
import { labParams, resolveLab } from '@/lib/lab/context';
import { buildSheet } from '@/lib/lab/view/build';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/specimen?post=<id>[&sample=1] -> { ok, specimen: PostSheetView } (01 1: kept as an alias
 * for agents and old links; no v2 component calls it, D14). 404 for an unknown id.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const postId = url.searchParams.get('post');
  if (!postId) return NextResponse.json({ ok: false, error: 'post is required' }, { status: 400 });
  const params = labParams((k) => url.searchParams.get(k));
  const ctx = resolveLab({ sample: params.sample });
  const sheet = await buildSheet('post', postId, ctx.store, params, ctx.flags);
  if (!sheet.view) return NextResponse.json({ ok: false, error: 'no such post' }, { status: 404 });
  return NextResponse.json({ ok: true, sample: ctx.flags.sample, specimen: sheet.view });
}
