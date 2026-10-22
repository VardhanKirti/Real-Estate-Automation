import type { LabBeat, LabDissection, LabFeatureLift, LabFormat, LabMeasure, LabMeasureV2, LabPost, LabProfile, LabTranscript } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { beatTemplate, durationBand, hookWordsBand, hourBand, mean, minesPatterns, quantile, wordCount, wpmBand, wpmOf } from '@/lib/lab/measures';
import { benjaminiHochberg, FDR_Q, mantelHaenszel, MIN_CASES_WITH, MIN_CONTROLS_WITH, MIN_FAMILY_CASES, MIN_FAMILY_CONTROLS, profileGate, weightedLift } from '@/lib/lab/measure/case-control';
import { savesBand, sharesBand } from '@/lib/lab/measure/platform';
import { labTz } from '@/lib/lab/setup/jobs';

/**
 * v2 (04 5.5): the profile is case-control. Competitor rows come only from lab_controls (cases and
 * drawn controls); each value gets a Mantel-Haenszel odds ratio over creator strata (the shown
 * number, stored in `lift`/`lo`/`hi` so v1 readers keep working), an inverse-weighted lift, and
 * Benjamini-Hochberg q across the profile. A value shows with 8+ cases and 3+ controls carrying it,
 * an interval excluding 1, and q <= 0.10. The v1 text below describes the old method.
 *
 * Viral Profile distillation (SPEC §4.7), v1. Per format family, over competitor posts
 * in a rolling 90-day window whose baseline confidence is ok or high:
 *   lift(feature=value) = P(breakout | value, format) ÷ P(breakout | format)
 * with a 90% Wilson interval; a value shows only with n >= 8 breakouts and an interval
 * that excludes 1.0 (lib/lab/measures.ts `lift`). "Breakout" here is the pattern-mining
 * set (`minesPatterns`: breakouts minus clickbait and comment-keyword bait).
 *
 * v1 family = the dissected `format` (CONTRACT.md: Phase 4 may widen a family to format ×
 * duration band). The Phase 4 lane owns the sentences, "Your DNA" and the Optimal Engine doc;
 * this module gives every lane real numbers to build against (fixtures use it too).
 */

export const PROFILE_WINDOW_DAYS = 90;

export const FORMAT_LABEL: Record<LabFormat, string> = {
  talking_head: 'Talking head',
  screen_recording: 'Screen recording',
  tutorial_walkthrough: 'AI tool tutorials',
  b_roll_voiceover: 'B-roll voiceover',
  green_screen: 'Green screen',
  skit: 'Skit',
  interview_clip: 'Interview clip',
  carousel: 'Carousel',
  text_post: 'Text post',
  long_form: 'Long form',
  other: 'Other',
};

export const FEATURE_LABEL: Record<string, string> = {
  hook_form: 'Hook form',
  emotional_trigger: 'Trigger',
  hook_channel: 'Hook channel',
  hook_words: 'Hook length',
  structure_type: 'Structure',
  beat_template: 'Beat template',
  duration: 'Duration',
  wpm: 'Pace',
  first_beat: 'Hook beat length',
  rehook: 'Rehook',
  cta_type: 'CTA',
  topic_cluster: 'Topic',
  post_hour: 'Posting hour',
  shares_band: 'Shares per view',
  saves_band: 'Saves per view',
};

/** Features that need the spoken track: caption-only rows leave them out on both sides (04 5.2). */
export const AUDIO_FEATURES = new Set(['hook_form', 'emotional_trigger', 'hook_channel', 'hook_words', 'beat_template', 'first_beat', 'rehook', 'wpm']);
export const PROFILE_METHOD = 'case_control_mh_v1';

export type FeatureRow = {
  post: LabPost;
  dissection: LabDissection;
  measure: LabMeasure & Partial<Pick<LabMeasureV2, 'sharesPerView' | 'savesPerView' | 'exoAuto'>>;
  transcript: LabTranscript | null;
  clusterId: string | null;
  /** v2 (04 5.5): competitor rows carry their lab_controls role, sampling probability and stratum. */
  role?: 'case' | 'control' | null;
  pi?: number | null;
  stratum?: string | null;
};

