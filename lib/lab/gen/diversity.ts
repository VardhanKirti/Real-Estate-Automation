/**
 * Generate ideas: the diversity engine (07 7.3). Three Verbalized Sampling rounds of 8 grounded
 * candidates through the local claude CLI, the v1 anti-invention check extended to events and
 * comment seeds, worn-out angles dropped, near duplicates dropped by cosine, then greedy MMR
 * with hard caps and soft minimums keeps the 10 most different. Rejected candidates are never
 * stored as ideas; the batch summary (`BatchOutcome`) is stored on the first round's run.
 *
 * Dry or Filming: no CLI process; 24 deterministic candidates from v1 dryIdeas crossed with
 * each cluster's open angles and the top hook cells, `vsProbability = 1 / (rank + 1)`.
 */
import { randomUUID } from 'node:crypto';
import type { LabHookForm, LabIdea, LabTrigger, LaunchAngle } from '@/lib/schemas';
import { LabFormatSchema, VsReplySchema } from '@/lib/schemas';
import type { z } from 'zod';
import type { LabStore } from '@/lib/lab/store';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { gatedCall } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { LAB_ANTI_INVENTION, OPEN_CAP, dryIdeas, enrichIdea, hookRecs, ideaContext, ideaPrompt, type IdeaContext, type RawIdea } from '@/lib/lab/ideas';
import { angleStats, clusterAngleRows } from '@/lib/lab/trends';
import { fmtRatio } from '@/lib/lab/measures';
import { activeEmbedder, cosine, embedTexts, ideaText, localEmbedder, meanPairwiseCos, textHash, type Embedder } from '@/lib/lab/gen/embed';
import { groundingPool, retrieveGrounding } from '@/lib/lab/gen/grounding';
import { eventAngleStats, openEvents } from '@/lib/lab/gen/events';
import { commentSeeds, type CommentSeed } from '@/lib/lab/gen/comments';
import { ANGLE_LABEL } from '@/lib/lab/radar/angles';

export const VS_ROUNDS = 3;
/** 24 candidates total (research range 20 to 30) */
export const VS_PER_ROUND = 8;
/** "tail" = verbalized probability below this */
export const VS_TAIL_P = 0.1;
/** asked for in the prompt */
export const VS_TAIL_MIN_PER_ROUND = 3;
export const BATCH_K = 10;
export const MMR_LAMBDA = 0.6;
export const DEDUPE_COSINE: Record<string, number> = { 'local-hash-v1': 0.82, 'text-embedding-3-small': 0.9 };
export const DEDUPE_LOOKBACK_DAYS = 30;
export const QUOTAS = {
  maxPerHookCell: 2,
  maxPerTopic: 3,
  minHookForms: 4,
  minUntakenAngles: 4,
  minTail: 2,
} as const;
export const IDEAS_PROMPT_VERSION = 'ideas-v2';
export const VS_TIMEOUT_MS = 150_000;

export type VsCandidate = z.infer<typeof VsReplySchema>['candidates'][number];
export type VsAsk = (prompt: string) => Promise<ClaudeJson<z.input<typeof VsReplySchema>>>;
export type SoftQuota = 'minHookForms' | 'minUntakenAngles' | 'minTail';

export type BatchOutcome = {
  batchId: string;
  /** raw, before grounding */
  candidates: number;
  grounded: number;
  dropped: { title: string; reason: string }[];
  exhausted: number;
  duplicates: number;
  /** <= BATCH_K */
  kept: number;
  unmetQuotas: SoftQuota[];
  /** over the kept set, active embedder */
  meanPairwiseCos: number | null;
  embedModel: string;
  rounds: { round: number; ok: boolean; candidates: number; error: string | null }[];
};

/* ── context and prompt ───────────────────────────────────────────────── */

export type VsEvent = { id: string; name: string; ageH: number | null; clusterId: string | null; windowState: 'open' | 'closing'; taken: { angle: string; lift: number | null; n: number }[]; untaken: string[] };
export type VsContext = { idea: IdeaContext; events: VsEvent[]; seeds: CommentSeed[]; knownEvents: Set<string>; knownSeeds: Set<string> };

