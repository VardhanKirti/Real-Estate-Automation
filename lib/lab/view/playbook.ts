/**
 * Playbook (`/lab/playbook`) page model (01 10.2) and its builder. Reads 04's lift rows (`shown`),
 * 06's testMark and 07's rule metadata unchanged.
 */
import type { LabProfile } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { LabContext } from '@/lib/lab/context';
import type { LabParams } from '@/lib/lab/view/shared';
import { FEATURE_LABEL, profileSentences } from '@/lib/lab/distill';
import { allProfiles, context, dnaView, familyLabel, humanize, profileView, strandView, valueLabel } from '@/lib/lab/view/legacy';
import { testMark } from '@/lib/lab/ledger/tests';
import { RULE_META, ruleAgreement } from '@/lib/lab/gen/rules';
import { NICHE_PRIOR_BAND, bandKey } from '@/lib/lab/gen/lexicon';
import { currentGates } from '@/lib/lab/setup/forecasts';
import { LAB_COPY } from '@/lib/lab/view/copy';
import { fill, fmtRange, fmtRatio, nText } from '@/lib/lab/view/format';
import { READY, section, state, withSample } from '@/lib/lab/view/section';
import type { DnaView, StrandView } from '@/lib/lab/view/legacy';
import type { SectionState } from '@/lib/lab/view/shared';
import type { LabFrameView } from '@/lib/lab/view/frame';
import type { SheetPayload } from '@/lib/lab/view/index';
import type { GateEta } from '@/lib/lab/setup/gates';
import type { TestMark } from '@/lib/lab/ledger/tests';

export type PlaybookPageView = {
  frame: LabFrameView;
  sheet: SheetPayload | null;
  formats: { id: string; label: string; breakoutsN: number; href: string; active: boolean }[];
  /** selected; default = format with most breakouts */
  format: string | null;
  shape: { state: SectionState; breakout: StrandView | null; yours: StrandView | null; statsText: string | null; yoursN: number };
  lifts: { state: SectionState; rows: LiftRowView[]; hiddenCount: number; hiddenText: string | null; method: string };
  dna: { state: SectionState; view: DnaView | null; sentences: string[] };
  rules: { state: SectionState; rows: RuleRowView[] };
  /** 09.3.8, same source as BreakoutsPageView.gates; empty state only (10.3) */
  gates: GateEta[] | null;
};

export type LiftRowView = {
  /** "lift-<feature>-<value>", the anchor id */
  id: string;
  feature: string;
  featureLabel: string;
  value: string;
  valueLabel: string;
  /** odds ratio once case-control is live, v1 lift before */
  estimate: number;
  estimateKind: 'odds_ratio' | 'lift';
  /** "3.7x" */
  text: string;
  lo: number;
  hi: number;
  rangeText: string;
  /** breakouts carrying it */
  n: number;
  nText: string;
  /** section 06 testMark(store, featureKey, liftSign).mark */
  mark: TestMark;
  /** section 06 testMark().label verbatim */
  markLabel: string;
  /** "?test=<id>" */
  testHref: string | null;
  /** v1 profileSentences output for this row */
  sentence: string;
};

export type RuleRowView = {
  /** rule id from section 07 rule pack */
  id: string;
  /** "Name one concrete thing, hold back one fact" */
  label: string;
  /** "Aubin Le Quere and Matias 2025 (Upworthy, 8,977 tests)" */
  source: string;
  agrees: 'yes' | 'no' | 'not_enough' | 'not_tested';
  /** "Your data agrees (n 31)" | "Your data disagrees (n 28)" | "not enough yet (n 3)" | "Not tested on your data yet" */
  agreesText: string;
  n: number;
};

/* ── builder (01 10) ──────────────────────────────────────────────────── */

const DAY = 86_400_000;

function liftRows(store: LabStore, c: ReturnType<typeof context>, p: LabProfile, sample: boolean): { rows: LiftRowView[]; hidden: number } {
  const sentences = profileSentences(p, (f, v) => valueLabel(c, f, v));
  const rows: LiftRowView[] = [];
  let hidden = 0;
  for (const f of p.features) {
    if (f.lift === null) continue;
    if (!f.shown || f.lo === null || f.hi === null) {
      if (f.n >= 8) hidden++;
      continue;
    }
    const key = `${f.feature}:${f.value}`;
    const tm = testMark(store, key, f.lift >= 1 ? 1 : -1);
    const tests = store.tests.forFeature(key).filter((t) => t.status !== 'abandoned').sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
    const vLabel = valueLabel(c, f.feature, f.value);
    rows.push({
      id: `lift-${f.feature}-${f.value}`,
      feature: f.feature,
      featureLabel: FEATURE_LABEL[f.feature] ?? humanize(f.feature),
      value: f.value,
      valueLabel: vLabel,
      estimate: f.lift,
      estimateKind: f.method === 'mh' ? 'odds_ratio' : 'lift',
      text: fmtRatio(f.lift),
      lo: f.lo,
      hi: f.hi,
      rangeText: fmtRange(f.lo, f.hi),
      n: f.n,
      nText: nText(f.n),
      mark: tm.mark,
      markLabel: tm.label,
      testHref: tm.mark !== 'correlation' && tests[0] ? withSample(`?test=${encodeURIComponent(tests[0].id)}`, sample) : null,
      sentence: sentences.find((x) => x.toLowerCase().includes(vLabel.toLowerCase())) ?? `${FEATURE_LABEL[f.feature] ?? humanize(f.feature)}: ${vLabel.toLowerCase()} ${fmtRatio(f.lift)} (${nText(f.n)}).`,
    });
  }
  rows.sort((a, b) => Number(a.mark === 'contradicted') - Number(b.mark === 'contradicted') || b.lo - a.lo || a.id.localeCompare(b.id));
  return { rows, hidden };
}