/** Every feature value a post carries (absent features are simply missing). */
export function featuresOf(r: FeatureRow): Record<string, string> {
  const d = r.dissection;
  const out: Record<string, string> = {
    hook_form: d.hookForm,
    emotional_trigger: d.emotionalTrigger,
    hook_channel: d.hookChannel,
    hook_words: hookWordsBand(wordCount(d.hookText)),
    structure_type: d.structureType,
    cta_type: d.ctaType,
  };
  if (d.beats.length) {
    out.beat_template = beatTemplate(d.beats);
    const hook = d.beats.find((b) => b.type === 'hook');
    if (hook) {
      const len = hook.endPct - hook.startPct;
      out.first_beat = len < 10 ? 'under 10%' : len <= 20 ? '10-20%' : 'over 20%';
    }
    out.rehook = d.beats.some((b) => b.type === 'rehook') ? 'yes' : 'no';
  }
  const dur = durationBand(r.post.durationS);
  if (dur) out.duration = dur;
  if (r.transcript?.status === 'done') {
    const w = wpmBand(r.transcript.wpm ?? wpmOf(r.transcript.wordCount, r.post.durationS));
    if (w) out.wpm = w;
  }
  if (r.clusterId) out.topic_cluster = r.clusterId;
  const hb = hourBand(r.post.postedAt, labTz());
  if (hb) out.post_hour = hb;
  if (r.post.platform === 'tiktok') {
    const sb = sharesBand(r.measure.sharesPerView ?? null);
    const vb = savesBand(r.measure.savesPerView ?? null);
    if (sb) out.shares_band = sb;
    if (vb) out.saves_band = vb;
  }
  // caption-only rows (no transcript) keep caption features only, cases and controls alike (04 5.2)
  if (r.role && r.transcript?.status !== 'done') for (const k of AUDIO_FEATURES) delete out[k];
  return out;
}

/** The modal beat template among breakouts, with each beat's mean start/end. */
export function representativeStrand(beatsList: readonly LabBeat[][]): LabBeat[] {
  if (beatsList.length === 0) return [];
  const byTemplate = new Map<string, LabBeat[][]>();
  for (const beats of beatsList) {
    const key = beats.map((b) => b.type).join('|');
    (byTemplate.get(key) ?? byTemplate.set(key, []).get(key)!).push(beats);
  }
  const [, group] = [...byTemplate.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];
  return group[0].map((b, i) => ({
    type: b.type,
    startPct: Math.round((mean(group.map((g) => g[i].startPct)) ?? b.startPct) * 10) / 10,
    endPct: Math.round((mean(group.map((g) => g[i].endPct)) ?? b.endPct) * 10) / 10,
    summary: '',
  }));
}

/** Gather the feature rows for the window (competitor posts only unless `owned`). */
export function featureRows(store: LabStore, opts: { now?: Date; owned?: boolean; windowDays?: number } = {}): FeatureRow[] {
  const now = (opts.now ?? new Date()).getTime();
  const from = now - (opts.windowDays ?? PROFILE_WINDOW_DAYS) * 86_400_000;
  const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  const tr = new Map(store.transcripts.all().map((t) => [t.postId, t]));
  const cl = new Map(store.topics.all().filter((t) => t.isPrimary).map((t) => [t.postId, t.clusterId]));
  // v2: competitor rows come only from lab_controls, as drawn by `now` (a verdict made later is not seen)
  const cc = new Map(store.controls.all().filter((c) => Date.parse(c.drawnAt) <= now).map((c) => [c.postId, c]));
  const out: FeatureRow[] = [];
  for (const post of store.posts.all()) {
    if (Boolean(opts.owned) !== post.isOwned) continue;
    const t = post.postedAt ? Date.parse(post.postedAt) : NaN;
    if (!(t >= from && t <= now)) continue;
    const d = dis.get(post.id);
    const m = ms.get(post.id);
    if (!d || !m) continue;
    const c = post.isOwned ? null : (cc.get(post.id) ?? null);
    if (!post.isOwned && !c) continue;
    out.push({ post, dissection: d, measure: m, transcript: tr.get(post.id) ?? null, clusterId: cl.get(post.id) ?? null, role: c?.role ?? null, pi: c?.samplingProb ?? null, stratum: c?.stratum ?? null });
  }
  return out;
}

