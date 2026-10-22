import type { LabProfile } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { FORMAT_LABEL, featureRows, featuresOf, type FeatureRow } from '@/lib/lab/distill';
import { durationBand, fmtRatio, mean, median, quantile, sd, wordCount, enough } from '@/lib/lab/measures';

/**
 * Your DNA (SPEC §4.9): your own posts through the same dissect and measure steps, read
 * deterministically. Nothing here asks a model:
 *   - format mix: share of each format family over 90 days and your breakout rate in it
 *   - your baseline per format (median views, with n), so your outliers are fair
 *   - voice stats from your transcripts: WPM, sentence length (mean, sd, p10, p90),
 *     openers, transitions, filler rate. They sit beside the voice skills.
 *   - gaps: features that lift breakouts in the niche that you rarely use
 * Every number travels with its n; the view decides nothing about "enough" itself.
 */

export const DNA_WINDOW_DAYS = 90;
/** A family counts as one you make when it is at least this share of your posts (and 3+ posts). */
export const OWN_FAMILY_MIN_SHARE = 0.1;
/** A niche feature is a gap when you use it in fewer than this share of your posts. */
export const GAP_MAX_SHARE = 0.25;

export const TRANSITIONS = ['and so', 'so', 'because', 'but', 'now', 'and then', 'which means', "here's", 'the thing is', 'basically'] as const;
export const FILLERS = ['um', 'uh', 'you know', 'i mean', 'like', 'basically', 'actually', 'literally', 'kind of', 'sort of'] as const;

export type FamilyMix = { family: string; label: string; posts: number; share: number; breakouts: number; breakoutRate: number | null; baselineViews: number | null; baselineN: number; medianDurationS: number | null };
export type VoiceStats = {
  transcripts: number;
  words: number;
  wpm: { median: number | null; p10: number | null; p90: number | null; n: number };
  sentence: { mean: number | null; sd: number | null; p10: number | null; p90: number | null; n: number };
  /** Most common first words of a sentence, share of sentences. */
  openers: { word: string; share: number; n: number }[];
  /** Per 1,000 words. */
  transitions: { phrase: string; per1k: number; n: number }[];
  /** Filler words per 100 words. */
  fillerRate: number | null;
  fillers: { phrase: string; n: number }[];
};
export type DnaGap = { family: string; feature: string; value: string; nicheLift: number; n: number; yourShare: number; yourN: number };
export type Dna = {
  windowDays: number;
  posts: number;
  mix: FamilyMix[];
  /** "your tutorials break out 2.4x more than your talking heads" when both sides have n >= 5. */
  contrast: { best: string; worst: string; ratio: number; text: string } | null;
  voice: VoiceStats;
  gaps: DnaGap[];
  /** Families you make (share >= 10% and 3+ posts): the ones that get a Viral Profile. */
  families: string[];
};

const DAY = 86_400_000;
const round = (x: number | null, d = 1) => (x === null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Split spoken text into sentences (period, question mark, exclamation, or a line break). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => wordCount(s) > 0);
}

const countPhrase = (lower: string, phrase: string): number => {
  const re = new RegExp(`(^|[^a-z'])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z'])`, 'g');
  return (lower.match(re) ?? []).length;
};

/** Deterministic voice statistics over a set of transcripts (text + measured wpm). */
export function voiceStats(transcripts: readonly { text: string; wpm: number | null }[]): VoiceStats {
  const texts = transcripts.map((t) => t.text).filter((t) => t.trim());
  const wpms = transcripts.map((t) => t.wpm).filter((x): x is number => typeof x === 'number' && x > 0);
  const sents = texts.flatMap(sentences);
  const lens = sents.map(wordCount);
  const words = texts.reduce((a, t) => a + wordCount(t), 0);
  const openerCounts = new Map<string, number>();
  for (const s of sents) {
    const w = s.toLowerCase().replace(/^[^a-z']+/, '').split(/[^a-z']+/)[0];
    if (w) openerCounts.set(w, (openerCounts.get(w) ?? 0) + 1);
  }
  const lower = texts.join('\n').toLowerCase();
  // count "and so" before "so" and do not double count: subtract the longer phrase's hits
  const raw = new Map<string, number>(TRANSITIONS.map((p) => [p, countPhrase(lower, p)]));
  raw.set('so', Math.max(0, (raw.get('so') ?? 0) - (raw.get('and so') ?? 0)));
  const fillers = FILLERS.map((p) => ({ phrase: p, n: countPhrase(lower, p) }));
  const fillerTotal = fillers.reduce((a, f) => a + f.n, 0);
  return {
    transcripts: texts.length,
    words,
    wpm: { median: round(median(wpms)), p10: round(quantile(wpms, 0.1)), p90: round(quantile(wpms, 0.9)), n: wpms.length },
    sentence: { mean: round(mean(lens)), sd: round(sd(lens)), p10: round(quantile(lens, 0.1)), p90: round(quantile(lens, 0.9)), n: lens.length },
    openers: [...openerCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([word, n]) => ({ word, n, share: round(n / Math.max(1, sents.length), 3)! })),
    transitions: [...raw.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([phrase, n]) => ({ phrase, n, per1k: round((n / Math.max(1, words)) * 1000)! })),
    fillerRate: words > 0 ? round((fillerTotal / words) * 100, 2) : null,
    fillers: fillers.filter((f) => f.n > 0).sort((a, b) => b.n - a.n),
  };
}

const famLabel = (f: string) => (FORMAT_LABEL as Record<string, string>)[f] ?? f.replaceAll('_', ' ');

