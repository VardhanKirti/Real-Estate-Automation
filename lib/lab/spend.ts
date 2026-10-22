import { randomUUID } from 'node:crypto';
import { readEnvLocal } from '@/lib/creds';
import { LAB_SPEND_LINES, LAB_SPEND_PROVIDERS, providerOf, type LabRun, type LabRunKind, type LabSpendLine, type LabSpendProvider } from '@/lib/schemas';
import { isDry } from '@/lib/lab/dry';
import type { LabStore } from '@/lib/lab/store';
import { freezeForecast } from '@/lib/lab/setup/forecast-rows';
import { gradeCostForecast } from '@/lib/lab/setup/calibration';

/**
 * Cost control for every paid call the Lab makes (v1 SPEC §7; v2 spec 08.6 and 09.2.6).
 * There is ONE way to spend: `gatedCall`. It
 *   1. decides dry (LAB_DRY=1 or Filming) and, when dry, runs only the `dry` branch:
 *      the `live` branch (and therefore any client, key or network) is never touched;
 *   2. otherwise checks the call's LINE and its PROVIDER (08.6.1, "provider plus line"):
 *      an `off` line or provider (cap 0 or feature flag unset) is refused and cannot be
 *      passed; a line or provider at its monthly cap is refused unless `override` passes it
 *      once (the SpendGate's "Pass the cap once"); a scheduled run never overrides, it records
 *      one `blocked` run and stops;
 *   3. for a reserving call (Apify), computes the reserve `maxTotalChargeUsd` (08.6.3 item 2),
 *      lowered by the estimate's high bound when the caller passes one, raised to the actor's
 *      published minimum, and refused with `needs_headroom` when that minimum does not fit (09.2.6);
 *   4. writes a lab_runs row (with line, job, scheduled, batch), runs the branch, and writes a
 *      lab_spend row: dry → 0 with dry=1 and actual_source 'dry'; live → the reserve, the
 *      estimate's point as est_usd, and the actual charge when the call knows it (Whisper and
 *      embeddings: published price x units), else null until `settleSpend` records it.
 *
 * Month spend counts each non-dry row as `actual ?? est ?? reserved ?? 0`, per line and per
 * provider, so unsettled runs count (v1 counted them as $0).
 */

/* ── providers, lines, caps (08.6.1, 08.6.2; C21) ─────────────────────────────── */

/** Provider caps in USD a month. null = uncapped (the local claude CLI). 0 = off. */
export const DEFAULT_CAPS: Record<LabSpendProvider, number | null> = { apify: 98, stt: 13, comments: 0, downloads: 0, embed: 0, llm: null };

/** Line sub-caps. null = a general line (id equals its provider): bounded by the provider cap only. */
export const DEFAULT_LINE_CAPS: Record<LabSpendLine, number | null> = {
  'apify.sync': 46,
  'apify.snapshots': 22,
  'apify.x': 10,
  'apify.verify': 1,
  'apify.radar_x': 15,
  'apify.radar_tiktok': 3,
  'apify.radar_producthunt': 1,
  stt: null,
  'stt.controls': 3,
  comments: null,
  downloads: null,
  embed: null,
  llm: null,
};

/** Per-run ceiling sent to Apify as maxTotalChargeUsd (LAB_RUN_MAX_USD, 08.6.2). */
export const DEFAULT_RUN_MAX_USD = 3;

/** Lines that are a provider's general line: no sub-cap env. */
export const isGeneralLine = (line: LabSpendLine): boolean => (LAB_SPEND_PROVIDERS as readonly string[]).includes(line);

/** Cap env name rule: `LAB_` + id upper-cased with '.' as '_' + `_CAP_USD`. null for `llm` and general lines. */
export function capEnvFor(target: LabSpendProvider | LabSpendLine): string | null {
  if (target === 'llm') return null;
  const isProvider = (LAB_SPEND_PROVIDERS as readonly string[]).includes(target);
  if (!isProvider && isGeneralLine(target as LabSpendLine)) return null;
  return `LAB_${target.toUpperCase().replace(/\./g, '_')}_CAP_USD`;
}

