import { NextResponse } from 'next/server';
import { labParams, resolveLab } from '@/lib/lab/context';
import { buildSheet } from '@/lib/lab/view/build';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/sheet?<post|event|idea|script|test|setup|ask>=<id> [&st=&ver=&post=(test prefill)&focus=&sample=1]
 *   -> { ok, sheet: SheetPayload } (01 21, D14). One loader for every sheet. An unknown id answers
 *   200 with `view: null`, so the sheet shows its not-found copy (13.4). No sheet param: 400.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (k: string) => url.searchParams.get(k);
  const params = labParams(get);
  if (!params.sheet) return NextResponse.json({ ok: false, error: 'pass one of post, event, idea, script, test, setup, ask' }, { status: 400 });
  const ctx = resolveLab({ sample: params.sample, scenario: get('scenario') });
  const sheet = await buildSheet(params.sheet.kind, params.sheet.id, ctx.store, params, ctx.flags, new Date(), { prefillPost: params.sheet.kind === 'test' ? get('post') : null });
  return NextResponse.json({ ok: true, sheet });
}
