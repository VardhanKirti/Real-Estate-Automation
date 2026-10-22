/**
 * Generation domain views (07 7.2, 7.8, 7.12.3; 01 D13 and 25.2). Lane G owns this file. Lane V
 * wraps these unchanged in its page and sheet models; nothing here formats a number outside
 * 01's rules (one decimal ratios, `not enough yet` under n 5).
 */
import type { LabBand, LabGate, LabGateCheck, LabGrounding, LabHookForm, LabIdea, LabPlatform, LabRuleResult, LabScriptBody, LaunchAngle } from '@/lib/schemas';
import { emptyGrounding } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import type { IdeaCard } from '@/lib/lab/view/legacy';
import { beatLabel, humanize, ideaCardsFor, specimenCardsFor } from '@/lib/lab/view/legacy';
import type { PostCardView } from '@/lib/lab/view/breakouts';
import { LAB_LAYERS_BUILT } from '@/lib/lab/view/layers';
import { ageMatchedView } from '@/lib/lab/measure/view';
import { wordBudget, wordCount } from '@/lib/lab/measures';
import { HOOK_WORD_BUDGET, sectionBudgets } from '@/lib/lab/gate';
import { labTz } from '@/lib/lab/setup/jobs';
import { judgeMessage, judgeRecord, type JudgeRecord } from '@/lib/lab/gen/judge';
import { commentSeeds, type CommentSeed } from '@/lib/lab/gen/comments';
import { activeModel, ideaText, localVec, LOCAL_EMBED_MODEL, meanPairwiseCos } from '@/lib/lab/gen/embed';
import { bodyV2, gateCounts } from '@/lib/lab/gen/rules';
import { concreteness, labEntities, loadLexicon } from '@/lib/lab/gen/lexicon';
import { skillPresence, voiceSkillsFor } from '@/lib/lab/gen/skills';
import { publishCandidates, storedJudgeWins } from '@/lib/lab/gen/editor';
import { openEvents } from '@/lib/lab/gen/events';
import { OPEN_CAP } from '@/lib/lab/ideas';
import { askSummary, handleMap, matchLabel, parseAsk, searchAsk, type AskFilters } from '@/lib/lab/gen/ask';
import { MIN_N, NOT_ENOUGH, x1 } from '@/lib/lab/gen/format';
import type { Embedder } from '@/lib/lab/gen/embed';

export type { JudgeRecord, JudgeVerdict } from '@/lib/lab/gen/judge';
export type { AskFilters } from '@/lib/lab/gen/ask';

/** 07 7.3.8 Generate button states. */
export type GenerateState = 'ready' | 'no_material' | 'full' | 'running' | 'dry' | 'read_only' | 'cli_missing';

/** 07 Studio domain view (01 25.2: diversity, seeds and the Generate state). */
export type StudioView = {
  ideas: IdeaCard[];
  /** 7.3.7: 'Spread: ideas are {pct}% alike on average (n {n}).' | 'Spread: not enough yet (n {n}).' */
  diversity: { text: string; n: number };
  seeds: CommentSeed[];
  generate: { state: GenerateState; line: string; disabledReason: string | null };
  openIdeas: number;
  dry: boolean;
};

/** 01 16.1: v1 IdeaCard fields plus the v2 fields 07 provides. */
export type IdeaSheetView = IdeaCard & {
  eventId: string | null;
  launchAngle: LaunchAngle | null;
  source: 'sync' | 'generate' | 'event' | 'seed' | 'manual';
  grounding: LabGrounding;
  variants: { state: 'ready' | 'empty' | 'not_built'; items: { id: string; hook: string; hookForm: LabHookForm; angle: string; whyText: string }[] };
};

/** The freeze state 01 17.2 reads from ScriptSheetView.prediction (07 7.8 Freeze rules). */
export type ScriptPredictionView = {
  state: 'none' | 'frozen' | 'not_built';
  frozenAt: string | null;
  /** the script version current at frozenAt */
  frozenVersion: number | null;
  /** LAB_COPY.frozenAt filled: 'Frozen 11 Oct, 14:02' */
  frozenText: string | null;
  band: LabBand | null;
};