type Env = Record<string, string | undefined>;
const liveEnv = (): Env => ({ ...process.env, ...readEnvLocal() });

const readCap = (name: string | null, fallback: number | null, env: Env): number | null => {
  if (!name) return fallback;
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The monthly cap in USD for a provider; null = uncapped. A blank or invalid value keeps the default. */
export function capFor(provider: LabSpendProvider, env: Env = liveEnv()): number | null {
  return readCap(capEnvFor(provider), DEFAULT_CAPS[provider], env);
}

/** The sub-cap of a line; null for a general line (the provider cap bounds it). */
export function lineCapFor(line: LabSpendLine, env: Env = liveEnv()): number | null {
  if (isGeneralLine(line)) return null;
  return readCap(capEnvFor(line), DEFAULT_LINE_CAPS[line], env);
}

export function runMaxUsd(env: Env = liveEnv()): number {
  return readCap('LAB_RUN_MAX_USD', DEFAULT_RUN_MAX_USD, env) ?? DEFAULT_RUN_MAX_USD;
}

/** Feature flag per provider (08.6.1). null = no flag. */
export const PROVIDER_FLAGS: Record<LabSpendProvider, { env: string; on: (v: string | undefined) => boolean } | null> = {
  apify: null,
  stt: null, // the OpenAI key gates transcription in lib/lab/transcribe.ts before any gated call
  comments: { env: 'LAB_COMMENTS', on: (v) => v?.trim() === '1' },
  downloads: { env: 'LAB_TIKTOK_DOWNLOADS', on: (v) => v?.trim() === '1' },
  embed: { env: 'LAB_EMBED_PROVIDER', on: (v) => v?.trim() === 'openai' },
  llm: null,
};

/** The X lines refuse on Apify's Free plan (09.5.3): the X scraper allows 5 runs a month there. */
export const X_LINES: readonly LabSpendLine[] = ['apify.x', 'apify.radar_x'];

/**
 * Why a line is off, or null when it can spend (08.6.1 "Off means off"). Off when the provider
 * flag is unset, the provider cap is 0, the line cap is 0, or (X lines) the Apify plan is FREE.
 */
export function lineOffReason(line: LabSpendLine, opts: { env?: Env; store?: LabStore } = {}): string | null {
  const env = opts.env ?? liveEnv();
  const provider = providerOf(line);
  const flag = PROVIDER_FLAGS[provider];
  if (flag && !flag.on(env[flag.env])) return `Off. Turn on with ${flag.env} and a cap above $0.`;
  if (capFor(provider, env) === 0) return `Off. Turn on with ${capEnvFor(provider)} above $0.`;
  if (lineCapFor(line, env) === 0) return `Off. Turn on with ${capEnvFor(line)} above $0.`;
  if (X_LINES.includes(line) && opts.store) {
    const plan = opts.store.priors.get('apify:plan')?.value as { tier?: string } | null | undefined;
    if (plan?.tier === 'FREE') return "The X scraper allows 5 runs a month on Apify's Free plan. X reads are off until you upgrade.";
  }
  return null;
}

export function lineEnabled(line: LabSpendLine, opts: { env?: Env; store?: LabStore } = {}): boolean {
  return lineOffReason(line, opts) === null;
}

/* ── month spend ──────────────────────────────────────────────────────────── */

/** First instant of the calendar month (UTC) containing `now`. */
export function monthStart(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

const round4 = (x: number) => Math.round(x * 10_000) / 10_000;
const rowUsd = (r: { actualUsd: number | null; estUsd: number | null; reservedUsd?: number | null }) => r.actualUsd ?? r.estUsd ?? r.reservedUsd ?? 0;

/** Non-dry dollars this month for a provider: actual where settled, else the estimate, else the reserve, else 0. */
export function monthSpend(store: LabStore, provider: LabSpendProvider, now: Date = new Date()): number {
  return round4(store.spend.since(monthStart(now), provider).filter((r) => !r.dry).reduce((a, r) => a + rowUsd(r), 0));
}

/** Non-dry dollars this month on one line (same counting rule). */
export function lineSpend(store: LabStore, line: LabSpendLine, now: Date = new Date()): number {
  return round4(store.spend.since(monthStart(now), providerOf(line)).filter((r) => !r.dry && r.line === line).reduce((a, r) => a + rowUsd(r), 0));
}

/** Ledger rows this month still waiting on their actual charge. */
export function unsettled(store: LabStore, now: Date = new Date()): number {
  return store.spend.since(monthStart(now)).filter((r) => !r.dry && r.actualUsd === null).length;
}

/** Headroom this month: what the line and its provider can still spend (null = uncapped). */
export function headroom(store: LabStore, line: LabSpendLine, now: Date = new Date(), env: Env = liveEnv()): { line: number | null; provider: number | null; lineSpent: number; providerSpent: number; lineCap: number | null; providerCap: number | null } {
  const provider = providerOf(line);
  const lineCap = lineCapFor(line, env);
  const providerCap = capFor(provider, env);
  const lineSpent = lineSpend(store, line, now);
  const providerSpent = monthSpend(store, provider, now);
  return {
    line: lineCap === null ? null : round4(lineCap - lineSpent),
    provider: providerCap === null ? null : round4(providerCap - providerSpent),
    lineSpent,
    providerSpent,
    lineCap,
    providerCap,
  };
}

/* ── errors ───────────────────────────────────────────────────────────────── */

export type CapReason = 'cap' | 'off' | 'needs_headroom';
export type CapScope = 'line' | 'provider';

export class CapError extends Error {
  /** v2 fields (08.6.3 item 1; `needs_headroom` from 09.2.6). */
  public reason: CapReason;
  public scope: CapScope;
  public line: LabSpendLine | null;
  constructor(public provider: LabSpendProvider, public spent: number, public cap: number, opts: { reason?: CapReason; scope?: CapScope; line?: LabSpendLine | null; message?: string } = {}) {
    super(opts.message ?? `${provider} monthly cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)} spent. Confirm again to pass it once, or raise ${capEnvFor(provider) ?? 'the cap'}.`);
    this.name = 'CapError';
    this.reason = opts.reason ?? 'cap';
    this.scope = opts.scope ?? 'provider';
    this.line = opts.line ?? null;
  }
}

const floorCents = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
const ceilCents = (x: number) => Math.ceil(x * 100 - 1e-9) / 100;

/**
 * What the estimate (09's estimateRun) tells the gate about one run. `low`, `expectedItems`,
 * `known` and `inputs` are frozen into the run's run_cost forecast (09.3.6) so the run is graded
 * at settle and feeds calibration (09.2.5).
 */
export type GateEstimate = { point: number; high: number; minMaxTotalChargeUsd: number | null; low?: number; expectedItems?: number | null; known?: boolean; inputs?: Record<string, unknown> };

export type ReservePlan = { reserveUsd: number; estUsd: number | null };

/**
 * Check line and provider for one call. Returns the reserve to send (reserving calls) or null.
 * Throws CapError: reason 'off' (never passable), 'cap' (passable once with override, never when
 * scheduled), or 'needs_headroom' (the actor's published minimum does not fit; passable once).
 * Dry never throws and reserves nothing.
 */
export function enforceCap(
  store: LabStore,
  req: { provider: LabSpendProvider; line: LabSpendLine; reserve?: boolean; maxRunUsd?: number; estimate?: GateEstimate | null },
  override: boolean,
  now: Date = new Date(),
  env: Env = liveEnv(),
): ReservePlan | null {
  if (isDry()) return null;
  const { provider, line } = req;
  const off = lineOffReason(line, { env, store });
  if (off) {
    const h = headroom(store, line, now, env);
    throw new CapError(provider, h.lineSpent, h.lineCap ?? h.providerCap ?? 0, { reason: 'off', scope: lineCapFor(line, env) === 0 ? 'line' : 'provider', line, message: off });
  }
  const h = headroom(store, line, now, env);
  const reserving = req.reserve ?? provider === 'apify';
  const runMax = Math.min(req.maxRunUsd ?? runMaxUsd(env), runMaxUsd(env));
  const capErr = (scope: CapScope) => {
    const spent = scope === 'line' ? h.lineSpent : h.providerSpent;
    const cap = (scope === 'line' ? h.lineCap : h.providerCap) ?? 0;
    return new CapError(provider, spent, cap, {
      reason: 'cap',
      scope,
      line,
      message: scope === 'line'
        ? `${line} monthly cap reached: $${spent.toFixed(2)} of $${cap.toFixed(2)} spent. Confirm again to pass it once, or raise ${capEnvFor(line)}.`
        : undefined,
    });
  };

  if (!reserving) {
    if (!override) {
      if (h.line !== null && h.line <= 0) throw capErr('line');
      if (h.provider !== null && h.provider <= 0) throw capErr('provider');
    }
    return null;
  }

  // 08.6.3 item 2: reserve = min(run max, line headroom, provider headroom), floored to the cent.
  const caps = override ? [runMax] : [runMax, h.line ?? Infinity, h.provider ?? Infinity];
  let reserve = floorCents(Math.min(...caps));
  if (reserve < 0.01) throw capErr(h.line !== null && h.line < 0.01 ? 'line' : 'provider');
  // 09.2.6: lowered to 1.5 x the estimate's high bound, never below the actor's published minimum.
  const est = req.estimate ?? null;
  const minimum = est?.minMaxTotalChargeUsd ?? null;
  if (minimum !== null && !override && minimum > reserve + 1e-9) {
    throw new CapError(provider, h.lineSpent, h.lineCap ?? h.providerCap ?? 0, {
      reason: 'needs_headroom',
      scope: h.line !== null && (h.provider === null || h.line <= h.provider) ? 'line' : 'provider',
      line,
      message: `This actor needs at least $${minimum.toFixed(2)} headroom.`,
    });
  }
  if (est) reserve = Math.max(minimum ?? 0.01, Math.min(reserve, ceilCents(1.5 * est.high)));
  return { reserveUsd: Math.round(reserve * 100) / 100, estUsd: est ? est.point : null };
}

/* ── the gate ─────────────────────────────────────────────────────────────── */

export type GateRequest = {
  provider: LabSpendProvider;
  /** v2 (required): the line inside the provider; providerOf(line) must equal provider. */
  line: LabSpendLine;
  kind: LabRunKind;
  /** Apify actor id, STT model, or LLM label: what the confirm names. */
  actor?: string | null;
  input?: unknown;
  /** Pass the monthly cap once (only from an explicit confirm in the UI). Never passes an `off` line. */
  override?: boolean;
  /** A scheduled tick: never overrides; a cap stop is recorded as a `blocked` run. */
  scheduled?: boolean;
  /** v2: the LAB_JOBS id that started it (lab_runs.job). */
  job?: string | null;
  /** v2 (09.4.2): the run batch (`lbat-` + 12 hex). */
  batchId?: string | null;
  /** v2: a caller's lower per-run ceiling (e.g. 07's $2 for comments). */
  maxRunUsd?: number;
  /** v2: reserve dollars before starting. Default: provider 'apify'. */
  reserve?: boolean;
  /** v2 (09.2.6): the estimate's point and high bound and the actor's published minimum. */
  estimate?: GateEstimate | null;
  now?: Date;
};

export type LiveOutcome<T> = {
  result: T;
  /** Items, seconds of audio, tokens: the provider's own unit. */
  units: number;
  /** Charged amount when known now; null = settle later from the finished run. */
  actualUsd: number | null;
  /** v2: where a known actualUsd came from. Default: 'provider' for Apify, 'published_price' otherwise. */
  actualSource?: 'provider' | 'published_price';
  /** A published price x units, only when the caller has one. Never invented. */
  estUsd?: number | null;
  /** Apify ids so advance-on-read can find the run. */
  apifyRunId?: string | null;
  datasetId?: string | null;
  /** The run is still going on the provider's side: leave lab_runs `running`. */
  pending?: boolean;
  items?: number | null;
};

export type DryOutcome<T> = { result: T; units?: number; items?: number | null };

export type GateResult<T> = { run: LabRun; result: T; dry: boolean; reserveUsd: number | null };

/** What the live branch is told: the reserve to send as Apify's maxTotalChargeUsd (null when not reserving). */
export type LiveContext = { maxTotalChargeUsd: number | null };

/**
 * The single gate for paid calls. `live` is only invoked when not dry and inside the caps.
 * Throws CapError (after recording a `blocked` run when scheduled) or rethrows the call's
 * own error after marking the run failed.
 */
export async function gatedCall<T>(
  store: LabStore,
  req: GateRequest,
  branches: { live: (run: LabRun, ctx: LiveContext) => Promise<LiveOutcome<T>>; dry: (run: LabRun) => Promise<DryOutcome<T>> | DryOutcome<T> },
): Promise<GateResult<T>> {
  if (providerOf(req.line) !== req.provider) throw new Error(`gatedCall: line ${req.line} does not belong to provider ${req.provider}`);
  const now = req.now ?? new Date();
  const at = now.toISOString();
  const dry = isDry();
  const base: LabRun = {
    id: `lrun-${randomUUID().slice(0, 12)}`,
    kind: req.kind,
    apifyRunId: null,
    datasetId: null,
    actor: req.actor ?? null,
    input: req.input ?? {},
    status: 'running',
    items: null,
    costUsd: null,
    dry,
    startedAt: at,
    finishedAt: null,
    error: null,
    line: req.line,
    job: req.job ?? null,
    scheduled: Boolean(req.scheduled),
    batchId: req.batchId ?? null,
    progress: null,
  };

  let plan: ReservePlan | null = null;
  if (!dry) {
    try {
      plan = enforceCap(store, req, Boolean(req.override) && !req.scheduled, now);
    } catch (err) {
      if (err instanceof CapError && req.scheduled) {
        store.runs.insert({ ...base, status: 'blocked', finishedAt: at, error: err.message });
      }
      throw err;
    }
  }

  store.runs.insert(base);
  try {
    if (dry) {
      const out = await branches.dry(base);
      store.spend.add({ runId: base.id, provider: req.provider, line: req.line, units: out.units ?? 0, estUsd: 0, actualUsd: 0, dry: true, at, actualSource: 'dry' });
      const run = store.runs.update(base.id, { status: 'succeeded', items: out.items ?? null, costUsd: 0, finishedAt: new Date().toISOString() })!;
      return { run, result: out.result, dry: true, reserveUsd: null };
    }
    // 09.3.6: every gated live run that carries an estimate freezes it before it starts
    if (req.estimate) {
      const e = req.estimate;
      freezeForecast(store, { kind: 'run_cost', subject: base.id, inputs: { ...(e.inputs ?? {}), actorId: req.actor ?? null, line: req.line, known: Boolean(e.known), reserveUsd: plan?.reserveUsd ?? null }, predicted: e.point, lo: e.low ?? null, hi: e.high, expectedItems: e.expectedItems ?? null, now, dry: false });
    }
    const out = await branches.live(base, { maxTotalChargeUsd: plan?.reserveUsd ?? null });
    const known = out.actualUsd !== null;
    store.spend.add({
      runId: base.id,
      provider: req.provider,
      line: req.line,
      units: out.units,
      estUsd: plan?.estUsd ?? out.estUsd ?? null,
      actualUsd: out.actualUsd,
      dry: false,
      at,
      reservedUsd: plan?.reserveUsd ?? null,
      actualSource: known ? (out.actualSource ?? (req.provider === 'apify' ? 'provider' : 'published_price')) : null,
      settledAt: known ? at : null,
    });
    const run = store.runs.update(base.id, {
      apifyRunId: out.apifyRunId ?? null,
      datasetId: out.datasetId ?? null,
      items: out.items ?? null,
      costUsd: out.actualUsd,
      status: out.pending ? 'running' : 'succeeded',
      finishedAt: out.pending ? null : new Date().toISOString(),
    })!;
    return { run, result: out.result, dry: false, reserveUsd: plan?.reserveUsd ?? null };
  } catch (err) {
    store.runs.update(base.id, { status: 'failed', finishedAt: new Date().toISOString(), error: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
    // a run that never started cannot be graded: its frozen estimate is voided, not left open
    for (const f of store.forecasts.bySubject(base.id)) if (f.kind === 'run_cost' && f.status === 'open') store.forecasts.grade(f.id, { actual: null, status: 'void', gradedAt: new Date().toISOString() });
    throw err;
  }
}

/**
 * Record a finished run's actual charge (Apify `usageTotalUsd`) on its ledger row and run.
 * v2: `events` = Apify chargedEventCounts; the row gets actual_source 'provider' and settled_at.
 * The run's frozen run_cost forecast (09.3.6) is graded in the same transaction (gradeCostForecast).
 */
export function settleSpend(store: LabStore, runId: string, actualUsd: number, opts: { units?: number; items?: number | null; status?: LabRun['status']; error?: string | null; events?: Record<string, number> | null; now?: Date } = {}): void {
  const at = (opts.now ?? new Date()).toISOString();
  store.transaction(() => {
    store.spend.settle(runId, actualUsd, opts.units, { events: opts.events ?? null, source: 'provider', at });
    // 08.6.3 item 3: the run's frozen run_cost forecast is graded in the same transaction
    gradeCostForecast(store, runId, actualUsd, { items: opts.items ?? null, now: opts.now });
    store.runs.update(runId, {
      costUsd: actualUsd,
      ...(opts.items !== undefined ? { items: opts.items } : {}),
      status: opts.status ?? 'succeeded',
      finishedAt: at,
      error: opts.error ?? null,
    });
  });
}

/* ── meters ───────────────────────────────────────────────────────────────── */

export type SpendMeter = {
  month: string;
  dry: boolean;
  /** v1 shape kept for the v1 page (apify, stt, llm); v2 adds `cap` from 08.6.1 and the per-line rows. */
  providers: { provider: LabSpendProvider; spent: number; cap: number | null; pct: number | null; unsettled: number }[];
  byLine: { line: LabSpendLine; provider: LabSpendProvider; spent: number; cap: number | null; pct: number | null; enabled: boolean; offReason: string | null }[];
  /** A cap stop waiting for the operator (latest blocked run this month), or null. */
  blocked: { runId: string; message: string; at: string; line: LabSpendLine | null } | null;
};

export function spendMeter(store: LabStore, now: Date = new Date()): SpendMeter {
  const since = monthStart(now);
  const rows = store.spend.since(since);
  const env = liveEnv();
  const providers = (['apify', 'stt', 'llm'] as const).map((provider) => {
    const spent = monthSpend(store, provider, now);
    const cap = capFor(provider, env);
    return { provider, spent, cap, pct: cap ? Math.min(1, spent / cap) : null, unsettled: rows.filter((r) => r.provider === provider && !r.dry && r.actualUsd === null).length };
  });
  const byLine = LAB_SPEND_LINES.map((line) => {
    const spent = lineSpend(store, line, now);
    const cap = lineCapFor(line, env) ?? capFor(providerOf(line), env);
    const offReason = lineOffReason(line, { env, store });
    return { line, provider: providerOf(line), spent, cap, pct: cap ? Math.min(1, spent / cap) : null, enabled: offReason === null, offReason };
  });
  const blockedRun = store.runs.recent(200).find((r) => r.status === 'blocked' && r.startedAt >= since) ?? null;
  return {
    month: since.slice(0, 7),
    dry: isDry(),
    providers,
    byLine,
    blocked: blockedRun ? { runId: blockedRun.id, message: blockedRun.error ?? 'Monthly cap reached', at: blockedRun.startedAt, line: blockedRun.line ?? null } : null,
  };
}