export function vsContext(store: LabStore, now: Date): VsContext {
  const idea = ideaContext(store, { now });
  const events: VsEvent[] = openEvents(store).map((e) => {
    const stats = eventAngleStats(store, e.id);
    return {
      id: e.id,
      name: e.name,
      ageH: e.t0 ? Math.max(0, Math.round((now.getTime() - Date.parse(e.t0)) / 3_600_000)) : null,
      clusterId: e.clusterId,
      windowState: e.windowState as 'open' | 'closing',
      taken: stats.filter((s) => s.taken).map((s) => ({ angle: s.angle, lift: s.median, n: s.n })),
      untaken: stats.filter((s) => !s.taken).map((s) => s.angle),
    };
  });
  const seeds = commentSeeds(store, now);
  return { idea, events, seeds, knownEvents: new Set(store.events.all().map((e) => e.id)), knownSeeds: new Set(seeds.map((s) => s.id)) };
}

/** The CLUSTERS block of v1's ideaPrompt, verbatim (everything before its anti-invention rule). */
function clustersBlock(ctx: IdeaContext): string {
  const full = ideaPrompt(ctx, []);
  return full.split(LAB_ANTI_INVENTION)[0].trim();
}

export const ANTI_INVENTION_V2 = `${LAB_ANTI_INVENTION} Cite ONLY cluster ids, event ids, seed ids and post ids that appear above.`;

/** One VS round's prompt; `prior` = titles and hook cells from earlier rounds of this batch. */
export function vsPrompt(ctx: VsContext, round: number, prior: { titles: string[]; cells: string[] }): string {
  const lines: string[] = [clustersBlock(ctx.idea), ''];
  if (ctx.events.length) {
    lines.push('EVENTS WITH AN OPEN WINDOW (event id · title · age · angles taken · angles untaken):');
    for (const e of ctx.events) {
      const taken = e.taken.map((t) => `${t.angle} (lift ${t.lift === null ? 'n/a' : fmtRatio(t.lift)}, n ${t.n})`).join(', ') || 'none';
      lines.push(`- event=${e.id} · ${e.name} · ${e.ageH === null ? 'n/a' : `${e.ageH}h`} · taken: ${taken} · untaken: ${e.untaken.join(', ') || 'none'}`);
    }
    lines.push('');
  }
  if (ctx.seeds.length) {
    lines.push('AUDIENCE QUESTIONS (comment seed id · question · comments · posts):');
    for (const s of ctx.seeds) lines.push(`- seed=${s.id} · "${s.label}" · ${s.comments} comments · ${s.posts} posts`);
    lines.push('');
  }
  if (prior.titles.length) lines.push(`ALREADY PROPOSED THIS BATCH (do not repeat or rephrase): ${prior.titles.join('; ')}`);
  if (prior.cells.length) {
    const counts = new Map<string, number>();
    for (const c of prior.cells) counts.set(c, (counts.get(c) ?? 0) + 1);
    lines.push(`HOOK CELLS ALREADY USED THIS BATCH: ${[...counts.entries()].map(([c, n]) => `${c} x${n}`).join(', ')}`);
  }
  if (prior.titles.length || prior.cells.length) lines.push('');
  lines.push(
    `Round ${round} of ${VS_ROUNDS}. Generate ${VS_PER_ROUND} ideas with their probabilities, sampled from the full range of ideas this creator could make from the material above, not only the most typical ones. The probability is how likely a typical assistant would be to suggest that idea (0 to 1). At least ${VS_TAIL_MIN_PER_ROUND} of the ${VS_PER_ROUND} must have probability below ${VS_TAIL_P.toFixed(2)}: unusual, still grounded in the listed posts or events.`,
    'Each idea uses one cluster OR one event, a specific angle, an angleClass, a hookForm and trigger from the lists, an optional tension, a formatFamily from the creator\'s formats, and 2 to 3 evidence posts (for an event idea, 0 to 3).',
    `angleClass is one of: ${Object.keys(ANGLE_LABEL).join(', ')}.`,
    ANTI_INVENTION_V2,
    'No dashes of any kind. Plain words.',
    'Reply with STRICT JSON only: {"candidates":[{"title":"","clusterId":null,"eventId":null,"seedId":null,"angle":"","angleClass":"first_look","hookForm":"results_first","trigger":"curiosity","tension":{"falseBelief":"","reframe":""},"formatFamily":"","evidence":[{"postId":"","why":""}],"probability":0.2}]}',
  );
  return lines.join('\n');
}