/** One profile for one format family, from case-control rows already filtered to that family (04 5.3 to 5.5). */
export function computeProfile(rows: readonly FeatureRow[], family: string, opts: { version: number; now?: Date; id?: string; label?: string }): LabProfile {
  const universe = rows.filter((r) => minesPatterns(r.measure, r.dissection.ctaType, { role: r.role ?? null, exoReason: r.post.exoReason ?? null }));
  const cases = universe.filter((r) => r.role === 'case');
  const controls = universe.filter((r) => r.role === 'control');
  const feats = new Map(universe.map((r) => [r, featuresOf(r)]));
  const values = new Map<string, Set<string>>();
  for (const f of feats.values()) for (const [k, v] of Object.entries(f)) (values.get(k) ?? values.set(k, new Set()).get(k)!).add(v);
  type Cell = { a: number; b: number; c: number; d: number; pi: number };
  const entries: { feature: string; value: string; mh: ReturnType<typeof mantelHaenszel>; liftW: number | null }[] = [];
  for (const [feature, vals] of values) {
    for (const value of vals) {
      // MH strata are creators (months collapsed); the weighted lift keeps each month's own pi
      const byCreator = new Map<string, Cell>();
      const byStratum = new Map<string, Cell>();
      for (const r of universe) {
        if (!(feature in feats.get(r)!)) continue;
        const has = feats.get(r)![feature] === value;
        const creator = r.post.sourceId;
        const st = r.stratum ?? `${creator}|`;
        const k1 = byCreator.get(creator) ?? byCreator.set(creator, { a: 0, b: 0, c: 0, d: 0, pi: 1 }).get(creator)!;
        const k2 = byStratum.get(st) ?? byStratum.set(st, { a: 0, b: 0, c: 0, d: 0, pi: 1 }).get(st)!;
        for (const k of [k1, k2]) {
          if (r.role === 'case') has ? k.a++ : k.b++;
          else has ? k.c++ : k.d++;
        }
        if (r.role === 'control' && r.pi) k2.pi = r.pi;
      }
      entries.push({ feature, value, mh: mantelHaenszel([...byCreator.values()]), liftW: weightedLift([...byStratum.values()]) });
    }
  }
  // BH family: every value with a + c >= 5 and an estimable OR
  const tested = entries.filter((e) => e.mh.casesWith + e.mh.controlsWith >= 5 && e.mh.or !== null && e.mh.p !== null);
  const qs = benjaminiHochberg(tested.map((e) => e.mh.p!));
  const qOf = new Map(tested.map((e, i) => [e, qs[i]]));
  const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10_000) / 10_000);
  const features: LabFeatureLift[] = entries
    .map((e) => {
      const q = qOf.get(e) ?? null;
      return {
        feature: e.feature,
        value: e.value,
        total: e.mh.casesWith + e.mh.controlsWith,
        n: e.mh.casesWith,
        lift: r4(e.mh.or),
        lo: r4(e.mh.lo),
        hi: r4(e.mh.hi),
        shown: profileGate(e.mh, q),
        or: r4(e.mh.or),
        orLo: r4(e.mh.lo),
        orHi: r4(e.mh.hi),
        p: r4(e.mh.p),
        q: r4(q),
        casesWith: e.mh.casesWith,
        controlsWith: e.mh.controlsWith,
        liftW: r4(e.liftW),
        method: 'mh' as const,
      };
    })
    .sort((a, b) => a.feature.localeCompare(b.feature) || (b.lift ?? 0) - (a.lift ?? 0) || a.value.localeCompare(b.value));
  const wpms = cases.map((r) => r.transcript?.wpm).filter((x): x is number => typeof x === 'number');
  const durs = cases.map((r) => r.post.durationS).filter((x): x is number => typeof x === 'number');
  const band = (xs: number[]): [number, number] | null => (xs.length >= 5 ? [Math.round(quantile(xs, 0.25)!), Math.round(quantile(xs, 0.75)!)] : null);
  const created = (opts.now ?? new Date()).toISOString();
  return {
    id: opts.id ?? `prof-${family}-v${opts.version}`,
    formatFamily: family,
    label: opts.label ?? (FORMAT_LABEL as Record<string, string>)[family] ?? family,
    version: opts.version,
    windowDays: PROFILE_WINDOW_DAYS,
    postsN: universe.length,
    breakoutsN: cases.length,
    features,
    strand: representativeStrand(cases.map((r) => r.dissection.beats).filter((b) => b.length > 0)),
    stats: { wpm: band(wpms), durationS: band(durs) },
    createdAt: created,
    method: PROFILE_METHOD,
    controlsN: controls.length,
    fdrQ: FDR_Q,
  };
}

