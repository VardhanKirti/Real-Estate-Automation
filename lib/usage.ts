/**
 * Token burn per plan (Claude, ChatGPT/Codex, Ollama), per model and per
 * machine (pages/usage.md §2). Line parsers ported from the 2026-10-06 parts
 * bin (lib/usage.ts); the reader and the summary are written for this build.
 *
 * Sources, all free and local (no LLM, no paid API):
 *   - Claude Code appends per-message `usage` blocks to
 *     ~/.claude/projects/**\/*.jsonl (CLAUDE_PROJECTS_DIR overrides).
 *   - Codex logs cumulative `token_count` events, which also carry the plan's
 *     OFFICIAL used_percent for its 5-hour and weekly windows
 *     (~/.codex/sessions, CODEX_SESSIONS_DIR overrides).
 *   - Ollama has no usage API: its card is status only (GET /api/ps on
 *     127.0.0.1), unless a machine pushes Ollama readings.
 *   - Other machines push their readings (POST /api/usage/push, usage_readings).
 *
 * Burn = input + output + cache writes; cache reads are not counted (FO rule).
 * A plan no source reported is "not reported", never 0 (U-2). An official
 * gauge appears only when a provider reported one (U-3).
 *
 * The page never parses on its request (U-4): readLocalUsage() keeps a 60 s
 * cache, serves a stale value while one refresh runs behind it, and folds
 * transcripts incrementally (per-file offsets), so a poll costs a stat.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UsagePlan, UsageReading } from '@/lib/schemas';

export const USAGE_REFRESH_MS = 60_000;
/** A pushed machine older than this is shown stale (FO STALE_PUSH). */
export const STALE_PUSH_MS = 15 * 60_000;
const KEEP_DAYS = 31;
const DAY = 86_400_000;

export type Tot = { input: number; output: number; cacheWrite: number };
export const burnOf = (t: Tot) => t.input + t.output + t.cacheWrite;

/** Local calendar day for an ISO timestamp: the day the operator lived. */
export function dayKey(ts: string | number | Date): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const pos = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

// ── line parsers (pure) ────────────────────────────────────────────────────

export type ClaudeLine = { ts: string; model: string; cwd?: string; entrypoint?: string } & Tot;

/** One Claude transcript line → counters, or null for anything that is not an
 *  assistant message with a usage block. */
export function parseClaudeLine(line: string): ClaudeLine | null {
  if (!line.includes('"usage"')) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (d.type !== 'assistant' || typeof d.timestamp !== 'string') return null;
  const msg = d.message as { model?: unknown; usage?: Record<string, unknown> } | undefined;
  const u = msg?.usage;
  if (!u) return null;
  return {
    ts: d.timestamp,
    model: typeof msg?.model === 'string' && msg.model ? msg.model : 'unknown',
    input: pos(u.input_tokens),
    output: pos(u.output_tokens),
    cacheWrite: pos(u.cache_creation_input_tokens),
    ...(typeof d.cwd === 'string' ? { cwd: d.cwd } : {}),
    ...(typeof d.entrypoint === 'string' ? { entrypoint: d.entrypoint } : {}),
  };
}

// ── lanes: where the tokens burn (FO `sources`, ported from the parts bin) ──

/** The lanes tokens burn in, in display order. */
export const BURN_LANES = ['board', 'sessions', 'terminal', 'automation'] as const;
export type BurnLane = (typeof BURN_LANES)[number];
export const LANE_LABEL: Record<BurnLane, string> = {
  board: 'Agent board',
  sessions: 'My sessions',
  terminal: 'Terminal',
  automation: 'Crons and headless',
};