/* ── dry candidates ───────────────────────────────────────────────────── */

const FALLBACK_CELLS: { form: LabHookForm; trigger: LabTrigger }[] = [
  { form: 'results_first', trigger: 'curiosity' },
  { form: 'contrarian', trigger: 'controversy' },
  { form: 'open_loop', trigger: 'curiosity' },
  { form: 'howto_promise', trigger: 'aspiration' },
  { form: 'number_stat', trigger: 'surprise_shock' },
];

/** One title shape per hook cell, so a dry batch has spread to choose from. */
const DRY_TITLES: ((label: string, angle: string) => string)[] = [
  (l, a) => `${l}: ${a}`,
  (l, a) => `I tested ${a} so you do not have to (${l.toLowerCase()})`,
  (l, a) => `The ${l.toLowerCase()} mistake everyone makes with ${a}`,
];

/** 7.3.8 dry: v1 dryIdeas crossed with each cluster's open angles and the top 3 hook cells, 24 in all. */
export function dryCandidates(store: LabStore, ctx: VsContext): VsCandidate[] {
  const base = dryIdeas(ctx.idea);
  const out: VsCandidate[] = [];
  for (const c of ctx.idea.clusters) {
    const seed = base.find((b) => b.clusterId === c.id);
    const ev = c.posts.slice(0, 3);
    if (ev.length < 2) continue;
    const family = seed?.formatFamily ?? ctx.idea.families[0] ?? 'other';
    const recs = hookRecs(store, family).map((h) => ({ form: h.form, trigger: h.trigger }));
    const cells = [...recs, ...FALLBACK_CELLS].filter((x, i, a) => a.findIndex((y) => y.form === x.form && y.trigger === x.trigger) === i).slice(0, 3);
    const angles = c.angles.filter((a) => !a.exhausted);
    for (const a of angles.length ? angles : c.angles) {
      for (const [k, cell] of cells.entries()) {
        out.push({
          title: DRY_TITLES[k % DRY_TITLES.length](c.label, a.angle).slice(0, 90),
          clusterId: c.id,
          eventId: null,
          seedId: null,
          angle: a.angle,
          angleClass: 'other',
          hookForm: cell.form,
          trigger: cell.trigger,
          tension: seed?.tension ?? null,
          formatFamily: family,
          evidence: ev.map((p) => ({ postId: p.postId, why: `${fmtRatio(p.breakout)} its creator's normal on "${p.angle}"` })),
          probability: 0,
        });
      }
    }
  }
  for (const e of ctx.events) {
    for (const angle of e.untaken.slice(0, 3)) {
      out.push({ title: `${e.name}: ${ANGLE_LABEL[angle as LaunchAngle] ?? angle}`.slice(0, 90), clusterId: null, eventId: e.id, seedId: null, angle: (ANGLE_LABEL[angle as LaunchAngle] ?? angle).toLowerCase(), angleClass: angle as LaunchAngle, hookForm: 'news_react', trigger: 'curiosity', tension: null, formatFamily: ctx.idea.families[0] ?? 'other', evidence: [], probability: 0 });
    }
  }
  return out.slice(0, VS_ROUNDS * VS_PER_ROUND).map((c, rank) => ({ ...c, probability: Math.round((1 / (rank + 1)) * 1000) / 1000 }));
}