function ruleRows(store: LabStore): RuleRowView[] {
  const bands = store.priors.byPrefix(bandKey('')).map((p) => ({ n: p.n, value: p.value as { lo: number; hi: number } }));
  const L = LAB_COPY.playbook;
  return RULE_META.map((r) => {
    const a = ruleAgreement(r.id, bands, NICHE_PRIOR_BAND);
    const agrees: RuleRowView['agrees'] = a.agrees === 'yes' ? (a.n >= 5 ? 'yes' : 'not_enough') : a.agrees === 'no' ? (a.n >= 5 ? 'no' : 'not_enough') : a.agrees === 'not enough yet' ? (a.n > 0 ? 'not_enough' : 'not_tested') : 'not_tested';
    const agreesText = agrees === 'yes' ? fill(L.agrees, { n: a.n }) : agrees === 'no' ? fill(L.disagrees, { n: a.n }) : agrees === 'not_enough' ? fill(L.notEnoughRule, { n: a.n }) : L.notTested;
    return { id: r.id, label: r.label, source: r.source, agrees, agreesText, n: a.n };
  });
}

export function buildPlaybook(store: LabStore, params: LabParams, flags: LabContext['flags'], now: Date, inp: { frame: LabFrameView; sheet: SheetPayload | null }): PlaybookPageView {
  const sample = Boolean(flags.sample);
  const L = LAB_COPY.playbook;
  const latest = store.profiles.latest();
  const formats = latest
    .map((p) => ({ id: p.formatFamily, label: p.label || familyLabel(p.formatFamily), breakoutsN: p.breakoutsN }))
    .sort((a, b) => b.breakoutsN - a.breakoutsN || a.label.localeCompare(b.label));
  const selected = (params.format && formats.some((f) => f.id === params.format) ? params.format : formats[0]?.id) ?? null;
  const view: PlaybookPageView = {
    frame: inp.frame,
    sheet: inp.sheet,
    formats: formats.map((f) => ({ ...f, href: withSample(`/lab/playbook?format=${encodeURIComponent(f.id)}`, sample), active: f.id === selected })),
    format: selected,
    shape: { state: state('empty', L.empty), breakout: null, yours: null, statsText: null, yoursN: 0 },
    lifts: { state: state('empty', L.empty), rows: [], hiddenCount: 0, hiddenText: null, method: L.methodLift },
    dna: { state: state('empty'), view: null, sentences: [] },
    rules: { state: inp.frame.layers.gen === 'live' ? READY : state('not_built', LAB_COPY.layer.gen), rows: [] },
    gates: null,
  };
  if (inp.frame.mode.state === 'not_configured') return view;
  const P = 'playbook';
  const c = context(store, now, new Date(now.getTime() - 7 * DAY));
  const profile = latest.find((p) => p.formatFamily === selected) ?? null;

  if (!profile) {
    view.gates = section(P, 'gates', () => currentGates(store, now), () => null);
    const g = view.gates?.find((x) => x.gate === 'profile_strong' && x.state === 'predicted' && x.days);
    const active = store.sources.all('tracked').filter((x) => x.status === 'active').length;
    const extra = g?.days ? ` ${fill(L.gatesLine, { weeks: Math.max(1, Math.round(g.days.med / 7)), n: active })}` : '';
    view.shape = { ...view.shape, state: state('empty', `${L.empty}${extra}`) };
  } else {
    const all = allProfiles(store);
    const pv = section(P, 'profile', () => profileView(c, profile, all), () => null);
    view.shape = section(P, 'shape', () => {
      const owned = c.posts
        .filter((p) => p.isOwned && c.dissections.get(p.id)?.format === profile.formatFamily)
        .sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''));
      const yoursPost = owned[0];
      const yours = yoursPost ? strandView(c.dissections.get(yoursPost.id)?.beats, yoursPost.durationS) : null;
      const parts = [pv?.stats.wpmText, pv?.stats.durationText].filter(Boolean).join(', ');
      return {
        state: yours ? READY : state('empty', fill(L.noYours, { format: (pv?.label ?? familyLabel(profile.formatFamily)).toLowerCase() })),
        breakout: strandView(profile.strand),
        yours,
        statsText: parts ? `${parts} (${nText(profile.breakoutsN)})` : null,
        yoursN: owned.length,
      };
    }, (s) => ({ ...view.shape, state: s }));
    view.lifts = section(P, 'lifts', () => {
      const { rows, hidden } = liftRows(store, c, profile, sample);
      const hiddenText = hidden > 0 ? fill(L.hidden, { k: hidden }) : null;
      const anyMh = profile.features.some((f) => f.method === 'mh');
      const st = rows.length ? READY : hidden > 0 ? state('empty', fill(L.nothingClears, { hidden: hiddenText ?? '' }).trim()) : state('empty', fill(L.notEnoughBreakouts, { n: profile.breakoutsN }));
      return { state: st, rows, hiddenCount: hidden, hiddenText, method: anyMh ? L.methodOr : L.methodLift };
    }, (s) => ({ ...view.lifts, state: s }));
    view.dna = section(P, 'dna', () => {
      const d = dnaView(c);
      return { state: d.posts ? READY : state('empty'), view: d, sentences: pv?.sentences ?? [] };
    }, (s) => ({ ...view.dna, state: s }));
  }
  if (inp.frame.layers.gen === 'live') view.rules = section(P, 'rules', () => ({ state: READY, rows: ruleRows(store) }), (s) => ({ state: s, rows: [] }));
  return view;
}
