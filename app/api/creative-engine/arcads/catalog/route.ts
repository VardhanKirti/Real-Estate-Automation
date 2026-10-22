import { NextResponse } from 'next/server';
import { readCatalog } from '@/lib/arcads/catalog';
import { setupHrefFor } from '@/lib/integrations-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Actors (grouped from situations), voices, products — cached 10 min. Honest state when unkeyed. */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('refresh') === '1';
  const catalog = await readCatalog(force);
  return NextResponse.json({ ok: true, ...catalog, setupHref: setupHrefFor('arcads') });
}
