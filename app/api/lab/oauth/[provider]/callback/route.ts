import { NextResponse } from 'next/server';
import { cookieHeader, finishOAuth, isOAuthProvider, oauthCookieName } from '@/lib/lab/setup/oauth-flow';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/lab/oauth/:provider/callback
 *   ?code&state | ?error -> 303 /lab?setup=keys&oauth=<provider>.<ok|denied|error>
 *   no params            -> 200 text/html "No sign-in in progress." (smoke-api)
 * Never echoes a query value into the page.
 */
export async function GET(request: Request, { params }: { params: { provider: string } }) {
  const url = new URL(request.url);
  const provider = params.provider;
  if (!isOAuthProvider(provider)) return new NextResponse('No sign-in in progress.', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const cookie = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${oauthCookieName(provider)}=`))
    ?.slice(oauthCookieName(provider).length + 1) ?? null;
  const outcome = await finishOAuth(provider, url.searchParams, cookie, { port: url.port || process.env.PORT || 3000 });
  if (outcome === 'none') return new NextResponse('No sign-in in progress.', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const res = new NextResponse(null, { status: 303, headers: { Location: `/lab?setup=keys&oauth=${provider}.${outcome}` } });
  res.headers.append('Set-Cookie', cookieHeader(provider, '', 0));
  return res;
}
