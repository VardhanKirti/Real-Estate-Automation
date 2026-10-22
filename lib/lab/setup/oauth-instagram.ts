/**
 * Instagram insights OAuth (08.2.5, decision C4): the Instagram API with Instagram Login.
 * Lane S owns it. Section 06 calls refreshInstagramToken() as step 1 of runLedgerCycle (run kind
 * `oauth_refresh`); there is no separate refresh job.
 *
 *   authorize   instagram.com/oauth/authorize (scope instagram_business_basic,instagram_business_manage_insights)
 *   code        POST api.instagram.com/oauth/access_token (short-lived, 1 hour)
 *   long-lived  GET graph.instagram.com/access_token?grant_type=ig_exchange_token (60 days)
 *   refresh     GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *               (token at least 24 h old and unexpired; refreshed when it expires within 15 days)
 *   identity    GET graph.instagram.com/me?fields=user_id,username -> LAB_IG_USER_ID
 * Paste path: an operator pastes LAB_IG_ACCESS_TOKEN; /me fills the user id and the expiry is set
 * to now + 60 days, corrected on the first refresh. Every call goes through labFetch (dry blocks
 * it). No token, secret or code is ever logged.
 */
import { CRED_FILES, resolveCred, upsertEnvLocal } from '@/lib/creds';
import type { LabStore } from '@/lib/lab/store';
import { isDry } from '@/lib/lab/dry';
import { labFetch } from '@/lib/lab/net';
import type { OAuthFetch } from '@/lib/lab/setup/oauth-google';

export const IG_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
export const IG_CODE_URL = 'https://api.instagram.com/oauth/access_token';
export const IG_GRAPH = 'https://graph.instagram.com';
export const IG_SCOPES = 'instagram_business_basic,instagram_business_manage_insights';
/** The env fields this flow writes (writtenBy 'oauth' in LAB_KEYS). */
export const IG_OAUTH_FIELDS = ['LAB_IG_ACCESS_TOKEN', 'LAB_IG_TOKEN_EXPIRES_AT', 'LAB_IG_USER_ID'] as const;

const DAY = 86_400_000;
export const IG_TOKEN_DAYS = 60;
const defaultFetch = (): OAuthFetch => labFetch as unknown as OAuthFetch;
const cred = (name: string) => resolveCred(name, [CRED_FILES.agentsEnv]);

export type InstagramRefreshResult = { refreshed: boolean; expiresAt: string | null; reason: string | null };

export function instagramClient(): { appId: string; appSecret: string } | null {
  const appId = cred('LAB_IG_APP_ID');
  const appSecret = cred('LAB_IG_APP_SECRET');
  return appId && appSecret ? { appId, appSecret } : null;
}

export function instagramRedirectUri(port: string | number = process.env.PORT ?? 3000): string {
  return cred('LAB_IG_REDIRECT_URI') ?? `http://localhost:${port}/api/lab/oauth/instagram/callback`;
}

export function instagramAuthUrl(o: { appId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: o.appId, redirect_uri: o.redirectUri, response_type: 'code', scope: IG_SCOPES, state: o.state });
  return `${IG_AUTHORIZE_URL}?${q.toString()}`;
}

async function getJson(f: OAuthFetch, url: string, init?: Parameters<OAuthFetch>[1]): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await f(url, init);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/** GET /me: the Instagram user id behind a token. */
export async function instagramMe(token: string, f: OAuthFetch = defaultFetch()): Promise<{ userId: string | null; username: string | null }> {
  const r = await getJson(f, `${IG_GRAPH}/me?${new URLSearchParams({ fields: 'user_id,username', access_token: token })}`, { method: 'GET' });
  if (!r.ok) throw new Error(`Instagram /me answered ${r.status}`);
  return { userId: r.data.user_id ? String(r.data.user_id) : r.data.id ? String(r.data.id) : null, username: typeof r.data.username === 'string' ? r.data.username : null };
}

