/**
 * Pure, framework-free helpers shared by the Wizard workspace UI and its
 * tests. Nothing here touches the DOM, fs, or Date.now() implicitly — every
 * function takes `now` as a parameter so tests are deterministic.
 */

export type RunLike = { startedAt: string; finishedAt?: string | null; ok: boolean };

/** "3m ago" / "2h ago" / "5d ago" style relative time. Null-safe. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '—';
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Real elapsed-seconds label for a duration ("42s" / "3m 05s"). */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

/** Real duration between two ISO timestamps, as an elapsedLabel. */
export function durationLabel(startedAt: string, finishedAt: string): string {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  return elapsedLabel((end - start) / 1000);
}

/** Progress-ring fraction, clamped to [0, 1]. total<=0 reads as 0 (no ring drawn upstream). */
export function ringFraction(done: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.min(1, Math.max(0, done / total));
}

export type HeatmapDay = { date: string; tint: 'ok' | 'err' | 'empty' };

/**
 * Buckets runs into the last `days` UTC calendar days (oldest first, today
 * last). A day tints 'err' if any run that day failed, 'ok' if all runs that
 * day succeeded, 'empty' if the agent had no runs that day. Real history
 * only — a day with zero runs is never drawn as anything but empty.
 */
export function heatmapDays(runs: RunLike[], days = 30, now: number = Date.now()): HeatmapDay[] {
  const byDate = new Map<string, { ok: boolean; err: boolean }>();
  for (const run of runs) {
    const t = Date.parse(run.startedAt);
    if (Number.isNaN(t)) continue;
    const key = new Date(t).toISOString().slice(0, 10);
    const bucket = byDate.get(key) ?? { ok: false, err: false };
    if (run.ok) bucket.ok = true;
    else bucket.err = true;
    byDate.set(key, bucket);
  }

  const out: HeatmapDay[] = [];
  const todayUtc = new Date(now);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    const bucket = byDate.get(key);
    const tint: HeatmapDay['tint'] = !bucket ? 'empty' : bucket.err ? 'err' : 'ok';
    out.push({ date: key, tint });
  }
  return out;
}

/** Split a free-text tools field ("a, b,  c") into a trimmed, deduped list. */
export function parseToolsInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** First 6 chars of a session id, for the quiet "session a1b2c3" header line. */
export function shortSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  return sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || null;
}