/** Board seats and Superset sessions, from the working directory. */
function laneFromCwd(cwd: string | undefined): BurnLane | null {
  if (!cwd) return null;
  if (cwd.includes('/.paperclip/')) return 'board';
  if (/\/\.superset\/(worktrees|projects)\//.test(cwd)) return 'sessions';
  return null;
}

/** One Claude transcript line → its lane. Headless (sdk-*) runs outside the
 *  board are crons and scripts; anything else interactive is a terminal. */
export function classifyClaude(x: { cwd?: string; entrypoint?: string }): BurnLane {
  return laneFromCwd(x.cwd) ?? (x.entrypoint?.startsWith('sdk') ? 'automation' : 'terminal');
}

/** One Codex session → its lane, from session_meta's cwd and originator. */
export function classifyCodex(x: { cwd?: string; originator?: string; source?: string }): BurnLane {
  return laneFromCwd(x.cwd) ?? (x.originator === 'codex_exec' || x.source === 'exec' ? 'automation' : 'terminal');
}

/** A Codex `session_meta` line → where the session ran, or null. */
export function parseCodexMeta(line: string): { cwd?: string; originator?: string; source?: string } | null {
  if (!line.includes('session_meta')) return null;
  try {
    const d = JSON.parse(line) as { type?: unknown; payload?: Record<string, unknown> };
    if (d.type !== 'session_meta' || !d.payload) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    return { cwd: str(d.payload.cwd), originator: str(d.payload.originator), source: str(d.payload.source) };
  } catch {
    return null;
  }
}

export type OfficialWindow = { usedPercent: number; windowMinutes: number; resetsAt: string | null };
export type CodexLine = { ts: string; cumulative: { input: number; output: number }; session: OfficialWindow | null; weekly: OfficialWindow | null };

function codexWindow(w: unknown): OfficialWindow | null {
  const o = w as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown } | undefined;
  if (!o || typeof o.used_percent !== 'number' || typeof o.window_minutes !== 'number') return null;
  return { usedPercent: o.used_percent, windowMinutes: o.window_minutes, resetsAt: typeof o.resets_at === 'number' ? new Date(o.resets_at * 1000).toISOString() : null };
}

/** A Codex `token_count` event: CUMULATIVE for its session, plus any official gauge. */
export function parseCodexLine(line: string): CodexLine | null {
  if (!line.includes('token_count')) return null;
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  const payload = d.payload as { type?: unknown; info?: { total_token_usage?: Record<string, unknown> }; rate_limits?: Record<string, unknown> } | undefined;
  if (d.type !== 'event_msg' || payload?.type !== 'token_count') return null;
  const t = payload.info?.total_token_usage;
  if (!t || typeof d.timestamp !== 'string') return null;
  let session: OfficialWindow | null = null;
  let weekly: OfficialWindow | null = null;
  // Assign by window length, not slot: Codex reports the weekly window as `primary` at times.
  for (const w of payload.rate_limits ? [codexWindow(payload.rate_limits.primary), codexWindow(payload.rate_limits.secondary)] : []) {
    if (!w) continue;
    if (w.windowMinutes >= 7 * 24 * 60 * 0.9) weekly = w;
    else session = w;
  }
  return { ts: d.timestamp, cumulative: { input: pos(t.input_tokens), output: pos(t.output_tokens) }, session, weekly };
}

// ── the local reader (incremental, cached) ─────────────────────────────────

type FileState = {
  size: number;
  offset: number;
  mtimeMs: number;
  perDayModel: Record<string, Record<string, Tot>>;
  /** Claude: burn per day per lane, folded with the models */
  perDayLane: Record<string, Partial<Record<BurnLane, number>>>;
  codexLast: CodexLine | null;
  /** Codex: the session's lane from its session_meta line */
  codexLane: BurnLane | null;
};
const newFileState = (): FileState => ({ size: 0, offset: 0, mtimeMs: 0, perDayModel: {}, perDayLane: {}, codexLast: null, codexLane: null });

/** This machine's burn per plan, day and lane (pushes carry no lanes). */
export type LaneReading = { plan: UsagePlan; day: string; lane: BurnLane; burn: number };

export type LocalUsage = {
  machine: string;
  /** Rows shaped like pushed readings, pushedAt = when this read ran. */
  readings: UsageReading[];
  /** Burn per lane on this machine only. */
  lanes: LaneReading[];
  /** Which local sources exist on this machine (a missing folder is not 0). */
  sources: { claude: boolean; codex: boolean };
  official: { codex: { session: OfficialWindow | null; weekly: OfficialWindow | null; at: string } | null };
  readAt: string;
  parseMs: number;
};