/* ── grounding, exhaustion ────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export type Grounded = VsCandidate & { untaken: boolean };

/** 7.3.4 grounding table: unknown ids drop the candidate; an unknown seed is stripped, not the idea. */
export function groundCandidates(cands: readonly VsCandidate[], ctx: Pick<VsContext, 'knownEvents' | 'knownSeeds'> & { idea: Pick<IdeaContext, 'knownPosts' | 'knownClusters' | 'families'> }): { kept: VsCandidate[]; dropped: { title: string; reason: string }[] } {
  const kept: VsCandidate[] = [];
  const dropped: { title: string; reason: string }[] = [];
  for (const c of cands) {
    if (c.clusterId && !ctx.idea.knownClusters.has(c.clusterId)) {
      dropped.push({ title: c.title, reason: `unknown cluster ${c.clusterId}` });
      continue;
    }
    if (c.eventId && !ctx.knownEvents.has(c.eventId)) {
      dropped.push({ title: c.title, reason: `unknown event ${c.eventId}` });
      continue;
    }
    const unknown = c.evidence.filter((e) => !ctx.idea.knownPosts.has(e.postId)).map((e) => e.postId);
    if (unknown.length) {
      dropped.push({ title: c.title, reason: `cites unknown post${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}` });
      continue;
    }
    const evidence = [...new Map(c.evidence.map((e) => [e.postId, e])).values()].slice(0, 3);
    if (c.clusterId && evidence.length < 2) {
      dropped.push({ title: c.title, reason: 'fewer than two evidence posts' });
      continue;
    }
    const fam = LabFormatSchema.safeParse(c.formatFamily).success && (ctx.idea.families.length === 0 || ctx.idea.families.includes(c.formatFamily)) ? c.formatFamily : (ctx.idea.families[0] ?? c.formatFamily);
    kept.push({ ...c, evidence, formatFamily: fam, seedId: c.seedId && ctx.knownSeeds.has(c.seedId) ? c.seedId : null });
  }
  return { kept, dropped };
}

/* ── MMR with quotas (pure) ───────────────────────────────────────────── */

export type MmrItem = { id: string; rel: number; vsProbability: number; title: string; hookCell: string; hookForm: string; topic: string; untaken: boolean };

function softCounts(sel: readonly MmrItem[]) {
  return { minHookForms: new Set(sel.map((s) => s.hookForm)).size, minUntakenAngles: sel.filter((s) => s.untaken).length, minTail: sel.filter((s) => s.vsProbability < VS_TAIL_P).length };
}

/** Does `c` add to quota q given the selection? */
function reduces(q: SoftQuota, c: MmrItem, sel: readonly MmrItem[]): boolean {
  if (q === 'minHookForms') return !sel.some((s) => s.hookForm === c.hookForm);
  if (q === 'minUntakenAngles') return c.untaken;
  return c.vsProbability < VS_TAIL_P;
}

/**
 * Greedy MMR (7.3.5): pick argmax of lambda * rel - (1 - lambda) * max cos to the selection,
 * after removing candidates that break a hard cap; when the soft deficits the pool can still
 * supply fill the remaining slots, only candidates that reduce one are eligible. Ties: higher
 * rel, then lower vsProbability, then title.
 */
