import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, UNCONFIGURED_REMOTE_MESSAGE, decideGate, isOpenPath, parseTrustedHosts, requestOriginOf } from '@/lib/auth-gate';

/**
 * The gate. With a password set, nothing in GladOS is reachable without the
 * session cookie — pages and every /api route alike. With no password set
 * (a fresh download) the OS is open on this machine only; any non-loopback
 * Host gets a 503 that says how to set one. See lib/auth-gate.ts for the
 * decision table and lib/auth.ts for where the password lives.
 *
 * This runs on the edge runtime, which cannot read .env.local, so it asks the
 * node-side /api/auth/check whether a password exists and whether this cookie
 * is the current session secret. The answer is cached briefly per cookie. The
 * probe always targets the bind address, never the Host header the client sent,
 * so a forged Host cannot steer the check at another server.
 */

// Filming aliases (glados.com and the like) pointed at this machine in
// /etc/hosts. Read once: middleware runs on the edge runtime, where env is
// inlined at build time anyway.
const TRUSTED_HOSTS = parseTrustedHosts(process.env.GLADOS_TRUSTED_HOSTS);

const TTL_MS = 10_000;
const CACHE_MAX = 500;
const cache = new Map<string, { configured: boolean; authed: boolean; at: number }>();

function probeOrigin(req: NextRequest): string {
  const host = (process.env.GLADOS_HOST || '127.0.0.1').trim();
  const bracketed = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  // 4100 is scripts/serve.mjs's default (it always exports PORT, so this is a
  // last resort). req.nextUrl.port is EMPTY on a default-port request (behind
  // a :80 redirect, say), and a wrong port here makes the probe fail, which
  // fails closed and bounces every page to /login.
  const port = (process.env.PORT || '').trim() || req.nextUrl.port || '4100';
  return `http://${bracketed}:${port}`;
}

async function authStatus(req: NextRequest): Promise<{ configured: boolean; authed: boolean }> {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const now = Date.now();
  const hit = cache.get(cookie);
  if (hit && now - hit.at < TTL_MS) return hit;

  try {
    const res = await fetch(`${probeOrigin(req)}/api/auth/check`, {
      headers: cookie ? { cookie: `${SESSION_COOKIE}=${encodeURIComponent(cookie)}` } : {},
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`check ${res.status}`);
    const body = (await res.json()) as { configured?: unknown; authed?: unknown };
    const result = { configured: body.configured === true, authed: body.authed === true, at: now };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(cookie, result);
    return result;
  } catch {
    // Fail CLOSED: if the probe cannot answer, treat the host as locked.
    return { configured: true, authed: false };
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isOpenPath(pathname)) return NextResponse.next();

  // GLADOS_DISABLE_GATE: this gate's whole mechanism (below) is the
  // self-hosted-server model — middleware calls back into "itself" over
  // loopback HTTP to ask whether a password exists. On a serverless
  // deployment (Netlify, Vercel, ...) there is no "itself" to call back
  // into on that address, so the probe always fails closed and every
  // request gets redirected to /login, with no way to actually pass it.
  // Set this flag on such a deployment to make the whole instance public
  // (equivalent to "no password, open to everyone") instead.
  if (process.env.GLADOS_DISABLE_GATE === '1') return NextResponse.next();

  // Self-hosted Next puts its internal host on req.nextUrl, so both the
  // loopback rule and the CSRF origin comparison read the real headers.
  const { hostname, origin: requestOrigin } = requestOriginOf(req.headers);
  const { configured, authed } = await authStatus(req);
  const decision = decideGate({
    pathname,
    method: req.method,
    hostname,
    origin: req.headers.get('origin'),
    requestOrigin,
    configured,
    authed,
    trustedHosts: TRUSTED_HOSTS,
  });

  switch (decision.kind) {
    case 'pass':
      return NextResponse.next();
    case 'cross-origin':
      return NextResponse.json({ error: 'cross-origin request refused' }, { status: 403 });
    case 'unauthorized-api':
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    case 'unconfigured-remote': {
      const message = UNCONFIGURED_REMOTE_MESSAGE.replace('<port>', (process.env.PORT || '').trim() || req.nextUrl.port || '4100');
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: message }, { status: 503 });
      return new NextResponse(
        `<!doctype html><meta charset="utf-8"><title>GladOS · no password set</title>` +
          `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#d7d7d9;font:14px/1.6 system-ui,sans-serif">` +
          `<main style="max-width:440px;padding:24px"><h1 style="font-size:15px;font-weight:600;margin:0 0 8px">GladOS is not reachable from here yet</h1>` +
          `<p style="margin:0;color:#9a9aa0">${message}</p></main>`,
        { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    case 'redirect-login': {
      // Relative to the origin the browser used, not Next's internal host.
      const search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
      return NextResponse.redirect(new URL(`/login${search}`, requestOrigin));
    }
  }
}

export const config = {
  // everything except Next internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico|agents/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|ttf|woff2?)$).*)'],
};
