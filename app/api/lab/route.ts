import { NextResponse } from 'next/server';
import { labParams, resolveLab } from '@/lib/lab/context';
import { buildPageView } from '@/lib/lab/view/build';
import { LAB_PAGES, type LabPage } from '@/lib/lab/view/shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isPage = (v: string | null): v is LabPage => LAB_PAGES.some((p) => p.id === v);

/**
 * GET /api/lab?page=today|radar|breakouts|playbook|studio|ledger|creatorverse &<01 2.1 params> [&from=<card index>]
 *   -> { ok, view: <Page>PageView } (01 21, D14). The UI's one page read.
 * GET /api/lab?tab=... -> 410: the v1 tabs were replaced by the /lab pages (01 1).
 * No page and no tab -> the Today view.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const get = (k: string) => url.searchParams.get(k);
  if (get('tab') !== null && get('page') === null) return NextResponse.json({ ok: false, error: 'v1 tabs were replaced by /lab pages' }, { status: 410 });
  const pageParam = get('page');
  if (pageParam !== null && !isPage(pageParam)) return NextResponse.json({ ok: false, error: `page must be one of ${LAB_PAGES.map((p) => p.id).join(', ')}` }, { status: 400 });
  const page: LabPage = pageParam ?? 'today';
  const params = labParams(get);
  const ctx = resolveLab({ sample: params.sample, scenario: get('scenario') });
  const from = Number(get('from'));
  const view = await buildPageView(page, ctx.store, params, ctx.flags, new Date(), { from: Number.isInteger(from) && from > 0 ? from : 0, prefillPost: get('post') });
  return NextResponse.json({ ok: true, view });
}
