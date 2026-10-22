import { NextResponse } from 'next/server';
import { resolveLab } from '@/lib/lab/context';
import { cookieHeader, isOAuthProvider, startOAuth } from '@/lib/lab/setup/oauth-flow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/lab/oauth/:provider/start (provider youtube | instagram) -> 200 { url } and the state
 * cookie; the client then navigates. A POST so the GET smoke test never starts a flow. 409 when
 * the client id or secret is missing, read-only, or dry (OAuth makes network calls).
 */
export async function POST(request: Request, { params }: { params: { provider: string } }) {
  if (!isOAuthProvider(params.provider)) return NextResponse.json({ ok: false, error: 'unknown_provider' }, { status: 404 });
  const url = new URL(request.url);
  const ctx = resolveLab({ sample: url.searchParams.get('sample') === '1' });
  const out = startOAuth(params.provider, { port: url.port || process.env.PORT || 3000, readOnly: ctx.readOnly });
  if (out.status === 409) return NextResponse.json({ ok: false, error: out.error }, { status: 409 });
  const res = NextResponse.json({ ok: true, url: out.url });
  res.headers.append('Set-Cookie', cookieHeader(params.provider, out.cookie));
  return res;
}
