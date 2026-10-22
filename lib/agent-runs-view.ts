/**
 * Pure run helpers for the GladOS workforce pages (glados-ui SPEC S04 F0.2,
 * F-A2): every run figure states its window, and "last run N ago" captions
 * read the newest run. Client-safe (no fs, no db).
 */

/** Day buckets (oldest first) of run counts over the last `days` days ending at `now`. */
export function dailyRunCounts(runs: readonly { startedAt: string }[], days: number, now: number): number[] {
  const out = new Array<number>(days).fill(0);
  const dayMs = 86_400_000;
  const end = Math.floor(now / dayMs);
  for (const r of runs) {
    const t = Date.parse(r.startedAt);
    if (Number.isNaN(t)) continue;
    const idx = days - 1 - (end - Math.floor(t / dayMs));
    if (idx >= 0 && idx < days) out[idx] += 1;
  }
  return out;
}

/** "46 d ago" style age for captions; null when there is no run. */
export function runAge(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
