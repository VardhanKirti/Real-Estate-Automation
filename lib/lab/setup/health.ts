/**
 * Health checks (08.4.1). Network checks run only after the matching key is written, on Check
 * again, and from the scheduler's `health` job every 6 hours; never on page render and never in
 * dry (state `dry`). Their results are cached in lab_priors `health:<id>`. Local checks are
 * computed on every read (the two binaries are cached in memory for 10 minutes).
 *
 * Every network check is free, uses labFetch (or an injected fetch in tests) and never logs a key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { LAB_RADAR_SOURCES, type LabRadarSource } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { CRED_FILES, readEnvLocal, resolveCred } from '@/lib/creds';
import { resolveApifyToken, resolveSttKey } from '@/lib/connectors/apify';
import { isDry } from '@/lib/lab/dry';
import { labFetch } from '@/lib/lab/net';
import { automationDirs, pausedBy } from '@/lib/lab/schedule';
import { dryBrainIsReal, labBrainRoot } from '@/lib/lab/brain';
import { dataDir } from '@/lib/paths';
import { monthStart } from '@/lib/lab/spend';
import { LAB_SCHEMA_VERSION } from '@/lib/db';
import { recordApifyPlan, refreshPriceBooks } from '@/lib/lab/setup/pricing';
import { RECORDED_PRICES_DATE } from '@/lib/lab/setup/pricing-book';
import { fmtDay } from '@/lib/lab/setup/estimate';
import { InvalidGrantError, googleAccessToken, youtubeChannelId, type OAuthFetch } from '@/lib/lab/setup/oauth-google';
import { defaultCadence } from '@/lib/lab/setup/schedule';

export type LabHealthId =
  | 'apify.auth' | 'apify.prices' | 'openai.auth' | 'youtube.token' | 'instagram.token' | 'producthunt.auth' | 'github.auth'
  | 'claude.cli' | 'ffmpeg.bin' | 'lexicon.file'
  | `radar.${LabRadarSource}`
  | 'schedule.heartbeat' | 'schedule.paused' | 'schedule.lock'
  | 'spend.unsettled' | 'spend.blocked'
  | 'db.schema' | 'brain.target';

export type LabHealthState = 'ok' | 'warn' | 'fail' | 'not_configured' | 'off' | 'dry';

export type LabHealthResult = { id: LabHealthId; state: LabHealthState; detail: string; checkedAt: string; network: boolean };

export const NETWORK_CHECKS = ['apify.auth', 'apify.prices', 'openai.auth', 'youtube.token', 'instagram.token', 'producthunt.auth', 'github.auth'] as const satisfies readonly LabHealthId[];
export type NetworkCheckId = (typeof NETWORK_CHECKS)[number];
export const isNetworkCheck = (id: string): id is NetworkCheckId => (NETWORK_CHECKS as readonly string[]).includes(id);

/** Every id, in the order the Setup sheet lists them. */
export const ALL_HEALTH_IDS: readonly LabHealthId[] = [
  ...NETWORK_CHECKS,
  'claude.cli', 'ffmpeg.bin', 'lexicon.file',
  ...LAB_RADAR_SOURCES.map((s) => `radar.${s}` as const),
  'schedule.heartbeat', 'schedule.paused', 'schedule.lock',
  'spend.unsettled', 'spend.blocked',
  'db.schema', 'brain.target',
];

/** The lexicon file 07 fetches (data/lab/lexicon/concreteness.csv). */
export const LEXICON_FILE = () => path.join(dataDir(), 'lab', 'lexicon', 'concreteness.csv');
/** The overlap lock (08.5.3). */
export const TICK_LOCK_FILE = () => path.join(dataDir(), 'lab-tick.lock');

type Env = Record<string, string | undefined>;
const cred = (name: string) => resolveCred(name, [CRED_FILES.agentsEnv]);
const result = (id: LabHealthId, state: LabHealthState, detail: string, now: Date, network: boolean): LabHealthResult => ({ id, state, detail, checkedAt: now.toISOString(), network });

/* ── network checks ───────────────────────────────────────────────────────── */

export type HealthDeps = { fetch?: OAuthFetch; now?: Date };

