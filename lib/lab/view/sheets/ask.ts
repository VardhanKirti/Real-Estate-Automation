/**
 * Ask sheet (`?ask=<q>`) model (01 20.1) and its builder. AskView and AskFilters are section 07's
 * (7.12); `ask` is askView's output unchanged.
 */
import { askView, type AskView } from '@/lib/lab/gen/view';
import type { AskFilters } from '@/lib/lab/gen/ask';
import type { LabStore } from '@/lib/lab/store';
import type { LabLayerEnv } from '@/lib/lab/view/sheets/env';
import { withSample } from '@/lib/lab/view/section';

export type AskSheetView = {
  q: string;
  state: 'answer' | 'not_built' | 'error';
  /** section 07 askView(store, q, opts), unchanged */
  ask: AskView | null;
  /** one per ask.filters.matched span; removeHref = ?ask= with that span removed */
  chips: { label: string; removeHref: string }[];
  /** "/lab/breakouts?platform=tiktok&window=30" when the filters map onto Breakouts params */
  refineHref: string | null;
};

/* ── builder (01 20) ──────────────────────────────────────────────────── */

/** 01 20.1: a Breakouts URL when the parsed filters map onto its params, else null. */
export function refineHrefFor(f: AskFilters, sample = false): string | null {
  if (f.platforms.length > 1 || f.formats.length > 1 || f.hookForms.length || f.creators.length || (f.minRatio !== null && f.minRatio !== 3) || f.maxRatio !== null) return null;
  // minRatio 3 is 07's "breakouts" filter, which is what Breakouts lists by default (01 20.1)
  if (f.days !== 7 && f.days !== 30 && f.days !== 90) return null;
  const q = new URLSearchParams();
  if (f.platforms[0]) q.set('platform', f.platforms[0]);
  if (f.formats[0]) q.set('format', f.formats[0]);
  q.set('window', String(f.days));
  if (f.owned === 'only') q.set('mine', '1');
  if (f.dualHigh) q.set('dual', '1');
  return withSample(`/lab/breakouts?${q.toString()}`, sample);
}

function withoutSpan(q: string, span: string): string {
  const i = q.toLowerCase().indexOf(span.toLowerCase());
  const out = i < 0 ? q : `${q.slice(0, i)}${q.slice(i + span.length)}`;
  return out.replace(/\s+/g, ' ').trim();
}

export async function buildAskSheet(store: LabStore, q: string, now: Date, env: LabLayerEnv): Promise<AskSheetView> {
  if (env.layers.ask !== 'live') return { q, state: 'not_built', ask: null, chips: [], refineHref: null };
  try {
    const ask = await askView(store, q, { now, dry: env.dry, sample: env.sample, readOnly: Boolean(env.readOnly) });
    const chips = ask.filters.matched.map((m) => {
      const rest = withoutSpan(q, m.span);
      return { label: `${m.span} -> ${m.as}`, removeHref: withSample(rest ? `?ask=${encodeURIComponent(rest)}` : '?', env.sample) };
    });
    return { q, state: 'answer', ask, chips, refineHref: refineHrefFor(ask.filters, env.sample) };
  } catch (err) {
    console.error('[lab view] ask', err);
    return { q, state: 'error', ask: null, chips: [], refineHref: null };
  }
}
