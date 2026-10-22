/**
 * GitHub new repositories by topic (05 3.4) and the fake-star filter (05 5.5). Free; the
 * token (`GITHUB_TOKEN`, optional, read through lib/creds.ts) raises limits and turns on the
 * stargazer check. Without it the owner-age rule decides (degraded).
 */
import type { FetchLike } from '@/lib/lab/apify-client';
import { GITHUB_TOPICS } from '@/lib/lab/radar/config';
import { emptyRaw, type RawPing } from '@/lib/lab/radar/types';
import { DAY, HOUR, getJson, isRecord, isoOrNull, num, radarFetch, str } from '@/lib/lab/radar/util';
import { resolveCred } from '@/lib/creds';

export const githubToken = (): string | undefined => resolveCred('GITHUB_TOKEN', []);

const authHeaders = (token?: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

export function githubSearchUrl(topic: string, now: Date): string {
  const since = new Date(now.getTime() - 14 * DAY).toISOString().slice(0, 10);
  return `https://api.github.com/search/repositories?q=created:>${since}+topic:${encodeURIComponent(topic)}&sort=stars&order=desc&per_page=30`;
}

export function parseGithubSearch(json: unknown): RawPing[] {
  const items = isRecord(json) && Array.isArray(json.items) ? json.items : [];
  const out: RawPing[] = [];
  for (const it of items) {
    if (!isRecord(it)) continue;
    const full = str(it.full_name);
    if (!full) continue;
    const owner = isRecord(it.owner) ? it.owner : {};
    const repo = full.split('/')[1] ?? full;
    out.push({
      ...emptyRaw('github', full),
      title: [full, str(it.description)].filter(Boolean).join(': '),
      url: str(it.html_url) ?? `https://github.com/${full}`,
      author: str(owner.login),
      vendor: str(owner.login),
      sourceTime: null,
      metric: num(it.stargazers_count),
      name: repo.replace(/-/g, ' '),
      extra: { createdAt: isoOrNull(it.created_at), fullName: full, ownerLogin: str(owner.login) ?? undefined, ownerType: str(owner.type) ?? undefined, topics: Array.isArray(it.topics) ? it.topics.filter((t): t is string => typeof t === 'string') : [] },
    });
  }
  return out;
}

export async function fetchGithubNew(opts: { now?: Date; fetch?: FetchLike; token?: string | null; topics?: readonly string[] } = {}): Promise<RawPing[]> {
  const f = opts.fetch ?? radarFetch;
  const now = opts.now ?? new Date();
  const seen = new Map<string, RawPing>();
  for (const t of opts.topics ?? GITHUB_TOPICS) {
    for (const p of parseGithubSearch(await getJson(f, githubSearchUrl(t, now), { Accept: 'application/vnd.github+json', ...authHeaders(opts.token) }))) if (!seen.has(p.externalId)) seen.set(p.externalId, p);
  }
  return [...seen.values()];
}

/* ── fake-star filter (05 5.5) ─────────────────────────────────────────── */

export type FakeStarResult = { flagged: boolean; reason: string | null; burst: number; of: number; suspicious: number; sampled: number };

/** Step 2: 50% or more of the last page's stars in one 60-minute bucket. */
export function lockstep(starredAt: readonly string[]): { burst: number; of: number } {
  const buckets = new Map<number, number>();
  for (const s of starredAt) {
    const t = Date.parse(s);
    if (!Number.isFinite(t)) continue;
    const b = Math.floor(t / HOUR);
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  return { burst: Math.max(0, ...buckets.values()), of: starredAt.length };
}

/** Step 3: an account created within 30 days before it starred, or with no repos and no followers. */
export function suspiciousAccount(u: { createdAt: string | null; publicRepos: number | null; followers: number | null }, starredAt: string): boolean {
  if (u.createdAt) {
    const age = Date.parse(starredAt) - Date.parse(u.createdAt);
    if (Number.isFinite(age) && age >= 0 && age <= 30 * DAY) return true;
  }
  return u.publicRepos === 0 && u.followers === 0;
}

/** Combine both checks (pure): 05 5.5 steps 2 to 4. */
export function judgeFakeStars(starredAt: readonly string[], accounts: readonly { createdAt: string | null; publicRepos: number | null; followers: number | null; starredAt: string }[]): FakeStarResult {
  const ls = lockstep(starredAt);
  const suspicious = accounts.filter((a) => suspiciousAccount(a, a.starredAt)).length;
  const burstFlag = ls.of > 0 && ls.burst / ls.of >= 0.5;
  const acctFlag = accounts.length > 0 && suspicious / accounts.length >= 0.5;
  const reason = acctFlag
    ? `GitHub: stars look bought (${suspicious} of ${accounts.length} sampled accounts are new or empty)`
    : burstFlag
      ? `GitHub: stars look bought (${ls.burst} of ${ls.of} stars in one hour)`
      : null;
  return { flagged: burstFlag || acctFlag, reason, burst: ls.burst, of: ls.of, suspicious, sampled: accounts.length };
}

const parseUser = (j: unknown) => (isRecord(j) ? { createdAt: isoOrNull(j.created_at), publicRepos: num(j.public_repos), followers: num(j.followers), type: str(j.type) } : { createdAt: null, publicRepos: null, followers: null, type: null });

/** With a token: last stargazer page plus 20 sampled accounts (about 21 core requests). */
export async function fakeStarCheck(fullName: string, stars: number, opts: { token: string; fetch?: FetchLike }): Promise<FakeStarResult> {
  const f = opts.fetch ?? radarFetch;
  const last = Math.max(1, Math.ceil(stars / 100));
  const page = await getJson(f, `https://api.github.com/repos/${fullName}/stargazers?per_page=100&page=${last}`, { Accept: 'application/vnd.github.star+json', ...authHeaders(opts.token) });
  const rows = (Array.isArray(page) ? page : []).filter(isRecord).map((r) => ({ starredAt: str(r.starred_at) ?? '', login: isRecord(r.user) ? str(r.user.login) : null }));
  const sample = rows.filter((_, i) => i % 5 === 0).slice(0, 20);
  const accounts = [];
  for (const s of sample) {
    if (!s.login) continue;
    accounts.push({ ...parseUser(await getJson(f, `https://api.github.com/users/${encodeURIComponent(s.login)}`, authHeaders(opts.token))), starredAt: s.starredAt });
  }
  return judgeFakeStars(rows.map((r) => r.starredAt), accounts);
}

/** Without a token (degraded): qualifies only for an Organization or an owner 180 days old or more. */
export function ownerEstablished(owner: { type: string | null | undefined; createdAt: string | null }, now: Date): boolean {
  if (owner.type === 'Organization') return true;
  return owner.createdAt !== null && now.getTime() - Date.parse(owner.createdAt) >= 180 * DAY;
}

export async function fetchOwner(login: string, opts: { fetch?: FetchLike } = {}): Promise<{ type: string | null; createdAt: string | null }> {
  const u = parseUser(await getJson(opts.fetch ?? radarFetch, `https://api.github.com/users/${encodeURIComponent(login)}`));
  return { type: u.type, createdAt: u.createdAt };
}