async function check(id: NetworkCheckId, store: LabStore, f: OAuthFetch, now: Date): Promise<LabHealthResult> {
  const r = (state: LabHealthState, detail: string) => result(id, state, detail, now, true);
  switch (id) {
    case 'apify.auth': {
      const token = resolveApifyToken();
      if (!token) return r('not_configured', 'Paste your Apify token.');
      const res = await f('https://api.apify.com/v2/users/me', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const plan = recordApifyPlan(store, await res.json().catch(() => null), now);
        return r('ok', plan ? `Connected on the ${plan.tier} tier.` : 'Connected.');
      }
      return res.status === 401 || res.status === 403 ? r('fail', 'Apify refused the token.') : r('fail', `Apify did not answer (HTTP ${res.status}).`);
    }
    case 'apify.prices': {
      const out = await refreshPriceBooks(store, now, f);
      if (out.failed.length === 0) return r('ok', out.refreshed.length ? `Prices refreshed for ${out.refreshed.length} actors.` : 'Prices are current.');
      const cached = store.priors.byPrefix('pricing:').map((p) => (p.value as { fetchedAt?: string | null }).fetchedAt).filter((x): x is string => Boolean(x)).sort();
      if (out.refreshed.length || cached.length) return r('warn', `Apify did not answer for ${out.failed.length} actors; using prices from ${fmtDay(cached[0] ?? now.toISOString(), false)}.`);
      return r('fail', `Apify did not answer; estimates use the prices recorded on ${fmtDay(RECORDED_PRICES_DATE, true)}.`);
    }
    case 'openai.auth': {
      const key = resolveSttKey();
      if (!key) return r('not_configured', 'Paste an OpenAI key.');
      const res = await f('https://api.openai.com/v1/models/whisper-1', { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
      if (res.ok) return r('ok', 'Connected.');
      if (res.status === 401) return r('fail', 'OpenAI refused the key.');
      if (res.status === 404) return r('fail', 'This key cannot use whisper-1.');
      return r('fail', `OpenAI did not answer (HTTP ${res.status}).`);
    }
    case 'youtube.token': {
      if (!cred('LAB_YT_REFRESH_TOKEN')) return r('not_configured', cred('LAB_YT_CLIENT_ID') ? 'Not connected.' : 'Paste the client id and secret, then connect.');
      try {
        const access = await googleAccessToken({ now, fetch: f });
        if (!access) return r('not_configured', 'Not connected.');
        const channel = await youtubeChannelId(access, f);
        const stored = cred('LAB_YT_CHANNEL_ID');
        if (stored && channel && stored !== channel) return r('warn', 'Connected to a different channel than before.');
        return r('ok', 'Connected.');
      } catch (err) {
        if (err instanceof InvalidGrantError) return r('fail', err.message);
        return r('fail', err instanceof Error ? err.message : 'YouTube did not answer.');
      }
    }
    case 'instagram.token': {
      const token = cred('LAB_IG_ACCESS_TOKEN');
      if (!token) return r('not_configured', cred('LAB_IG_APP_ID') ? 'Not connected.' : 'Connect Instagram, or paste a token.');
      const res = await f(`https://graph.instagram.com/me?${new URLSearchParams({ fields: 'user_id,username', access_token: token })}`, { method: 'GET' });
      const body = (await res.json().catch(() => ({}))) as { error?: { type?: string; code?: number } };
      if (!res.ok || body.error) {
        if (body.error?.code === 190 || body.error?.type === 'OAuthException' || res.status === 401 || res.status === 400) return r('fail', 'Instagram refused the token. Reconnect.');
        return r('fail', `Instagram did not answer (HTTP ${res.status}).`);
      }
      const exp = cred('LAB_IG_TOKEN_EXPIRES_AT');
      const days = exp ? (Date.parse(exp) - now.getTime()) / 86_400_000 : null;
      if (days !== null && days < 7) return r('warn', `Expires in ${Math.max(0, Math.floor(days))} days.`);
      return r('ok', 'Connected.');
    }
    case 'producthunt.auth': {
      const token = cred('PRODUCTHUNT_TOKEN');
      if (!token) return r('not_configured', 'Paste a Product Hunt developer token.');
      const res = await f('https://api.producthunt.com/v2/api/graphql', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: '{ viewer { user { id } } }' }) });
      const body = (await res.json().catch(() => ({}))) as { errors?: unknown[] };
      if (res.ok && !body.errors?.length) return r('ok', 'Connected.');
      return r('fail', res.status === 401 || body.errors?.length ? 'Product Hunt refused the token.' : `Product Hunt did not answer (HTTP ${res.status}).`);
    }
    case 'github.auth': {
      const token = cred('GITHUB_TOKEN');
      if (!token) return r('not_configured', 'Optional. Without it GitHub is read unauthenticated.');
      const res = await f('https://api.github.com/rate_limit', { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'content-lab' } });
      if (res.status === 401) return r('fail', 'GitHub refused the token.');
      if (!res.ok) return r('fail', `GitHub did not answer (HTTP ${res.status}).`);
      const limit = ((await res.json().catch(() => ({}))) as { resources?: { search?: { limit?: number } } }).resources?.search?.limit ?? 0;
      return limit >= 30 ? r('ok', 'Connected.') : r('warn', `Search limit is ${limit} a minute; the token may be unauthenticated.`);
    }
  }
}