/** 07 7.8 */
export type ScriptSheetView = {
  id: string;
  title: string;
  status: 'draft' | 'published';
  idea: { id: string; title: string; angle: string; angleClass: string | null; eventId: string | null } | null;
  version: number;
  versions: { version: number; createdAt: string; passed: boolean; edit: boolean; frozen: boolean }[];
  body: LabScriptBody;
  plan: { durationS: number; durationSource: string; wpm: number; wpmSource: string; words: number };
  strand: { type: string; label: string; startPct: number; endPct: number }[];
  sections: { index: number; type: string; label: string; startPct: number; endPct: number; words: number; budget: number; deltaPct: number; over: boolean; rules: LabRuleResult[]; checks: LabGateCheck[] }[];
  hooks: { index: number; form: string; formLabel: string; trigger: string; triggerLabel: string; spoken: string; words: number; budget: number; concreteness: number | null; judgeWins: number | null }[];
  hookChoice: number;
  gate: { passed: boolean; toFix: number; toConsider: number; scores: LabGate['scores']; rules: LabRuleResult[] };
  grounding: LabGrounding;
  judge: JudgeRecord & { message: string };
  prediction: ScriptPredictionView;
  skills: { slug: string; found: boolean }[];
  /** ranked by 07's cosine rule (7.8, AC-07-33): own posts from the last 7 days; empty unless a draft */
  publishCandidates: { postId: string; label: string; postedAt: string | null; similarity: number | null }[];
  dry: boolean;
};

/** 07 7.12.3 */
export type AskView = {
  query: string;
  filters: AskFilters;
  model: string;
  indexing: { done: number; total: number } | null;
  n: number;
  summary: string;
  cards: { postId: string; similarity: number | null; match: 'close' | 'related' | 'filter'; card: PostCardView }[];
};

export type GenViewOpts = { now?: Date; dry?: boolean; sample?: boolean; readOnly?: boolean };

/* ── copy (7.3.7, 7.3.8, 7.8) ─────────────────────────────────────────── */

export const GEN_COPY = {
  ready: 'Writes 24, keeps the 10 most different. Local model, no cost.',
  noMaterial: 'Generate needs scraped posts first. Run a sync.',
  full: `${OPEN_CAP} open ideas. Use or dismiss some first.`,
  dry: 'Dry run: no model is called.',
  readOnly: 'Sample data is a read-only preview. Connect Apify to work on real data.',
  cliMissing: 'The claude CLI is not on this host. Generate needs it.',
  /** 01 / 07 7.8: the one freeze seal template (LAB_COPY.frozenAt in lane V's copy.ts) */
  frozenAt: 'Frozen {d MMM}, {HH:mm}',
} as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Frozen 11 Oct, 14:02' in the Lab's local time zone. */
export function frozenText(iso: string, tz: string = labTz()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = get('hour') === '24' ? '00' : get('hour');
  return GEN_COPY.frozenAt.replace('{d MMM}', `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]}`).replace('{HH:mm}', `${hh.padStart(2, '0')}:${get('minute').padStart(2, '0')}`);
}

/* ── Studio ───────────────────────────────────────────────────────────── */

/** 7.3.7: mean pairwise cosine over open ideas (all sources), active model; n under 5 reads not enough yet. */
export function diversityLine(store: LabStore): { text: string; n: number; mean: number | null } {
  const model = activeModel({ store });
  const open = store.ideas.all('open');
  const vecs = open.flatMap((i) => {
    const v = store.embeddings.get('idea', i.id, model)?.vec ?? (model === LOCAL_EMBED_MODEL ? localVec(ideaText(i)) : null);
    return v ? [v] : [];
  });
  const n = open.length;
  if (n < MIN_N) return { text: `Spread: ${NOT_ENOUGH} (n ${n}).`, n, mean: null };
  const mean = meanPairwiseCos(vecs);
  if (mean === null) return { text: `Spread: ${NOT_ENOUGH} (n ${n}).`, n, mean: null };
  return { text: `Spread: ideas are ${Math.round(100 * mean)}% alike on average (n ${n}).`, n, mean };
}

/** 7.3.8 material: a cluster with 2 or more competitor posts, or an open event. */
export function hasMaterial(store: LabStore): boolean {
  if (openEvents(store).length) return true;
  const owned = new Set(store.posts.all().filter((p) => p.isOwned).map((p) => p.id));
  const per = new Map<string, number>();
  for (const t of store.topics.all()) {
    if (!t.isPrimary || !t.clusterId || owned.has(t.postId)) continue;
    const n = (per.get(t.clusterId) ?? 0) + 1;
    if (n >= 2) return true;
    per.set(t.clusterId, n);
  }
  return false;
}

export function generateState(store: LabStore, opts: GenViewOpts = {}): StudioView['generate'] {
  const open = store.ideas.all('open').length;
  if (opts.readOnly || opts.sample) return { state: 'read_only', line: GEN_COPY.readOnly, disabledReason: GEN_COPY.readOnly };
  if (open >= OPEN_CAP) return { state: 'full', line: GEN_COPY.full, disabledReason: GEN_COPY.full };
  if (!hasMaterial(store)) return { state: 'no_material', line: GEN_COPY.noMaterial, disabledReason: GEN_COPY.noMaterial };
  if (opts.dry) return { state: 'dry', line: GEN_COPY.dry, disabledReason: null };
  return { state: 'ready', line: GEN_COPY.ready, disabledReason: null };
}