/** Format mix, your baseline per format and your breakout rate per family. */
export function formatMix(rows: readonly FeatureRow[], views: Map<string, number | null>): FamilyMix[] {
  const by = new Map<string, FeatureRow[]>();
  for (const r of rows) (by.get(r.dissection.format) ?? by.set(r.dissection.format, []).get(r.dissection.format)!).push(r);
  return [...by.entries()]
    .map(([family, rs]) => {
      const v = rs.map((r) => views.get(r.post.id)).filter((x): x is number => typeof x === 'number' && x > 0);
      const breakouts = rs.filter((r) => r.measure.isBreakout).length;
      const judged = rs.filter((r) => r.measure.breakout !== null).length;
      return {
        family,
        label: famLabel(family),
        posts: rs.length,
        share: round(rs.length / Math.max(1, rows.length), 3)!,
        breakouts,
        breakoutRate: judged ? round(breakouts / judged, 3) : null,
        baselineViews: median(v),
        baselineN: v.length,
        medianDurationS: median(rs.map((r) => r.post.durationS).filter((x): x is number => typeof x === 'number')),
      };
    })
    .sort((a, b) => b.posts - a.posts || a.family.localeCompare(b.family));
}

/** "Screen recording" → "screen recording", but "AI tool tutorials" keeps its acronym. */
export const lowerFirst = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** The best and worst family by your breakout rate, both with n >= 5 posts. */
export function mixContrast(mix: readonly FamilyMix[]): Dna['contrast'] {
  const ok = mix.filter((m) => enough(m.posts) && m.breakoutRate !== null);
  if (ok.length < 2) return null;
  const sorted = [...ok].sort((a, b) => b.breakoutRate! - a.breakoutRate!);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  if (!(worst.breakoutRate! > 0) || best.family === worst.family) return null;
  const ratio = best.breakoutRate! / worst.breakoutRate!;
  return { best: best.family, worst: worst.family, ratio: round(ratio, 2)!, text: `your ${lowerFirst(best.label)} posts break out ${fmtRatio(ratio)} as often as your ${lowerFirst(worst.label)} posts (n ${best.posts} and ${worst.posts})` };
}

/** Niche features (shown, lift > 1) you use in under 25% of your posts in that family. */
export function dnaGaps(profiles: readonly LabProfile[], own: readonly FeatureRow[]): DnaGap[] {
  const out: DnaGap[] = [];
  for (const p of profiles) {
    const fam = own.filter((r) => r.dissection.format === p.formatFamily);
    const pool = fam.length ? fam : own;
    if (pool.length === 0) continue;
    const feats = pool.map(featuresOf);
    for (const f of p.features) {
      if (!f.shown || f.lift === null || f.lift <= 1) continue;
      const carrying = feats.filter((x) => x[f.feature] === f.value).length;
      const share = carrying / pool.length;
      if (share < GAP_MAX_SHARE) out.push({ family: p.formatFamily, feature: f.feature, value: f.value, nicheLift: f.lift, n: f.n, yourShare: round(share, 3)!, yourN: pool.length });
    }
  }
  return out.sort((a, b) => b.nicheLift - a.nicheLift);
}

export function computeDna(store: LabStore, opts: { now?: Date } = {}): Dna {
  const now = opts.now ?? new Date();
  const own = featureRows(store, { now, owned: true, windowDays: DNA_WINDOW_DAYS });
  const latest = store.metrics.latest();
  const views = new Map([...latest.entries()].map(([id, m]) => [id, m.views]));
  const mix = formatMix(own, views);
  // voice: every owned transcript in the window (not just dissected ones)
  const from = now.getTime() - DNA_WINDOW_DAYS * DAY;
  const ownPosts = new Map(store.posts.all().filter((p) => p.isOwned && p.postedAt && Date.parse(p.postedAt) >= from && Date.parse(p.postedAt) <= now.getTime()).map((p) => [p.id, p]));
  const tr = store.transcripts.all().filter((t) => t.status === 'done' && ownPosts.has(t.postId));
  return {
    windowDays: DNA_WINDOW_DAYS,
    posts: own.length,
    mix,
    contrast: mixContrast(mix),
    voice: voiceStats(tr),
    gaps: dnaGaps(store.profiles.latest(), own),
    families: mix.filter((m) => m.posts >= 3 && m.share >= OWN_FAMILY_MIN_SHARE).map((m) => m.family),
  };
}

/** Label a family the way the profile header reads: "AI tool tutorials · 30-60 s". */
export function familyLabelFor(family: string, medianDurationS: number | null): string {
  const band = durationBand(medianDurationS);
  return band ? `${famLabel(family)} · ${band}` : famLabel(family);
}

/** Your own best lines (10-15) for the VOICE block: sentences from your breakouts' transcripts, then your saved edits. */
export function bestLines(store: LabStore, opts: { now?: Date; limit?: number } = {}): string[] {
  const limit = opts.limit ?? 15;
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  const own = store.posts.all().filter((p) => p.isOwned);
  const ranked = own
    .map((p) => ({ p, b: ms.get(p.id)?.breakout ?? 0, t: store.transcripts.get(p.id) }))
    .filter((x) => x.t?.status === 'done')
    .sort((a, b) => b.b - a.b);
  const lines: string[] = [];
  // edits first: a line you rewrote by hand is the strongest voice sample there is
  for (const s of store.scripts.all()) {
    for (const v of store.scripts.versions(s.id)) {
      for (const l of (v.editDiff ?? '').split('\n')) if (l.startsWith('+') && !l.startsWith('+++') && wordCount(l.slice(1)) >= 4) lines.push(l.slice(1).trim());
    }
  }
  for (const x of ranked) {
    for (const s of sentences(x.t!.text)) {
      const n = wordCount(s);
      if (n >= 6 && n <= 28) lines.push(s);
      if (lines.length >= limit * 3) break;
    }
    if (lines.length >= limit * 3) break;
  }
  return [...new Set(lines)].slice(0, limit);
}