/** Run one network check (dry: state `dry`, nothing called) and cache it in `health:<id>`. */
export async function runNetworkCheck(store: LabStore, id: NetworkCheckId, deps: HealthDeps = {}): Promise<LabHealthResult> {
  const now = deps.now ?? new Date();
  let out: LabHealthResult;
  if (isDry()) out = result(id, 'dry', 'Dry: not checked', now, true);
  else {
    try {
      out = await check(id, store, deps.fetch ?? (labFetch as unknown as OAuthFetch), now);
    } catch (err) {
      out = result(id, 'fail', err instanceof Error ? err.message.slice(0, 200) : 'The check failed.', now, true);
    }
  }
  if (out.state !== 'dry') store.priors.set({ key: `health:${id}`, value: out, n: 0, supersedesDefault: false, updatedAt: out.checkedAt });
  return out;
}

/** The checks one key row depends on, run after a write (08.2.3). */
export async function runNetworkChecks(store: LabStore, ids: readonly NetworkCheckId[] = NETWORK_CHECKS, deps: HealthDeps = {}): Promise<LabHealthResult[]> {
  const out: LabHealthResult[] = [];
  for (const id of ids) out.push(await runNetworkCheck(store, id, deps));
  return out;
}

/* ── local checks ─────────────────────────────────────────────────────────── */