export function mmrSelect(pool: readonly MmrItem[], cos: (a: MmrItem, b: MmrItem) => number, opts: { k?: number; lambda?: number; quotas?: Partial<Record<keyof typeof QUOTAS, number>> } = {}): { selected: MmrItem[]; unmet: SoftQuota[] } {
  const k = opts.k ?? BATCH_K;
  const lambda = opts.lambda ?? MMR_LAMBDA;
  const q: Record<keyof typeof QUOTAS, number> = { ...QUOTAS, ...(opts.quotas ?? {}) };
  const sel: MmrItem[] = [];
  let rest = [...pool];
  const soft: SoftQuota[] = ['minHookForms', 'minUntakenAngles', 'minTail'];
  while (sel.length < k && rest.length) {
    let cand = rest.filter((c) => sel.filter((s) => s.hookCell === c.hookCell).length < q.maxPerHookCell && sel.filter((s) => s.topic === c.topic).length < q.maxPerTopic);
    if (!cand.length) break;
    const counts = softCounts(sel);
    const deficits = soft.map((name) => {
      const raw = Math.max(0, q[name] - counts[name]);
      const supply = name === 'minHookForms' ? new Set(cand.filter((c) => reduces(name, c, sel)).map((c) => c.hookForm)).size : cand.filter((c) => reduces(name, c, sel)).length;
      return { name, d: Math.min(raw, supply) };
    });
    if (deficits.reduce((a, x) => a + x.d, 0) >= k - sel.length) {
      const narrowed = cand.filter((c) => deficits.some((x) => x.d > 0 && reduces(x.name, c, sel)));
      if (narrowed.length) cand = narrowed;
    }
    const scored = cand.map((c) => ({ c, s: lambda * c.rel - (1 - lambda) * (sel.length ? Math.max(...sel.map((x) => cos(c, x))) : 0) }));
    scored.sort((a, b) => b.s - a.s || b.c.rel - a.c.rel || a.c.vsProbability - b.c.vsProbability || a.c.title.localeCompare(b.c.title));
    const pick = scored[0].c;
    sel.push(pick);
    rest = rest.filter((c) => c !== pick);
  }
  const final = softCounts(sel);
  return { selected: sel, unmet: soft.filter((name) => final[name] < q[name]) };
}

/* ── the batch ────────────────────────────────────────────────────────── */

export type GenerateBatchResult = { added: LabIdea[]; outcome: BatchOutcome; by: 'claude' | 'dry'; runIds: string[]; untakenKept: number; line: string };

export class GenerateError extends Error {
  constructor(message: string, public unavailable: boolean, public outcome: BatchOutcome) {
    super(message);
    this.name = 'GenerateError';
  }
}

/**
 * Press Generate (7.3.2). Throws GenerateError when every round failed (unavailable = the CLI
 * is missing, for the 503) and CapError from the gate.
 */