export function studioView(store: LabStore, opts: GenViewOpts = {}): StudioView {
  const now = opts.now ?? new Date();
  const d = diversityLine(store);
  return {
    ideas: ideaCardsFor(store, store.ideas.all(), { now }),
    diversity: { text: d.text, n: d.n },
    seeds: commentSeeds(store, now),
    generate: generateState(store, opts),
    openIdeas: store.ideas.all('open').length,
    dry: Boolean(opts.dry),
  };
}

/* ── Idea sheet ───────────────────────────────────────────────────────── */

const hookFormOf = (i: LabIdea): LabHookForm => i.hookForm ?? i.hookRecs[0]?.form ?? 'other';

/** Grounded variants (7.3): the other open ideas from the same Generate batch or the same event, by MMR rank. */
function variantsFor(store: LabStore, idea: LabIdea): IdeaSheetView['variants'] {
  const sibs = store.ideas
    .all('open')
    .filter((i) => i.id !== idea.id && ((idea.batchId && i.batchId === idea.batchId) || (idea.eventId && i.eventId === idea.eventId)))
    .sort((a, b) => (a.mmrRank ?? 99) - (b.mmrRank ?? 99) || a.id.localeCompare(b.id))
    .slice(0, 6);
  const items = sibs.map((i) => {
    const g = i.grounding ?? emptyGrounding;
    return { id: i.id, hook: i.title, hookForm: hookFormOf(i), angle: i.angle, whyText: g.exemplars.length ? `Grounded in ${g.exemplars.length} ${g.exemplars.length === 1 ? 'breakout' : 'breakouts'}` : 'No grounding examples' };
  });
  return { state: items.length ? 'ready' : 'empty', items };
}

export function ideaSheetView(store: LabStore, id: string, opts: GenViewOpts = {}): IdeaSheetView | null {
  const idea = store.ideas.get(id);
  if (!idea) return null;
  // the sheet opens even when evidence posts are gone (honest: fewer evidence cards)
  const [base] = ideaCardsFor(store, [idea], { now: opts.now, minEvidence: 0 });
  if (!base) return null;
  return {
    ...base,
    eventId: idea.eventId ?? null,
    launchAngle: idea.launchAngle ?? null,
    source: idea.source ?? 'sync',
    grounding: idea.grounding ?? emptyGrounding,
    variants: LAB_LAYERS_BUILT.gen ? variantsFor(store, idea) : { state: 'not_built', items: [] },
  };
}

/* ── Script sheet ─────────────────────────────────────────────────────── */

const LETTERS = ['A', 'B', 'C', 'D'];

function predictionFor(store: LabStore, scriptId: string): ScriptPredictionView {
  const live = store.predictions.forScript(scriptId).filter((p) => p.predictor === 'brody' && p.origin === 'live' && p.status !== 'void' && !p.dry);
  const p = live.sort((a, b) => a.frozenAt.localeCompare(b.frozenAt))[0];
  if (p) return { state: 'frozen', frozenAt: p.frozenAt, frozenVersion: p.scriptVersion, frozenText: frozenText(p.frozenAt), band: p.band };
  return { state: LAB_LAYERS_BUILT.ledger ? 'none' : 'not_built', frozenAt: null, frozenVersion: null, frozenText: null, band: null };
}

/** v1 versions read with 07's defaults (AC-07-25). */
export function withV2Defaults(body: LabScriptBody): LabScriptBody {
  const v = bodyV2(body);
  return { ...body, platform: v.platform as LabPlatform | 'multi', loops: v.loops, withheld: v.withheld, peakSection: v.peakSection, endType: v.endType, grounding: body.grounding ?? emptyGrounding, arm: v.arm, armP: v.armP };
}