const binCache = new Map<string, { ok: boolean; at: number }>();
export type BinProbe = (cmd: string, args: string[]) => boolean;
const realProbe: BinProbe = (cmd, args) => {
  try {
    return spawnSync(cmd, args, { timeout: 5000, stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};
let probe: BinProbe = realProbe;
/** Tests inject the binary probe (and clear the 10-minute cache). */
export function setBinProbe(p: BinProbe | null): void {
  probe = p ?? realProbe;
  binCache.clear();
}
function binOk(cmd: string, args: string[], now: number): boolean {
  const c = binCache.get(cmd);
  if (c && now - c.at < 10 * 60_000) return c.ok;
  const ok = probe(cmd, args);
  binCache.set(cmd, { ok, at: now });
  return ok;
}

type JobStateLike = { lastAt?: string | null; lastOkAt?: string | null; lastDetail?: string; fails?: number } | null | undefined;
const jobState = (store: LabStore, id: string) => store.priors.get(`job:${id}`)?.value as JobStateLike;
const ago = (iso: string, now: Date) => {
  const m = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  return m < 90 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};

/** Radar sources whose prerequisites are missing (not_configured). */
function radarPrereq(store: LabStore, source: LabRadarSource): string | null {
  if (source === 'x') {
    if (!resolveApifyToken()) return 'Needs an Apify key.';
    if (!store.sources.all('watch').some((s) => s.status === 'active')) return 'Add accounts to the X watch list.';
  }
  if (source === 'tiktok_cc' && !resolveApifyToken()) return 'Needs an Apify key.';
  if (source === 'producthunt' && !resolveApifyToken() && !cred('PRODUCTHUNT_TOKEN')) return 'Needs a Product Hunt token or an Apify key.';
  return null;
}

/** Every local check, computed now. No network. */
export function localChecks(store: LabStore, opts: { now?: Date; env?: Env } = {}): LabHealthResult[] {
  const now = opts.now ?? new Date();
  const env = opts.env ?? { ...process.env, ...readEnvLocal() };
  const T = now.getTime();
  const out: LabHealthResult[] = [];
  const r = (id: LabHealthId, state: LabHealthState, detail: string) => out.push(result(id, state, detail, now, false));

  r('claude.cli', binOk('claude', ['--version'], T) ? 'ok' : 'fail', binOk('claude', ['--version'], T) ? 'The claude CLI answers on this machine.' : 'Dissection, ideas and scripts need the claude CLI on this machine.');
  if (env.LAB_FRAMES?.trim() !== '1') r('ffmpeg.bin', 'off', 'Frame contact sheets are off.');
  else {
    const ok = binOk('ffmpeg', ['-version'], T) && binOk('ffprobe', ['-version'], T);
    r('ffmpeg.bin', ok ? 'ok' : 'fail', ok ? 'ffmpeg and ffprobe answer.' : 'Frames need ffmpeg on this host.');
  }
  // the pinned-hash comparison is 07's loadLexicon(); presence is what can be said here
  const lastFetch = store.priors.get('lexicon:last_fetch')?.value as { ok?: boolean; reason?: string } | null | undefined;
  if (lastFetch && lastFetch.ok === false && lastFetch.reason === 'hash') r('lexicon.file', 'fail', 'The lexicon file does not match the pinned version. Fetch it again.');
  else r('lexicon.file', fs.existsSync(LEXICON_FILE()) ? 'ok' : 'not_configured', fs.existsSync(LEXICON_FILE()) ? 'The lexicon file is present.' : 'Not fetched yet.');

  const disabled = new Set(((store.priors.get('radar:disabled')?.value as unknown) ?? []) as string[]);
  for (const source of LAB_RADAR_SOURCES) {
    const id = `radar.${source}` as LabHealthId;
    if (disabled.has(source)) {
      r(id, 'off', 'Turned off in Setup.');
      continue;
    }
    const missing = radarPrereq(store, source);
    if (missing) {
      r(id, 'not_configured', missing);
      continue;
    }
    const st = jobState(store, `radar.${source}`);
    const cad = defaultCadence(`radar.${source}` as never, env);
    const cadenceMin = cad.kind === 'interval' ? cad.everyMin : 24 * 60;
    if (!st?.lastOkAt) {
      r(id, st?.lastAt ? 'fail' : 'warn', st?.lastAt ? `Has not read yet: ${st.lastDetail ?? 'failed'}.` : 'Has not run yet.');
      continue;
    }
    const age = (T - Date.parse(st.lastOkAt)) / 60_000;
    if ((st.fails ?? 0) >= 3) r(id, 'fail', `The last ${st.fails} reads failed.`);
    else if (age <= 2 * cadenceMin) r(id, 'ok', `Read ${ago(st.lastOkAt, now)} ago.`);
    else if (age <= 6 * cadenceMin) r(id, 'warn', `Last read ${ago(st.lastOkAt, now)} ago.`);
    else r(id, 'fail', `Last read ${ago(st.lastOkAt, now)} ago.`);
  }

  const tick = jobState(store, 'tick');
  const scheduled = Boolean(store.priors.get('schedule'));
  if (!tick?.lastOkAt) r('schedule.heartbeat', scheduled ? 'fail' : 'not_configured', scheduled ? 'No tick has run yet.' : 'Not scheduled yet');
  else {
    const age = (T - Date.parse(tick.lastOkAt)) / 60_000;
    if (age <= 30) r('schedule.heartbeat', 'ok', `Last tick ${ago(tick.lastOkAt, now)} ago.`);
    else if (age <= 120) r('schedule.heartbeat', 'warn', `Last tick ${ago(tick.lastOkAt, now)} ago.`);
    else r('schedule.heartbeat', scheduled ? 'fail' : 'warn', `The last tick was ${ago(tick.lastOkAt, now)} ago. If this Mac slept, missed jobs run once on the next tick.`);
  }
  const by = pausedBy(automationDirs(env), fs.existsSync);
  r('schedule.paused', by ? 'warn' : 'ok', by ? (path.basename(by) === 'PAUSED' ? `Paused for all automation by PAUSED in ${path.dirname(by)}.` : 'Paused by PAUSED-lab. Nothing runs or spends until you resume.') : 'Not paused.');
  const removed = store.priors.get('schedule:lock_removed')?.value as { at?: string } | null | undefined;
  r('schedule.lock', removed?.at && T - Date.parse(removed.at) < 24 * 3_600_000 ? 'warn' : 'ok', removed?.at && T - Date.parse(removed.at) < 24 * 3_600_000 ? 'A stale tick lock was removed.' : fs.existsSync(TICK_LOCK_FILE()) ? 'A tick is running.' : 'No lock.');

  const since = monthStart(now);
  const unsettledN = store.spend.since(since).filter((s) => !s.dry && s.actualUsd === null && T - Date.parse(s.at) > 24 * 3_600_000).length
    + store.spend.all().filter((s) => !s.dry && s.actualUsd === null && s.at < since && T - Date.parse(s.at) > 24 * 3_600_000).length;
  r('spend.unsettled', unsettledN ? 'warn' : 'ok', unsettledN ? `${unsettledN} charges not settled. The cap counts their reserve.` : 'Every charge is settled.');
  const blocked = store.runs.recent(200).find((x) => x.status === 'blocked' && x.startedAt >= since) ?? null;
  r('spend.blocked', blocked ? 'warn' : 'ok', blocked ? blocked.error ?? 'A run was stopped by a cap.' : 'No run was stopped by a cap this month.');

  const v = (store.priors.get('schema_version')?.value as { v?: number } | null | undefined)?.v ?? 1;
  r('db.schema', v >= LAB_SCHEMA_VERSION ? 'ok' : 'fail', v >= LAB_SCHEMA_VERSION ? `Schema version ${v}.` : 'Database not migrated. Restart the server.');
  const root = labBrainRoot();
  const dryNow = isDry();
  const intoReal = dryBrainIsReal();
  r('brain.target', intoReal ? 'fail' : 'ok', intoReal ? 'Dry run would write into the real brain.' : dryNow ? `Brain docs from dry runs go to ${root}.` : 'Brain docs go to the brain store.');
  return out;
}

/**
 * Every check for the Setup view: network ones from their cache (dry: `dry`; never checked:
 * not_configured or a "not checked yet" warn), local ones computed now. Makes no network call.
 */
export function healthResults(store: LabStore, opts: { now?: Date; env?: Env } = {}): LabHealthResult[] {
  const now = opts.now ?? new Date();
  const dry = isDry();
  const net = NETWORK_CHECKS.map((id): LabHealthResult => {
    if (dry) return result(id, 'dry', 'Dry: not checked', now, true);
    const cachedRaw = store.priors.get(`health:${id}`)?.value as LabHealthResult | null | undefined;
    if (cachedRaw?.state) return cachedRaw;
    const configured = id === 'apify.auth' || id === 'apify.prices' ? (id === 'apify.prices' ? true : Boolean(resolveApifyToken())) : id === 'openai.auth' ? Boolean(resolveSttKey()) : id === 'youtube.token' ? Boolean(cred('LAB_YT_REFRESH_TOKEN')) : id === 'instagram.token' ? Boolean(cred('LAB_IG_ACCESS_TOKEN')) : id === 'producthunt.auth' ? Boolean(cred('PRODUCTHUNT_TOKEN')) : Boolean(cred('GITHUB_TOKEN'));
    return configured ? result(id, 'warn', id === 'apify.prices' ? `Using the prices recorded on ${fmtDay(RECORDED_PRICES_DATE, true)}.` : 'Not checked yet.', now, true) : result(id, 'not_configured', 'Not configured', now, true);
  });
  return [...net, ...localChecks(store, { now, env: opts.env })];
}
