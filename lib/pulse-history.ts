/**
 * Honest inputs for the operator-console pulse row. `runsPerDay` / `inboundPerDay`
 * turn real timestamped history (agent_runs, comms feed) into per-day series for
 * the sparklines; `stateOfWorld` distills live facts into one attention-first
 * status sentence. Pure + tested so the page stays a thin renderer — and so the
 * pulse row never shows a fabricated trend again.
 */

const DAY_MS = 86_400_000;

/** UTC date keys (YYYY-MM-DD) for the last `days` days, oldest first. */
function dayKeys(days: number, nowMs: number): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10));
  }
  return keys;
}

/** Count ISO timestamps into the last `days` UTC-day buckets (oldest first). */
function countPerDay(timestamps: (string | undefined)[], days: number, nowMs: number): number[] {
  const keys = dayKeys(days, nowMs);
  const index = new Map(keys.map((k, i) => [k, i]));
  const counts = new Array<number>(days).fill(0);
  for (const ts of timestamps) {
    if (!ts) continue;
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) continue;
    const i = index.get(new Date(t).toISOString().slice(0, 10));
    if (i !== undefined) counts[i] += 1;
  }
  return counts;
}

export function runsPerDay(runs: { startedAt?: string }[], days = 7, nowMs = Date.now()): number[] {
  return countPerDay(
    runs.map((r) => r.startedAt),
    days,
    nowMs,
  );
}

export function inboundPerDay(items: { ts?: string }[], days = 7, nowMs = Date.now()): number[] {
  return countPerDay(
    items.map((i) => i.ts),
    days,
    nowMs,
  );
}

export type Tone = 'ok' | 'warn' | 'err' | 'accent' | 'dim';
/** `href` is the page that segment's fact lives on (S10 FR-9); absent for "All nominal". */
export type StateSegment = { text: string; tone: Tone; href?: string };

export type PulseFacts = {
  activeAgents: number;
  totalAgents: number;
  connected: number;
  totalConnectors: number;
  inbound: number;
  failedRuns: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The fact segments of the status line, worst-first: failed runs, downed
 * connectors, then inbound in the last 24h, always
 * anchored by the live agent count. Inbound is a count of arrivals: there is
 * no reply state, so it never claims anyone is waiting on a reply (H1). The overall verdict
 * ("All nominal" / "{n} need attention") is `statusPill`, not a segment.
 * Optimal Engine health is not an input (founderos-ui F1, K3): Home runs no
 * `engine doctor`, and the gbrain connector still counts among the connectors.
 */
export function stateOfWorld(f: PulseFacts): StateSegment[] {
  const segs: StateSegment[] = [];
  const down = Math.max(0, f.totalConnectors - f.connected);

  if (f.failedRuns > 0) segs.push({ text: `${plural(f.failedRuns, 'run')} failed`, tone: 'err', href: '/agents' });
  if (down > 0) segs.push({ text: `${plural(down, 'connector')} down`, tone: 'warn', href: '/integrations' });
  if (f.inbound > 0) segs.push({ text: `${f.inbound} inbound · 24h`, tone: 'accent', href: '/inbox' });
  segs.push({ text: `${f.activeAgents}/${f.totalAgents} agents live`, tone: f.activeAgents > 0 ? 'ok' : 'dim', href: '/agents' });

  return segs;
}

export type StatusPill = { text: string; tone: 'ok' | 'warn' | 'err' };

/**
 * The status line's lead pill, derived from the segments instead of a
 * hard-coded, always-green "Live" (H2): "All nominal" when no segment is warn
 * or err, else "{n} need attention" in the worst tone present.
 */
export function statusPill(segs: StateSegment[]): StatusPill {
  const bad = segs.filter((s) => s.tone === 'warn' || s.tone === 'err');
  if (bad.length === 0) return { text: 'All nominal', tone: 'ok' };
  return {
    text: `${bad.length} ${bad.length === 1 ? 'needs' : 'need'} attention`,
    tone: bad.some((s) => s.tone === 'err') ? 'err' : 'warn',
  };
}