/** Code to short-lived token to long-lived token, then the user id (the callback). */
export async function exchangeInstagramCode(o: { code: string; redirectUri: string; appId: string; appSecret: string; now?: Date }, f: OAuthFetch = defaultFetch()): Promise<{ token: string; expiresAt: string; userId: string | null }> {
  const now = o.now ?? new Date();
  const short = await getJson(f, IG_CODE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: o.appId, client_secret: o.appSecret, grant_type: 'authorization_code', redirect_uri: o.redirectUri, code: o.code }).toString() });
  const shortToken = typeof short.data.access_token === 'string' ? short.data.access_token : null;
  if (!short.ok || !shortToken) throw new Error(`Instagram code exchange answered ${short.status}`);
  const long = await getJson(f, `${IG_GRAPH}/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: o.appSecret, access_token: shortToken })}`, { method: 'GET' });
  const token = typeof long.data.access_token === 'string' ? long.data.access_token : null;
  if (!long.ok || !token) throw new Error(`Instagram long-lived exchange answered ${long.status}`);
  const expiresIn = typeof long.data.expires_in === 'number' ? long.data.expires_in : IG_TOKEN_DAYS * 86_400;
  const me = await instagramMe(token, f);
  return { token, expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(), userId: me.userId };
}

/** The paste path: store a pasted token, fill the user id, and set the expiry to now + 60 days. */
export async function adoptPastedInstagramToken(token: string, opts: { now?: Date; fetch?: OAuthFetch } = {}): Promise<{ userId: string | null; expiresAt: string }> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + IG_TOKEN_DAYS * DAY).toISOString();
  let userId: string | null = null;
  if (!isDry()) {
    try {
      userId = (await instagramMe(token, opts.fetch ?? defaultFetch())).userId;
    } catch {
      userId = null;
    }
  }
  upsertEnvLocal({ LAB_IG_TOKEN_EXPIRES_AT: expiresAt, ...(userId ? { LAB_IG_USER_ID: userId } : {}) });
  return { userId, expiresAt };
}

/** Days until the stored token expires (null when unknown). */
export function instagramDaysLeft(now: Date = new Date()): number | null {
  const at = cred('LAB_IG_TOKEN_EXPIRES_AT');
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? (t - now.getTime()) / DAY : null;
}

/**
 * Refreshes LAB_IG_ACCESS_TOKEN when it is at least 24 h old and expires within 15 days; on
 * failure with under 7 days left the key row turns `expiring` (health:instagram.token warn).
 * No network in dry. Never logs the token.
 */
export async function refreshInstagramToken(store: LabStore, opts: { now?: Date; dry?: boolean; fetch?: OAuthFetch } = {}): Promise<InstagramRefreshResult> {
  const now = opts.now ?? new Date();
  const token = cred('LAB_IG_ACCESS_TOKEN');
  const expiresAt = cred('LAB_IG_TOKEN_EXPIRES_AT') ?? null;
  if (!token) return { refreshed: false, expiresAt, reason: 'Instagram is not connected.' };
  if (opts.dry ?? isDry()) return { refreshed: false, expiresAt, reason: 'Dry: no refresh.' };
  const left = instagramDaysLeft(now);
  if (left !== null && left <= 0) return { refreshed: false, expiresAt, reason: 'The token has expired. Reconnect.' };
  // issued at = expiry - 60 days; must be at least 24 h old
  const issued = left !== null ? now.getTime() - (IG_TOKEN_DAYS - left) * DAY : null;
  if (issued !== null && now.getTime() - issued < DAY) return { refreshed: false, expiresAt, reason: 'The token is under 24 hours old.' };
  if (left !== null && left > 15) return { refreshed: false, expiresAt, reason: null };
  try {
    const r = await getJson(opts.fetch ?? defaultFetch(), `${IG_GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token })}`, { method: 'GET' });
    const next = typeof r.data.access_token === 'string' ? r.data.access_token : null;
    if (!r.ok || !next) throw new Error(`Instagram refresh answered ${r.status}`);
    const expiresIn = typeof r.data.expires_in === 'number' ? r.data.expires_in : IG_TOKEN_DAYS * 86_400;
    const newExpiry = new Date(now.getTime() + expiresIn * 1000).toISOString();
    upsertEnvLocal({ LAB_IG_ACCESS_TOKEN: next, LAB_IG_TOKEN_EXPIRES_AT: newExpiry });
    return { refreshed: true, expiresAt: newExpiry, reason: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Instagram refresh failed';
    if (left !== null && left < 7) {
      store.priors.set({ key: 'health:instagram.token', value: { id: 'instagram.token', state: 'warn', detail: `Expires in ${Math.max(0, Math.floor(left))} days. The refresh failed: ${reason}`, checkedAt: now.toISOString(), network: true }, n: 0, supersedesDefault: false, updatedAt: now.toISOString() });
    }
    return { refreshed: false, expiresAt, reason };
  }
}