/** Values that met the count and interval rules but not the false-discovery check (04 5.5). */
export function bhHiddenCount(p: Pick<LabProfile, 'features'>): number {
  return p.features.filter((f) => f.method === 'mh' && !f.shown && (f.casesWith ?? 0) >= MIN_CASES_WITH && (f.controlsWith ?? 0) >= MIN_CONTROLS_WITH && f.lo !== null && f.hi !== null && (f.lo > 1 || f.hi < 1) && f.q !== null && f.q !== undefined && f.q > FDR_Q).length;
}

/** Distil and store a new version for each family (default: every format with competitor breakouts). */
export function distillProfiles(store: LabStore, opts: { now?: Date; families?: { family: string; label?: string }[] } = {}): LabProfile[] {
  const rows = featureRows(store, { now: opts.now });
  const families: { family: string; label?: string }[] = opts.families ?? [...new Set(rows.map((r) => r.dissection.format))].map((family) => ({ family }));
  const out: LabProfile[] = [];
  for (const { family, label } of families) {
    const fam = rows.filter((r) => r.dissection.format === family);
    if (fam.length === 0) continue;
    const p = computeProfile(fam, family, { version: store.profiles.nextVersion(family), now: opts.now, label });
    // v2 (04 5.5): a family needs 8 cases and 8 controls; under that it shows "not enough yet" with
    // counts and no profile version is written (an empty profile would burn a version)
    if (p.breakoutsN < MIN_FAMILY_CASES || (p.controlsN ?? 0) < MIN_FAMILY_CONTROLS) continue;
    store.profiles.insert(p);
    out.push(p);
  }
  return out;
}

/* ── sentences (Phase 4) ──────────────────────────────────────────────── */

const fmtX = (x: number) => (x >= 10 ? `${Math.round(x)}x` : `${(Math.round(x * 10) / 10).toFixed(1)}x`);

/**
 * "(2.9x, n 22, 90% 2.1x to 3.8x)": every statement carries lift, n and its interval (AC3).
 * v2 case-control values read "(3.5x the odds, n 9, 90% 1.4x to 8.7x)" (04 5.5).
 */
export function liftEvidence(f: Pick<LabFeatureLift, 'lift' | 'n' | 'lo' | 'hi'> & { method?: LabFeatureLift['method'] }): string {
  const interval = f.lo !== null && f.hi !== null ? `, 90% ${fmtX(f.lo)} to ${fmtX(f.hi)}` : '';
  const odds = f.method === 'mh' ? ' the odds' : '';
  return `(${f.lift === null ? 'no lift' : `${fmtX(f.lift)}${odds}`}, n ${f.n}${interval})`;
}

