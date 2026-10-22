/**
 * YouTube Analytics OAuth (08.2.4, decision C4). Lane S owns the routes, the cookie and the env
 * names (LAB_YT_*). Section 06 only reads, through resolveCred and googleAccessToken().
 *
 * Google "Web application" client, authorization code flow with PKCE (S256), offline access.
 * The refresh token is written to .env.local with upsertEnvLocal; the access token is never stored
 * on disk: it is minted per job and held in process memory until expires_in - 60 s.
 * Every call goes through labFetch (dry blocks it). No token, secret or code is ever logged.
 */
import { createHash, randomBytes } from 'node:crypto';
import { CRED_FILES, resolveCred } from '@/lib/creds';
import { labFetch } from '@/lib/lab/net';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const YT_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true';
export const YT_SCOPES = 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly';

/** The env fields this flow writes (writtenBy 'oauth' in LAB_KEYS). */
export const YT_OAUTH_FIELDS = ['LAB_YT_REFRESH_TOKEN', 'LAB_YT_CHANNEL_ID', 'LAB_YT_CONNECTED_AT'] as const;

export type OAuthFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;
const defaultFetch = (): OAuthFetch => labFetch as unknown as OAuthFetch;

/** Google refused the refresh token: the 7-day Testing trap or a revoked grant (08.2.4). */
export class InvalidGrantError extends Error {
  constructor() {
    super('Google refused the refresh token (invalid_grant). If the app is in Testing, tokens last 7 days.');
    this.name = 'InvalidGrantError';
  }
}

const cred = (name: string) => resolveCred(name, [CRED_FILES.agentsEnv]);

export function youtubeClient(): { clientId: string; clientSecret: string } | null {
  const clientId = cred('LAB_YT_CLIENT_ID');
  const clientSecret = cred('LAB_YT_CLIENT_SECRET');
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** LAB_YT_REDIRECT_URI when set, else the localhost callback on this port. */
export function youtubeRedirectUri(port: string | number = process.env.PORT ?? 3000): string {
  return cred('LAB_YT_REDIRECT_URI') ?? `http://localhost:${port}/api/lab/oauth/youtube/callback`;
}

const b64url = (b: Buffer) => b.toString('base64url');
export const newState = (): string => b64url(randomBytes(32));
export const newVerifier = (): string => b64url(randomBytes(48));
export const challengeOf = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

export function youtubeAuthUrl(o: { clientId: string; redirectUri: string; state: string; verifier: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: YT_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: o.state,
    code_challenge: challengeOf(o.verifier),
    code_challenge_method: 'S256',
  });
  return `${GOOGLE_AUTHORIZE_URL}?${q.toString()}`;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function tokenCall(body: Record<string, string>, f: OAuthFetch): Promise<{ access_token?: string; expires_in?: number; refresh_token?: string }> {
  const res = await f(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; expires_in?: number; refresh_token?: string };
  if (!res.ok) {
    if (data.error === 'invalid_grant') throw new InvalidGrantError();
    throw new Error(`Google token endpoint answered ${res.status}${data.error ? ` (${data.error})` : ''}`);
  }
  return data;
}

/** Code to tokens (the callback), then the channel id. */
export async function exchangeYoutubeCode(o: { code: string; verifier: string; redirectUri: string; clientId: string; clientSecret: string }, f: OAuthFetch = defaultFetch()): Promise<{ refreshToken: string; accessToken: string; channelId: string | null }> {
  const t = await tokenCall({ grant_type: 'authorization_code', code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, client_id: o.clientId, client_secret: o.clientSecret }, f);
  if (!t.refresh_token || !t.access_token) throw new Error('Google returned no refresh token. Remove the app from your Google account and connect again.');
  return { refreshToken: t.refresh_token, accessToken: t.access_token, channelId: await youtubeChannelId(t.access_token, f) };
}

/** The connected channel (GET channels?part=id&mine=true). */
export async function youtubeChannelId(accessToken: string, f: OAuthFetch = defaultFetch()): Promise<string | null> {
  const res = await f(YT_CHANNELS_URL, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`YouTube channels answered ${res.status}`);
  const items = ((await res.json()) as { items?: { id?: string }[] }).items ?? [];
  return items[0]?.id ?? null;
}

let cached: { token: string; until: number; refresh: string } | null = null;
/** Tests reset the in-memory access token. */
export function clearGoogleTokenCache(): void {
  cached = null;
}

/**
 * A short-lived Google access token minted from LAB_YT_REFRESH_TOKEN, held in process memory
 * until expires_in - 60 s; never stored on disk. Null when YouTube is not connected.
 * Throws InvalidGrantError on invalid_grant (the 7-day Testing trap, 08.2.4).
 */
export async function googleAccessToken(opts: { now?: Date; fetch?: OAuthFetch } = {}): Promise<string | null> {
  const now = (opts.now ?? new Date()).getTime();
  const refresh = cred('LAB_YT_REFRESH_TOKEN');
  const client = youtubeClient();
  if (!refresh || !client) return null;
  if (cached && cached.refresh === refresh && cached.until > now) return cached.token;
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: refresh, client_id: client.clientId, client_secret: client.clientSecret }, opts.fetch ?? defaultFetch());
  if (!t.access_token) throw new Error('Google returned no access token');
  cached = { token: t.access_token, until: now + Math.max(0, (t.expires_in ?? 3600) - 60) * 1000, refresh };
  return t.access_token;
}

/** Revoke the refresh token at Google (disconnect). Failures are ignored: the local fields are removed either way. */
export async function revokeGoogle(refreshToken: string, f: OAuthFetch = defaultFetch()): Promise<void> {
  try {
    await f(`${GOOGLE_REVOKE_URL}?${form({ token: refreshToken })}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch {
    /* removed locally regardless */
  }
}
