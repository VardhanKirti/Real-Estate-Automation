import { NextResponse } from 'next/server';
import { resolveLab } from '@/lib/lab/context';
import { isDry } from '@/lib/lab/dry';
import { LAB_KEYS } from '@/lib/lab/setup/keys';
import { keyRow } from '@/lib/lab/setup/key-rows';
import { healthResults } from '@/lib/lab/setup/health';
import { disconnectOAuth, isOAuthProvider } from '@/lib/lab/setup/oauth-flow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** POST /api/lab/oauth/:provider/disconnect -> 200 { row }: removes the oauth-written fields (Google: also revokes). */
export async function POST(request: Request, { params }: { params: { provider: string } }) {
  if (!isOAuthProvider(params.provider)) return NextResponse.json({ ok: false, error: 'unknown_provider' }, { status: 404 });
  const ctx = resolveLab({ sample: new URL(request.url).searchParams.get('sample') === '1' });
  if (ctx.readOnly) return NextResponse.json({ ok: false, error: 'read_only' }, { status: 409 });
  await disconnectOAuth(params.provider);
  ctx.store.priors.remove(params.provider === 'youtube' ? 'health:youtube.token' : 'health:instagram.token');
  const spec = LAB_KEYS.find((k) => k.id === params.provider)!;
  return NextResponse.json({ ok: true, row: keyRow(spec, { health: healthResults(ctx.store), dry: isDry(), store: ctx.store }) });
}