export function scriptSheetView(store: LabStore, id: string, opts: GenViewOpts & { version?: number | null } = {}): ScriptSheetView | null {
  const now = opts.now ?? new Date();
  const script = store.scripts.get(id);
  const all = store.scripts.versions(id);
  if (!script || all.length === 0) return null;
  const v = (opts.version ? all.find((x) => x.version === opts.version) : null) ?? all[all.length - 1];
  const idea = script.ideaId ? store.ideas.get(script.ideaId) : null;
  const body = withV2Defaults(v.body);
  const prediction = predictionFor(store, id);
  const rules = v.gate.rules ?? [];
  const budgets = sectionBudgets(body);
  const lex = loadLexicon();
  const entities = lex ? labEntities(store) : undefined;
  const wins = storedJudgeWins(store, id);
  const winsFor = wins && wins.version === v.version && wins.applied ? wins.wins : null;
  const record = judgeRecord(store, now);
  const leanIdx = winsFor && Math.max(...winsFor) > 0 ? winsFor.indexOf(Math.max(...winsFor)) : -1;
  const counts = gateCounts(v.gate);
  return {
    id: script.id,
    title: script.title,
    status: script.status,
    idea: idea ? { id: idea.id, title: idea.title, angle: idea.angle, angleClass: idea.launchAngle ?? null, eventId: idea.eventId ?? null } : null,
    version: v.version,
    versions: all.map((x) => ({ version: x.version, createdAt: x.createdAt, passed: x.gate.passed, edit: Boolean(x.editDiff), frozen: prediction.frozenVersion === x.version })),
    body,
    plan: { durationS: body.durationS, durationSource: 'this version', wpm: body.wpm, wpmSource: 'this version', words: wordBudget(body.durationS, body.wpm) },
    strand: (idea?.strand.length ? idea.strand : body.sections).map((s) => ({ type: s.type, label: beatLabel(s.type), startPct: s.startPct, endPct: s.endPct })),
    sections: body.sections.map((s, index) => {
      const b = budgets[index];
      return { index, type: s.type, label: beatLabel(s.type), startPct: s.startPct, endPct: s.endPct, words: b.words, budget: b.budget, deltaPct: Math.round(b.delta * 100), over: b.over, rules: rules.filter((r) => r.section === index), checks: v.gate.checks.filter((c) => c.section === index) };
    }),
    hooks: body.hooks.map((h, index) => ({ index, form: h.form, formLabel: humanize(h.form), trigger: h.trigger, triggerLabel: humanize(h.trigger), spoken: h.spoken, words: wordCount(h.spoken), budget: HOOK_WORD_BUDGET[h.form] ?? 14, concreteness: lex ? concreteness(h.spoken, lex, entities).score : null, judgeWins: winsFor ? (winsFor[index] ?? 0) : null })),
    hookChoice: body.hookChoice,
    gate: { passed: v.gate.passed, toFix: counts.toFix, toConsider: counts.toConsider, scores: v.gate.scores, rules: rules.filter((r) => r.section === null) },
    grounding: body.grounding ?? idea?.grounding ?? emptyGrounding,
    judge: { ...record, message: judgeMessage(record, leanIdx >= 0 && record.state !== 'off' ? LETTERS[leanIdx] : null) },
    prediction,
    skills: skillPresence(voiceSkillsFor(idea, body)),
    publishCandidates: script.status === 'draft' ? publishCandidates(store, id, { now }) : [],
    dry: Boolean(opts.dry),
  };
}

/* ── Ask the Lab ──────────────────────────────────────────────────────── */

function postCard(store: LabStore, postId: string, now: Date): PostCardView | null {
  const [spec] = specimenCardsFor(store, [postId], { now });
  const post = store.posts.get(postId);
  if (!spec || !post) return null;
  const m = store.measures.get(postId);
  const niche = m?.nicheRatio ?? null;
  const nicheOk = niche !== null && (m?.baselineN ?? 0) >= MIN_N;
  return {
    ...spec,
    read: ageMatchedView(m ?? null, post, now, LAB_LAYERS_BUILT.measure),
    nicheRatio: { value: nicheOk ? niche : null, n: m?.baselineN ?? 0, enough: nicheOk, text: nicheOk ? x1(niche!) : null },
    dualHigh: Boolean(m?.dualHigh),
    confidenceBars: { lo: m?.breakoutLo ?? null, hi: m?.breakoutHi ?? null, point: m?.breakout ?? null, scaleMax: Math.max(5, Math.ceil(m?.breakoutHi ?? 0)) },
    exogenous: Boolean(post.exoReason) || Boolean(m?.exoAuto),
  };
}

export async function askView(store: LabStore, q: string, opts: GenViewOpts & { limit?: number; embedder?: Embedder } = {}): Promise<AskView> {
  const now = opts.now ?? new Date();
  const filters = parseAsk(q, { handles: handleMap(store) });
  const s = await searchAsk(store, filters, { now, limit: opts.limit, embedder: opts.embedder });
  const cards = s.hits.flatMap((h) => {
    const card = postCard(store, h.post.id, now);
    return card ? [{ postId: h.post.id, similarity: h.similarity, match: matchLabel(h.similarity, s.model), card }] : [];
  });
  return {
    query: q,
    filters,
    model: s.model,
    indexing: s.indexing,
    n: cards.length,
    summary: askSummary(s.hits, { indexed: s.indexed, semantic: Boolean(filters.semantic) || store.posts.count() === 0 }),
    cards,
  };
}