/** How each feature reads inside "Breakouts …" (value already human-labelled, lower case). */
const PHRASE: Record<string, (v: string) => string> = {
  hook_form: (v) => `open ${v}`,
  emotional_trigger: (v) => `pull on ${v}`,
  hook_channel: (v) => `carry the hook as ${v}`,
  hook_words: (v) => `keep the hook to ${v}`,
  structure_type: (v) => `are built as ${v}`,
  beat_template: (v) => `follow ${v}`,
  duration: (v) => `run ${v}`,
  wpm: (v) => `talk at ${v}`,
  first_beat: (v) => `spend ${v} of the runtime on the hook`,
  rehook: (v) => (v === 'yes' ? 'rehook partway through' : 'skip the rehook'),
  cta_type: (v) => `close on a ${v} CTA`,
  topic_cluster: (v) => `cover ${v}`,
  post_hour: (v) => `go up ${v}`,
};
/** How a feature that hurts reads as a subject ("List tease hooks underperform here"). */
const SUBJECT: Record<string, (v: string) => string> = {
  hook_form: (v) => `${v} hooks`,
  emotional_trigger: (v) => `${v} as the trigger`,
  hook_channel: (v) => `a ${v} hook`,
  hook_words: (v) => `hooks of ${v}`,
  structure_type: (v) => `${v} structures`,
  beat_template: (v) => `the ${v} shape`,
  duration: (v) => `posts of ${v}`,
  wpm: (v) => `a pace of ${v}`,
  first_beat: (v) => `a hook taking ${v} of the runtime`,
  rehook: (v) => (v === 'yes' ? 'a rehook' : 'no rehook'),
  cta_type: (v) => `a ${v} CTA`,
  topic_cluster: (v) => v,
  post_hour: (v) => `posting ${v}`,
};

const joinList = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * The profile as plain sentences (SPEC §4.7): only shown features (n >= 8 breakouts,
 * interval excluding 1.0), each quoting lift, n and the interval. No hedging, no dashes.
 * `label(feature, value)` turns stored values into words (cluster ids into names).
 */
export function profileSentences(p: LabProfile, label: (feature: string, value: string) => string): string[] {
  const shown = p.features.filter((f) => f.shown && f.lift !== null);
  // one value per feature in each sentence (the strongest), so a sentence never says two paces
  const firstPer = (xs: LabFeatureLift[]) => xs.filter((f, i) => xs.findIndex((g) => g.feature === f.feature) === i);
  const ups = firstPer(shown.filter((f) => f.lift! > 1).sort((a, b) => b.lift! - a.lift!));
  const downs = firstPer(shown.filter((f) => f.lift! < 1).sort((a, b) => a.lift! - b.lift!));
  const v = (f: LabFeatureLift) => label(f.feature, f.value).toLowerCase();
  const out: string[] = [];
  if (ups.length) out.push(`Breakouts ${joinList(ups.slice(0, 3).map((f) => `${(PHRASE[f.feature] ?? ((x: string) => `use ${x}`))(v(f))} ${liftEvidence(f)}`))}.`);
  if (p.stats.wpm) out.push(`They run ${p.stats.wpm[0]} to ${p.stats.wpm[1]} words a minute (middle half of n ${p.breakoutsN} breakouts).`);
  if (p.stats.durationS) out.push(`Most last ${p.stats.durationS[0]} to ${p.stats.durationS[1]} seconds.`);
  if (p.strand.length) out.push(`The usual shape is ${beatTemplate(p.strand)}.`);
  for (const f of downs.slice(0, 2)) {
    const s = (SUBJECT[f.feature] ?? ((x: string) => x))(v(f));
    out.push(`${s.charAt(0).toUpperCase()}${s.slice(1)} underperform${/s$/.test(s) && !/^a /.test(s) ? '' : 's'} here ${liftEvidence(f)}.`);
  }
  const hidden = bhHiddenCount(p);
  if (hidden > 0) out.push(`${hidden} more pattern${hidden === 1 ? '' : 's'} looked strong but did not survive the false-discovery check.`);
  return out;
}