export function claudeDir(): string {
  return process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
}
export function codexDir(): string {
  return process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), '.codex', 'sessions');
}
export function machineName(): string {
  return (process.env.GLADOS_USAGE_MACHINE || os.hostname().replace(/\.local$/i, '')).slice(0, 120) || 'this machine';
}

function listJsonl(dir: string, newerThanMs: number, maxDepth: number): { file: string; size: number; mtimeMs: number }[] {
  const out: { file: string; size: number; mtimeMs: number }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(p);
          if (st.mtimeMs >= newerThanMs) out.push({ file: p, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* raced deletion */
        }
      }
    }
  };
  walk(dir, 0);
  return out;
}

/** Read the complete lines appended since `state.offset`. */
function tailLines(file: string, state: FileState, size: number): string[] {
  if (size < state.size) {
    // rewritten shorter: start again
    state.offset = 0;
    state.perDayModel = {};
    state.perDayLane = {};
    state.codexLast = null;
    state.codexLane = null;
  }
  if (size <= state.offset) return [];
  const fd = fs.openSync(file, 'r');
  try {
    const len = size - state.offset;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, state.offset);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return []; // partial line: fold it next time, once complete
    state.offset += Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
    return text.slice(0, lastNl).split('\n');
  } finally {
    fs.closeSync(fd);
  }
}

type ReaderCache = { files: Map<string, FileState>; value: LocalUsage | null; at: number; pending: Promise<LocalUsage> | null };
const g = globalThis as typeof globalThis & { __gladosUsage?: ReaderCache };
const cache: ReaderCache = (g.__gladosUsage ??= { files: new Map(), value: null, at: 0, pending: null });

/** Test hook. */
export function resetUsageCache(): void {
  cache.files.clear();
  cache.value = null;
  cache.at = 0;
  cache.pending = null;
}

/** One full pass over this machine's transcripts (incremental per file). */
export function scanLocalUsage(now: Date = new Date()): LocalUsage {
  const started = Date.now();
  const since = now.getTime() - KEEP_DAYS * DAY;
  const keepFrom = dayKey(since);
  const readAt = now.toISOString();
  const machine = machineName();
  const agg = new Map<string, Tot>(); // plan|day|model
  const add = (plan: UsagePlan, day: string, model: string, t: Tot) => {
    if (day < keepFrom) return;
    const k = `${plan}|${day}|${model}`;
    const cur = agg.get(k) ?? { input: 0, output: 0, cacheWrite: 0 };
    agg.set(k, { input: cur.input + t.input, output: cur.output + t.output, cacheWrite: cur.cacheWrite + t.cacheWrite });
  };
  const laneAgg = new Map<string, number>(); // plan|day|lane
  const addLane = (plan: UsagePlan, day: string, lane: BurnLane, burn: number) => {
    if (day < keepFrom || burn <= 0) return;
    const k = `${plan}|${day}|${lane}`;
    laneAgg.set(k, (laneAgg.get(k) ?? 0) + burn);
  };
  const seen = new Set<string>();

  const cDir = claudeDir();
  const claudeExists = fs.existsSync(cDir);
  if (claudeExists) {
    for (const f of listJsonl(cDir, since, 3)) {
      seen.add(f.file);
      const st = cache.files.get(f.file) ?? newFileState();
      for (const line of tailLines(f.file, st, f.size)) {
        const p = parseClaudeLine(line);
        if (!p) continue;
        const day = dayKey(p.ts);
        const m = ((st.perDayModel[day] ??= {})[p.model] ??= { input: 0, output: 0, cacheWrite: 0 });
        m.input += p.input;
        m.output += p.output;
        m.cacheWrite += p.cacheWrite;
        const lane = classifyClaude(p);
        const l = (st.perDayLane[day] ??= {});
        l[lane] = (l[lane] ?? 0) + burnOf(p);
      }
      st.size = f.size;
      st.mtimeMs = f.mtimeMs;
      cache.files.set(f.file, st);
      for (const [day, models] of Object.entries(st.perDayModel)) for (const [model, t] of Object.entries(models)) add('claude', day, model, t);
      for (const [day, lanes] of Object.entries(st.perDayLane)) for (const [lane, b] of Object.entries(lanes)) addLane('claude', day, lane as BurnLane, b ?? 0);
    }
  }

  const xDir = codexDir();
  const codexExists = fs.existsSync(xDir);
  let official: LocalUsage['official']['codex'] = null;
  if (codexExists) {
    for (const f of listJsonl(xDir, since, 4)) {
      seen.add(f.file);
      const st = cache.files.get(f.file) ?? newFileState();
      for (const line of tailLines(f.file, st, f.size)) {
        const meta = st.codexLane ? null : parseCodexMeta(line);
        if (meta) st.codexLane = classifyCodex(meta);
        const p = parseCodexLine(line);
        if (p) st.codexLast = { ...p, session: p.session ?? st.codexLast?.session ?? null, weekly: p.weekly ?? st.codexLast?.weekly ?? null };
      }
      st.size = f.size;
      st.mtimeMs = f.mtimeMs;
      cache.files.set(f.file, st);
      const last = st.codexLast;
      if (!last) continue;
      // Cumulative per session: the session's final total lands on its last day.
      add('codex', dayKey(last.ts), 'codex', { input: last.cumulative.input, output: last.cumulative.output, cacheWrite: 0 });
      addLane('codex', dayKey(last.ts), st.codexLane ?? 'terminal', last.cumulative.input + last.cumulative.output);
      if ((last.session || last.weekly) && (!official || last.ts > official.at)) official = { session: last.session, weekly: last.weekly, at: last.ts };
    }
  }
  for (const k of [...cache.files.keys()]) if (!seen.has(k)) cache.files.delete(k);

  const readings: UsageReading[] = [...agg.entries()].map(([k, t]) => {
    const [plan, day, model] = k.split('|') as [UsagePlan, string, string];
    return { machine, plan, day, model, input: t.input, output: t.output, cacheWrite: t.cacheWrite, pushedAt: readAt };
  });
  const lanes: LaneReading[] = [...laneAgg.entries()].map(([k, burn]) => {
    const [plan, day, lane] = k.split('|') as [UsagePlan, string, BurnLane];
    return { plan, day, lane, burn };
  });
  return { machine, readings, lanes, sources: { claude: claudeExists, codex: codexExists }, official: { codex: official }, readAt, parseMs: Date.now() - started };
}

