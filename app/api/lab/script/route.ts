import { NextResponse } from 'next/server';
import { buildLegacyScriptSheet } from '@/lib/lab/view/legacy';
import { resolveLab } from '@/lib/lab/context';
import { scriptSheetView } from '@/lib/lab/gen/view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/script?id=<scriptId>[&ver=<n>][&sample=1] -> { ok, sample, script, legacy } (07 7.16).
 * `script` is 07's ScriptSheetView; `legacy` is the v1 ScriptSheet the v1 page still reads until
 * lane V retires lib/lab/view.ts. 404 for an unknown id.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const ver = Number(url.searchParams.get('ver'));
  const script = scriptSheetView(ctx.store, id, { dry: ctx.flags.dry, sample: ctx.flags.sample, readOnly: ctx.readOnly, version: Number.isInteger(ver) && ver > 0 ? ver : null });
  if (!script) return NextResponse.json({ ok: false, error: 'no such script' }, { status: 404 });
  return NextResponse.json({ ok: true, sample: ctx.flags.sample, script, legacy: buildLegacyScriptSheet(ctx.store, id) });
}
