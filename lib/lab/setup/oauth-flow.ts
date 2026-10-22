/**
 * The OAuth route logic (08.2.6) shared by app/api/lab/oauth/[provider]/*. Kept out of the route
 * files so it is unit-tested with a fake fetch (AC-08-4).
 *
 * state: 32 random bytes, base64url, in an httpOnly, SameSite=Lax, Path=/api/lab/oauth,
 * 10-minute cookie `lab_oauth_<provider>`, together with the PKCE verifier (YouTube). The callback
 * compares with timingSafeEqual and clears the cookie; a mismatch or missing cookie writes nothing.
 * Tokens are written with upsertEnvLocal only, never logged, never sent to the client; the
 * callback never echoes `code`, `error_description` or any query value.
 */
import { timingSafeEqual } from 'node:crypto';
import { CRED_FILES, removeEnvLocal, resolveCred, upsertEnvLocal } from '@/lib/creds';
import { isDry } from '@/lib/lab/dry';
import { exchangeYoutubeCode, newState, newVerifier, revokeGoogle, youtubeAuthUrl, youtubeClient, youtubeRedirectUri, YT_OAUTH_FIELDS, type OAuthFetch } from '@/lib/lab/setup/oauth-google';
import { exchangeInstagramCode, instagramAuthUrl, instagramClient, instagramRedirectUri, IG_OAUTH_FIELDS } from '@/lib/lab/setup/oauth-instagram';

export type OAuthProvider = 'youtube' | 'instagram';
export const isOAuthProvider = (p: string): p is OAuthProvider => p === 'youtube' || p === 'instagram';
export const oauthCookieName = (p: OAuthProvider) => `lab_oauth_${p}`;
export const OAUTH_COOKIE_PATH = '/api/lab/oauth';
export const OAUTH_COOKIE_MAX_AGE = 600;

export function cookieHeader(p: OAuthProvider, value: string, maxAge = OAUTH_COOKIE_MAX_AGE): string {
  return `${oauthCookieName(p)}=${value}; Path=${OAUTH_COOKIE_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Start: 409 reasons, or the authorize URL and the cookie value. */
export function startOAuth(p: OAuthProvider, o: { port: string | number; readOnly: boolean }): { status: 409; error: string } | { status: 200; url: string; cookie: string } {
  if (o.readOnly) return { status: 409, error: 'read_only' };
  if (isDry()) return { status: 409, error: 'dry' };
  const state = newState();
  if (p === 'youtube') {
    const c = youtubeClient();
    if (!c) return { status: 409, error: 'missing_client' };
    const verifier = newVerifier();
    return { status: 200, url: youtubeAuthUrl({ clientId: c.clientId, redirectUri: youtubeRedirectUri(o.port), state, verifier }), cookie: `${state}.${verifier}` };
  }
  const c = instagramClient();
  if (!c) return { status: 409, error: 'missing_client' };
  return { status: 200, url: instagramAuthUrl({ appId: c.appId, redirectUri: instagramRedirectUri(o.port), state }), cookie: state };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export type CallbackOutcome = 'ok' | 'denied' | 'error' | 'none';

/**
 * The callback. `cookie` is the stored `lab_oauth_<provider>` value. Writes exactly the oauth
 * fields on success, nothing otherwise.
 */
export async function finishOAuth(p: OAuthProvider, q: URLSearchParams, cookie: string | null, o: { port: string | number; now?: Date; fetch?: OAuthFetch }): Promise<CallbackOutcome> {
  const code = q.get('code');
  const state = q.get('state');
  if (!code && !state && !q.get('error')) return 'none';
  if (q.get('error')) return 'denied';
  if (!cookie || !code || !state) return 'error';
  const [savedState, verifier] = cookie.split('.');
  if (!savedState || !same(savedState, state)) return 'error';
  if (isDry()) return 'error';
  const now = o.now ?? new Date();
  try {
    if (p === 'youtube') {
      const c = youtubeClient();
      if (!c || !verifier) return 'error';
      const t = await exchangeYoutubeCode({ code, verifier, redirectUri: youtubeRedirectUri(o.port), clientId: c.clientId, clientSecret: c.clientSecret }, o.fetch);
      upsertEnvLocal({ LAB_YT_REFRESH_TOKEN: t.refreshToken, LAB_YT_CONNECTED_AT: now.toISOString(), ...(t.channelId ? { LAB_YT_CHANNEL_ID: t.channelId } : {}) });
      return 'ok';
    }
    const c = instagramClient();
    if (!c) return 'error';
    const t = await exchangeInstagramCode({ code, redirectUri: instagramRedirectUri(o.port), appId: c.appId, appSecret: c.appSecret, now }, o.fetch);
    upsertEnvLocal({ LAB_IG_ACCESS_TOKEN: t.token, LAB_IG_TOKEN_EXPIRES_AT: t.expiresAt, ...(t.userId ? { LAB_IG_USER_ID: t.userId } : {}) });
    return 'ok';
  } catch {
    return 'error';
  }
}

/** Disconnect: remove the oauth-written fields (Google: also revoke the refresh token, not in dry). */
export async function disconnectOAuth(p: OAuthProvider, o: { fetch?: OAuthFetch } = {}): Promise<void> {
  if (p === 'youtube') {
    const refresh = resolveCred('LAB_YT_REFRESH_TOKEN', [CRED_FILES.agentsEnv]);
    if (refresh && !isDry()) await revokeGoogle(refresh, o.fetch);
    removeEnvLocal([...YT_OAUTH_FIELDS]);
    return;
  }
  removeEnvLocal([...IG_OAUTH_FIELDS]);
}