export async function generateBatch(store: LabStore, opts: { now?: Date; ask?: VsAsk; override?: boolean; scheduled?: boolean; embedder?: Embedder } = {}): Promise<GenerateBatchResult> {
  const now = opts.now ?? new Date();
  const ctx = vsContext(store, now);
  const batchId = `gbat-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const ask: VsAsk = opts.ask ?? ((p) => claudeJson(p, VsReplySchema, { timeoutMs: VS_TIMEOUT_MS }));
  const dry = isDry();
  const dryPool = dry ? dryCandidates(store, ctx) : [];
  const rounds: BatchOutcome['rounds'] = [];
  const raw: VsCandidate[] = [];
  const runIds: string[] = [];
  let unavailable = false;
  let lastError: string | null = null;
  for (let round = 1; round <= VS_ROUNDS; round++) {
    const prior = { titles: raw.map((c) => c.title), cells: raw.map((c) => `${c.hookForm}+${c.trigger}`) };
    try {
      const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'ideas', actor: 'claude-cli', input: { promptVersion: IDEAS_PROMPT_VERSION, round, batchId }, override: opts.override, scheduled: opts.scheduled, now }, {
        dry: () => ({ result: dryPool.slice((round - 1) * VS_PER_ROUND, round * VS_PER_ROUND), items: VS_PER_ROUND }),
        live: async () => {
          const res = await ask(vsPrompt(ctx, round, prior));
          if (!res.ok) {
            if (res.unavailable) unavailable = true;
            throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `round ${round} failed: ${res.error}`);
          }
          const parsed = VsReplySchema.safeParse(res.data);
          if (!parsed.success) throw new Error(`round ${round} reply did not validate: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
          return { result: parsed.data.candidates, units: 1, actualUsd: 0, items: parsed.data.candidates.length };
        },
      });
      runIds.push(out.run.id);
      raw.push(...out.result);
      rounds.push({ round, ok: true, candidates: out.result.length, error: null });
    } catch (e) {
      if (e instanceof Error && e.name === 'CapError') throw e;
      lastError = e instanceof Error ? e.message : String(e);
      rounds.push({ round, ok: false, candidates: 0, error: lastError });
      const failed = store.runs.recent(5).find((r) => r.kind === 'ideas' && (r.input as { batchId?: string } | null)?.batchId === batchId && r.status === 'failed' && !runIds.includes(r.id));
      if (failed) runIds.push(failed.id);
    }
  }
  const embedder = opts.embedder ?? activeEmbedder({ store });
  const outcome: BatchOutcome = { batchId, candidates: raw.length, grounded: 0, dropped: [], exhausted: 0, duplicates: 0, kept: 0, unmetQuotas: [], meanPairwiseCos: null, embedModel: embedder.model, rounds };
  const save = () => {
    if (runIds[0]) {
      const r = store.runs.get(runIds[0]);
      if (r) store.runs.update(r.id, { input: { ...((r.input as Record<string, unknown>) ?? {}), outcome } });
    }
  };
  if (!rounds.some((r) => r.ok)) {
    save();
    throw new GenerateError(unavailable ? 'the claude CLI is not on this host' : `idea generation failed: ${lastError ?? 'no round succeeded'}`, unavailable, outcome);
  }

  // 1. grounding
  const { kept: grounded, dropped } = groundCandidates(raw, ctx);
  outcome.dropped = dropped;
  outcome.grounded = grounded.length;

  // 2. worn-out angles
  const clusterStats = new Map<string, ReturnType<typeof angleStats>>();
  const statsFor = (id: string) => {
    if (!clusterStats.has(id)) clusterStats.set(id, angleStats(clusterAngleRows(store, id, { now, windowDays: 42 })));
    return clusterStats.get(id)!;
  };
  const eventStats = new Map(ctx.events.map((e) => [e.id, e]));
  const live: Grounded[] = [];
  for (const c of grounded) {
    if (c.clusterId) {
      const stats = statsFor(c.clusterId);
      const hit = stats.find((s) => norm(s.angle) === norm(c.angle));
      if (hit?.exhausted) {
        outcome.exhausted++;
        continue;
      }
      live.push({ ...c, untaken: !hit || hit.posts === 0 });
    } else {
      const e = eventStats.get(c.eventId!) ?? null;
      const stats = e ? null : eventAngleStats(store, c.eventId!);
      const taken = e ? e.taken.find((t) => t.angle === c.angleClass) : (() => {
        const s = stats!.find((x) => x.angle === c.angleClass && x.taken);
        return s ? { angle: s.angle, lift: s.median, n: s.n } : undefined;
      })();
      if (taken && taken.lift !== null && taken.lift < 1) {
        outcome.exhausted++;
        continue;
      }
      live.push({ ...c, untaken: c.angleClass !== 'other' && !taken });
    }
  }

  // 3. embed and dedupe (against kept candidates and ideas from the last 30 days)
  const texts = live.map((c) => ideaText({ title: c.title, angle: c.angle, hookForm: c.hookForm, hookTrigger: c.trigger }));
  let vecs = await embedTexts(store, texts, embedder, { override: opts.override, now, purpose: 'generate' });
  let model = embedder.model;
  if (vecs.some((v) => v === null) && embedder.paid) {
    vecs = (await localEmbedder.embed(texts)).vecs;
    model = localEmbedder.model;
  }
  outcome.embedModel = model;
  const threshold = DEDUPE_COSINE[model] ?? DEDUPE_COSINE['local-hash-v1'];
  const since = now.getTime() - DEDUPE_LOOKBACK_DAYS * 86_400_000;
  const recent: Float32Array[] = [];
  for (const i of store.ideas.all()) {
    if (!(Date.parse(i.createdAt) >= since)) continue;
    const row = store.embeddings.get('idea', i.id, model);
    const v = row?.vec ?? (model === localEmbedder.model ? (await localEmbedder.embed([ideaText(i)])).vecs[0] : null);
    if (v) recent.push(v);
  }
  const unique: { c: Grounded; v: Float32Array }[] = [];
  for (let k = 0; k < live.length; k++) {
    const v = vecs[k];
    if (!v) continue;
    if (recent.some((r) => cosine(v, r) >= threshold) || unique.some((u) => cosine(v, u.v) >= threshold)) {
      outcome.duplicates++;
      continue;
    }
    unique.push({ c: live[k], v });
  }

  // 4. enrich (v1 fit, hookRecs, strand, timing, thin) and relevance
  const enriched = unique.map(({ c, v }, k) => {
    const rawIdea: RawIdea = { title: c.title, clusterId: c.clusterId ?? (c.eventId ? (eventStats.get(c.eventId)?.clusterId ?? '') : ''), angle: c.angle, tension: c.tension, formatFamily: c.formatFamily, evidence: c.evidence };
    const idea = enrichIdea(store, rawIdea, ctx.idea, { createdAt: now.toISOString() });
    if (c.eventId) {
      const e = eventStats.get(c.eventId);
      idea.clusterId = e?.clusterId ?? (c.clusterId || null);
      idea.timing = e ? e.windowState : idea.timing;
    }
    const rel = Math.min(1, idea.fit + 0.05 * (c.untaken ? 1 : 0));
    const item: MmrItem = { id: `c${k}`, rel, vsProbability: c.probability, title: c.title, hookCell: `${c.hookForm}|${c.trigger}`, hookForm: c.hookForm, topic: c.clusterId ?? `event:${c.eventId}`, untaken: c.untaken };
    return { c, v, idea, item };
  });

  // 5. MMR with quotas, within the open room
  const room = Math.max(0, OPEN_CAP - store.ideas.all('open').length);
  const byId = new Map(enriched.map((e) => [e.item.id, e]));
  const { selected, unmet } = mmrSelect(enriched.map((e) => e.item), (a, b) => cosine(byId.get(a.id)!.v, byId.get(b.id)!.v), { k: Math.min(BATCH_K, room) });
  outcome.unmetQuotas = unmet;

  // 6. insert
  const added: LabIdea[] = [];
  const gpool = groundingPool(store, now);
  store.transaction(() => {
    selected.forEach((item, rank) => {
      const e = byId.get(item.id)!;
      const grounding = retrieveGrounding(store, { query: `${e.c.title} ${e.c.angle}`, formatFamily: e.c.formatFamily, angle: e.c.angleClass === 'other' ? null : e.c.angleClass, now, pool: gpool });
      const idea: LabIdea = {
        ...e.idea,
        source: 'generate',
        batchId,
        seedId: e.c.seedId,
        eventId: e.c.eventId,
        launchAngle: e.c.angleClass,
        hookForm: e.c.hookForm,
        hookTrigger: e.c.trigger,
        vsProbability: Math.min(1, Math.max(0, e.c.probability)),
        mmrRank: rank + 1,
        grounding,
        promptVersion: dry ? 'dry' : IDEAS_PROMPT_VERSION,
        notes: null,
      };
      store.ideas.upsert(idea);
      store.embeddings.upsert({ subjectKind: 'idea', subjectId: idea.id, model, dim: e.v.length, textHash: textHash(ideaText(idea)), vec: e.v, createdAt: now.toISOString() });
      added.push(idea);
    });
  });
  outcome.kept = added.length;
  const mpc = meanPairwiseCos(selected.map((x) => byId.get(x.id)!.v));
  outcome.meanPairwiseCos = mpc === null ? null : Math.round(mpc * 1000) / 1000;
  save();
  const untakenKept = selected.filter((x) => x.untaken).length;
  return { added, outcome, by: dry ? 'dry' : 'claude', runIds, untakenKept, line: doneLine(outcome, untakenKept) };
}

/** 7.3.8 Done line; `untakenKept` = kept ideas on an untaken angle. */
export function doneLine(o: BatchOutcome, untakenKept: number): string {
  const base = `Kept ${o.kept} of ${o.candidates}. ${o.duplicates} repeats and ${o.exhausted} worn-out angles dropped.`;
  return o.unmetQuotas.includes('minUntakenAngles') ? `${base} Only ${untakenKept} untaken angles were available.` : base;
}