/**
 * The cached local reading. Fresh (< 60 s) returns at once; stale returns the
 * last value and starts one refresh; only a cold process waits for a scan.
 */
export async function readLocalUsage(opts: { now?: Date; force?: boolean } = {}): Promise<LocalUsage> {
  const now = opts.now ?? new Date();
  const age = now.getTime() - cache.at;
  const refresh = () => {
    cache.pending ??= Promise.resolve()
      .then(() => scanLocalUsage(now))
      .then((v) => {
        cache.value = v;
        cache.at = Date.now();
        return v;
      })
      .finally(() => {
        cache.pending = null;
      });
    return cache.pending;
  };
  if (cache.value && !opts.force) {
    if (age >= USAGE_REFRESH_MS) void refresh().catch(() => undefined);
    return cache.value;
  }
  return refresh();
}

// ── Ollama status (local, free) ────────────────────────────────────────────

export type OllamaState = { state: 'up' | 'down'; models: string[]; error: string | null };

export async function ollamaState(fetchFn: typeof fetch = fetch): Promise<OllamaState> {
  const base = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
  try {
    const res = await fetchFn(`${base}/api/ps`, { cache: 'no-store', signal: AbortSignal.timeout(800) });
    if (!res.ok) return { state: 'down', models: [], error: `HTTP ${res.status}` };
    const body = (await res.json()) as { models?: { name?: unknown }[] };
    return { state: 'up', models: (body.models ?? []).map((m) => (typeof m.name === 'string' ? m.name : '')).filter(Boolean), error: null };
  } catch (err) {
    return { state: 'down', models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ── the summary (pure) ─────────────────────────────────────────────────────

export const PLAN_LABEL: Record<UsagePlan, string> = { claude: 'Claude', codex: 'ChatGPT / Codex', ollama: 'Ollama' };

export type PlanSummary = {
  plan: UsagePlan;
  label: string;
  /** false = no machine reported this plan in the window: render "Not reported", never 0 */
  reported: boolean;
  burn: number | null;
  days: { day: string; burn: number }[] | null;
  byModel: { model: string; burn: number }[];
  machines: { machine: string; source: 'local' | 'push'; lastAt: string; stale: boolean; burn: number }[];
  /** only a provider-reported gauge; null otherwise (no invented "% of limit") */
  official: { session: OfficialWindow | null; weekly: OfficialWindow | null; at: string } | null;
};

export type UsageSummary = {
  range: 7 | 30;
  plans: PlanSummary[];
  totalBurn: number;
  topBurner: { machine: string; plan: UsagePlan; burn: number } | null;
};

export function summarizeUsage(input: {
  readings: UsageReading[];
  localMachine: string | null;
  official: { codex: PlanSummary['official'] };
  range: 7 | 30;
  now: Date;
}): UsageSummary {
  const days: string[] = [];
  for (let k = input.range - 1; k >= 0; k--) days.push(dayKey(input.now.getTime() - k * DAY));
  const from = days[0];
  const rows = input.readings.filter((r) => r.day >= from && r.day <= days[days.length - 1]);
  const plans = (['claude', 'codex', 'ollama'] as UsagePlan[]).map((plan): PlanSummary => {
    const mine = rows.filter((r) => r.plan === plan);
    if (mine.length === 0) {
      return { plan, label: PLAN_LABEL[plan], reported: false, burn: null, days: null, byModel: [], machines: [], official: plan === 'codex' ? input.official.codex : null };
    }
    const perDay = new Map(days.map((d) => [d, 0]));
    const perModel = new Map<string, number>();
    const perMachine = new Map<string, { lastAt: string; burn: number }>();
    for (const r of mine) {
      const b = burnOf(r);
      perDay.set(r.day, (perDay.get(r.day) ?? 0) + b);
      perModel.set(r.model, (perModel.get(r.model) ?? 0) + b);
      const m = perMachine.get(r.machine) ?? { lastAt: r.pushedAt, burn: 0 };
      perMachine.set(r.machine, { lastAt: r.pushedAt > m.lastAt ? r.pushedAt : m.lastAt, burn: m.burn + b });
    }
    const burn = [...perDay.values()].reduce((a, b) => a + b, 0);
    return {
      plan,
      label: PLAN_LABEL[plan],
      reported: true,
      burn,
      days: days.map((d) => ({ day: d, burn: perDay.get(d) ?? 0 })),
      byModel: [...perModel.entries()].map(([model, b]) => ({ model, burn: b })).sort((a, b) => b.burn - a.burn),
      machines: [...perMachine.entries()]
        .map(([machine, m]) => {
          const local = machine === input.localMachine;
          return { machine, source: local ? ('local' as const) : ('push' as const), lastAt: m.lastAt, stale: !local && input.now.getTime() - Date.parse(m.lastAt) > STALE_PUSH_MS, burn: m.burn };
        })
        .sort((a, b) => b.burn - a.burn),
      official: plan === 'codex' ? input.official.codex : null,
    };
  });
  let top: UsageSummary['topBurner'] = null;
  for (const p of plans) for (const m of p.machines) if (!top || m.burn > top.burn) top = { machine: m.machine, plan: p.plan, burn: m.burn };
  return { range: input.range, plans, totalBurn: plans.reduce((a, p) => a + (p.burn ?? 0), 0), topBurner: top };
}

/** Burn per lane over the range, this machine only. null = no local source (lanes not reported). */
export function summarizeLanes(input: { lanes: LaneReading[]; range: 7 | 30; now: Date; plan?: UsagePlan }): { lane: BurnLane; label: string; burn: number }[] {
  const from = dayKey(input.now.getTime() - (input.range - 1) * DAY);
  const to = dayKey(input.now);
  const tot = new Map<BurnLane, number>(BURN_LANES.map((l) => [l, 0]));
  for (const r of input.lanes) {
    if (r.day < from || r.day > to || (input.plan && r.plan !== input.plan)) continue;
    tot.set(r.lane, (tot.get(r.lane) ?? 0) + r.burn);
  }
  return BURN_LANES.map((lane) => ({ lane, label: LANE_LABEL[lane], burn: tot.get(lane) ?? 0 }));
}
