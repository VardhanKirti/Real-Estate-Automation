import type { LabPrior } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { featureRows } from '@/lib/lab/distill';
import { median, wpmBand } from '@/lib/lab/measures';
import { recordOutcomes } from '@/lib/lab/outcomes';

/**
 * The feedback loop's memory (SPEC §4.13): what YOUR data says, with n, and whether it
 * has earned the right to replace the niche default. A prior supersedes the niche only
 * past its threshold (merged design 08):
 *   yours:wpm                    n >= 5 own posts with a transcript
 *   yours:hook_lift:<form>       n >= 5 own posts with that hook form AND >= 20 own hooks in total
 *   yours:duration:<format>      n >= 15 own posts in that format
 * Values are plain JSON so the view and the script prompt read them the same way:
 *   wpm      { value, band }      the median pace of your posts in your best-performing band
 *   hook     { lift, breakouts, posts }  your breakout rate with the form ÷ your overall rate
 *   duration { value, band }      the median length of your breakouts in that format (all posts when none broke out)
 * Pure over the store; `recomputePriors` replaces the computed keys and leaves every
 * other key (the fixture marker, the schedule) alone.
 */

export const PRIOR_THRESHOLDS = { wpm: 5, hookLiftPerForm: 5, hookLiftTotal: 20, durationPerFormat: 15 } as const;
export const PRIOR_PREFIX = 'yours:';

type Own = ReturnType<typeof featureRows>;

/** Your best WPM band by breakout rate (ties → more posts), and the median pace inside it. */
export function wpmPrior(own: Own): { value: number; band: string; n: number } | null {
  const rows = own.filter((r) => r.transcript?.status === 'done' && typeof r.transcript.wpm === 'number');
  if (rows.length === 0) return null;
  const by = new Map<string, { wpm: number[]; hits: number }>();
  for (const r of rows) {
    const b = wpmBand(r.transcript!.wpm)!;
    const e = by.get(b) ?? { wpm: [], hits: 0 };
    e.wpm.push(r.transcript!.wpm!);
    if (r.measure.isBreakout) e.hits++;
    by.set(b, e);
  }
  const [band, e] = [...by.entries()].sort((a, b) => b[1].hits / b[1].wpm.length - a[1].hits / a[1].wpm.length || b[1].wpm.length - a[1].wpm.length)[0];
  return { value: Math.round(median(e.wpm)!), band, n: rows.length };
}

export function hookPriors(own: Own): { form: string; lift: number | null; breakouts: number; posts: number }[] {
  const judged = own.filter((r) => r.measure.breakout !== null);
  const base = judged.length ? judged.filter((r) => r.measure.isBreakout).length / judged.length : 0;
  const by = new Map<string, { n: number; hits: number }>();
  for (const r of judged) {
    const e = by.get(r.dissection.hookForm) ?? { n: 0, hits: 0 };
    e.n++;
    if (r.measure.isBreakout) e.hits++;
    by.set(r.dissection.hookForm, e);
  }
  return [...by.entries()].map(([form, e]) => ({ form, posts: e.n, breakouts: e.hits, lift: base > 0 ? Math.round((e.hits / e.n / base) * 100) / 100 : null }));
}

export function durationPriors(own: Own): { format: string; value: number; n: number }[] {
  const by = new Map<string, Own>();
  for (const r of own) (by.get(r.dissection.format) ?? by.set(r.dissection.format, []).get(r.dissection.format)!).push(r);
  return [...by.entries()].flatMap(([format, rs]) => {
    const hits = rs.filter((r) => r.measure.isBreakout && r.post.durationS);
    const pool = (hits.length ? hits : rs).map((r) => r.post.durationS).filter((x): x is number => typeof x === 'number');
    const m = median(pool);
    return m === null ? [] : [{ format, value: Math.round(m), n: rs.length }];
  });
}

/** Rebuild every computed `yours:*` prior from your posts (after appending new outcomes). */
export function recomputePriors(store: LabStore, opts: { now?: Date } = {}): LabPrior[] {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  recordOutcomes(store, { now });
  const own = featureRows(store, { now, owned: true, windowDays: 365 });
  const out: LabPrior[] = [];
  const w = wpmPrior(own);
  if (w) out.push({ key: `${PRIOR_PREFIX}wpm`, value: { value: w.value, band: w.band }, n: w.n, supersedesDefault: w.n >= PRIOR_THRESHOLDS.wpm, updatedAt: at });
  const hooks = hookPriors(own);
  const totalHooks = hooks.reduce((a, h) => a + h.posts, 0);
  for (const h of hooks) out.push({ key: `${PRIOR_PREFIX}hook_lift:${h.form}`, value: { lift: h.lift, breakouts: h.breakouts, posts: h.posts }, n: h.posts, supersedesDefault: h.lift !== null && h.posts >= PRIOR_THRESHOLDS.hookLiftPerForm && totalHooks >= PRIOR_THRESHOLDS.hookLiftTotal, updatedAt: at });
  for (const d of durationPriors(own)) out.push({ key: `${PRIOR_PREFIX}duration:${d.format}`, value: { value: d.value }, n: d.n, supersedesDefault: d.n >= PRIOR_THRESHOLDS.durationPerFormat, updatedAt: at });
  store.transaction(() => {
    for (const p of out) store.priors.set(p);
  });
  return out;
}

export type Effective = { value: number; source: 'prior' | 'niche' | 'default'; n: number };

/**
 * The number a script should use: your prior when it supersedes, else the niche figure
 * (from the Viral Profile) when one exists, else the stated fallback.
 */
export function effective(store: LabStore, key: string, niche: { value: number | null; n: number }, fallback: number, field: 'value' | 'lift' = 'value'): Effective {
  const p = store.priors.get(key);
  const v = p ? (p.value as Record<string, unknown> | null)?.[field] : null;
  if (p?.supersedesDefault && typeof v === 'number') return { value: v, source: 'prior', n: p.n };
  if (niche.value !== null) return { value: niche.value, source: 'niche', n: niche.n };
  return { value: fallback, source: 'default', n: 0 };
}
