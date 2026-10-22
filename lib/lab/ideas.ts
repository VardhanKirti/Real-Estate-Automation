import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { LabFormat, LabHookForm, LabHookRec, LabIdea, LabTiming, LabTrigger } from '@/lib/schemas';
import { LabFormatSchema } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { gatedCall } from '@/lib/lab/spend';
import { FORMAT_LABEL } from '@/lib/lab/distill';
import { computeDna, type Dna } from '@/lib/lab/dna';
import { angleStats, clusterAngleRows, coverage, latestSnapshots, type AngleStat } from '@/lib/lab/trends';
import { fmtRatio } from '@/lib/lab/measures';
import type { WizardOpenDetail } from '@/lib/wizard-dock';

/**
 * Ideas (SPEC §4.11). Generated after each sync and on demand, at most 10 open. Grounded
 * the way lib/creative-engine/angles.ts grounds angles: the model sees only real clusters
 * and real competitor posts by id and must cite them; an idea that cites ANY id that is
 * not in the store is dropped, not repaired, and one left with fewer than two evidence
 * posts is dropped too (AC4). Everything numeric on the card is computed here, never
 * asked of the model: hook recommendations with n, the strand, timing, fit and `thin`.
 *
 * The LLM call goes through the spend gate (provider `llm`, the local `claude` CLI, so
 * the ledger records 0); dry (LAB_DRY=1 or Filming) builds deterministic ideas from the
 * same grounded context without a model. `ask` is injectable for tests.
 */

/** v2 (07 7.1): all open ideas; a Generate batch adds up to 10 (Generate is disabled at 30). */
export const OPEN_CAP = 30;
/** The sync-time path still stops at 10 open sync ideas. */
export const SYNC_OPEN_CAP = 10;
/** Open ideas the sync-time path made (source 'sync'; v1 rows read as sync). */
export const openSyncIdeas = (store: LabStore): number => store.ideas.all('open').filter((i) => (i.source ?? 'sync') === 'sync').length;
export const MAX_EVIDENCE = 3;
export const IDEA_PROMPT_VERSION = 'ideas-v1';

export const LAB_ANTI_INVENTION =
  'Cite ONLY cluster ids and post ids that appear in the lists above. An idea that cites any other id is thrown away. Never invent a number, a creator, a result or a statistic: every figure you mention must be one printed above.';

const IdeaReplySchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().min(3).max(90),
        clusterId: z.string().min(1),
        angle: z.string().min(2).max(120),
        tension: z.object({ falseBelief: z.string().min(2).max(160), reframe: z.string().min(2).max(160) }).nullable().default(null),
        formatFamily: z.string().min(1),
        evidence: z.array(z.object({ postId: z.string().min(1), why: z.string().max(200).default('') })).min(1).max(6),
      }),
    )
    .min(1)
    .max(8),
});
export type RawIdea = z.infer<typeof IdeaReplySchema>['ideas'][number];
export type Ask = (prompt: string) => Promise<ClaudeJson<z.infer<typeof IdeaReplySchema>>>;

/* ── grounded context ─────────────────────────────────────────────────── */

export type EvidencePost = { postId: string; handle: string; platform: string; format: string; breakout: number; isBreakout: boolean; hookForm: string; hookText: string; angle: string; pillar: string };
export type ClusterBrief = { id: string; label: string; timing: LabTiming | null; momentum: number | null; creators: number; angles: AngleStat[]; posts: EvidencePost[]; covered: boolean; coveredBeat: boolean | null };
export type IdeaContext = { now: Date; clusters: ClusterBrief[]; dna: Dna; families: string[]; knownPosts: Set<string>; knownClusters: Set<string>; postInfo: Map<string, EvidencePost> };

const TIMING_RANK: Record<string, number> = { early: 0, open: 1, closing: 2, closed: 3 };

export function ideaContext(store: LabStore, opts: { now?: Date; maxClusters?: number } = {}): IdeaContext {
  const now = opts.now ?? new Date();
  const dna = computeDna(store, { now });
  const posts = new Map(store.posts.all().map((p) => [p.id, p]));
  const sources = new Map(store.sources.all().map((s) => [s.id, s]));
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  const dis = new Map(store.dissections.all().map((d) => [d.postId, d]));
  const snaps = latestSnapshots(store);
  const knownPosts = new Set([...posts.values()].filter((p) => !p.isOwned).map((p) => p.id));
  const postInfo = new Map<string, EvidencePost>();
  const clusters: ClusterBrief[] = [];
  for (const c of store.clusters.all()) {
    const s = snaps.get(c.id);
    const rows = clusterAngleRows(store, c.id, { now, windowDays: 42 });
    const evidence = rows
      .map((r) => {
        const p = posts.get(r.postId)!;
        const d = dis.get(r.postId);
        const e: EvidencePost = { postId: r.postId, handle: sources.get(p.sourceId)?.handle ?? '', platform: p.platform, format: d?.format ?? 'other', breakout: Math.round((ms.get(r.postId)?.breakout ?? 0) * 10) / 10, isBreakout: r.isBreakout, hookForm: d?.hookForm ?? 'other', hookText: d?.hookText ?? '', angle: r.angle, pillar: d?.pillar ?? 'educational' };
        postInfo.set(r.postId, e);
        return e;
      })
      .sort((a, b) => Number(b.isBreakout) - Number(a.isBreakout) || b.breakout - a.breakout)
      .slice(0, 6);
    const cov = coverage(store, c.id);
    clusters.push({ id: c.id, label: c.label, timing: s?.timing ?? null, momentum: s?.momentum ?? null, creators: s?.creators ?? 0, angles: angleStats(rows).slice(0, 6), posts: evidence, covered: cov.covered, coveredBeat: cov.beatBaseline });
  }
  // every competitor post can be cited (not just the ones shown); fill info lazily for those
  for (const id of knownPosts) {
    if (postInfo.has(id)) continue;
    const p = posts.get(id)!;
    const d = dis.get(id);
    postInfo.set(id, { postId: id, handle: sources.get(p.sourceId)?.handle ?? '', platform: p.platform, format: d?.format ?? 'other', breakout: Math.round((ms.get(id)?.breakout ?? 0) * 10) / 10, isBreakout: ms.get(id)?.isBreakout ?? false, hookForm: d?.hookForm ?? 'other', hookText: d?.hookText ?? '', angle: '', pillar: d?.pillar ?? 'educational' });
  }
  const ranked = clusters
    .filter((c) => c.posts.length >= 2 && c.timing !== 'closed')
    .sort((a, b) => (TIMING_RANK[a.timing ?? 'closed'] ?? 4) - (TIMING_RANK[b.timing ?? 'closed'] ?? 4) || (b.momentum ?? 0) - (a.momentum ?? 0))
    .slice(0, opts.maxClusters ?? 6);
  const families = dna.families.length ? dna.families : [...new Set(store.profiles.latest().map((p) => p.formatFamily))];
  return { now, clusters: ranked, dna, families, knownPosts, knownClusters: new Set(store.clusters.all().map((c) => c.id)), postInfo };
}

export function ideaPrompt(ctx: IdeaContext, existing: readonly LabIdea[]): string {
  const lines: string[] = [
    'You propose short-form video IDEAS for a creator in the AI space, grounded ONLY in the clusters and posts listed below (real scraped data, measured against each creator\'s own normal).',
    `The creator's formats: ${ctx.families.map((f) => `${f} (${(FORMAT_LABEL as Record<string, string>)[f] ?? f})`).join(', ') || 'unknown'}.`,
    ctx.dna.contrast ? `Their own data: ${ctx.dna.contrast.text}.` : '',
    '',
    'CLUSTERS (topic id · timing · momentum · creators · coverage):',
  ];
  for (const c of ctx.clusters) {
    lines.push(`- cluster=${c.id} · ${c.label} · ${c.timing ?? 'unknown'} · momentum ${c.momentum === null ? 'n/a' : fmtRatio(c.momentum)} · ${c.creators} creators · ${c.covered ? (c.coveredBeat ? 'you covered it and beat your normal' : 'you covered it, below your normal') : 'you have not covered it'}`);
    const exhausted = c.angles.filter((a) => a.exhausted).map((a) => `"${a.angle}" (${a.posts} posts, none broke out)`);
    const open = c.angles.filter((a) => !a.exhausted).map((a) => `"${a.angle}" (${a.posts} posts, best ${a.best === null ? 'n/a' : fmtRatio(a.best)})`);
    if (open.length) lines.push(`  angles that worked or are open: ${open.join('; ')}`);
    if (exhausted.length) lines.push(`  exhausted angles (avoid): ${exhausted.join('; ')}`);
    for (const p of c.posts) lines.push(`  - post=${p.postId} · @${p.handle} · ${p.platform} · ${p.format} · ${fmtRatio(p.breakout)} their normal · ${p.hookForm} hook: "${p.hookText.slice(0, 120)}"`);
  }
  if (existing.length) {
    lines.push('', 'ALREADY IN THE QUEUE OR DISMISSED (do not repeat these angles):');
    for (const i of existing.slice(0, 20)) lines.push(`- ${i.title}${i.status === 'dismissed' && i.dismissReason ? ` (dismissed: ${i.dismissReason})` : ''}`);
  }
  lines.push(
    '',
    LAB_ANTI_INVENTION,
    'Propose 3-6 ideas. Each idea: one cluster, a specific ANGLE (the take that makes the topic usable, preferably uncrowded: not an exhausted angle), an optional tension {falseBelief, reframe}, a formatFamily from the creator\'s formats, and 2-3 evidence posts from THAT cluster with a short "why" each.',
    'No dashes of any kind in the text. Plain words.',
    'Reply with STRICT JSON only: {"ideas":[{"title":"","clusterId":"","angle":"","tension":{"falseBelief":"","reframe":""}|null,"formatFamily":"","evidence":[{"postId":"","why":""}]}]}. No markdown.',
  );
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/* ── grounding (pure) ─────────────────────────────────────────────────── */

export type Dropped = { title: string; reason: string };

/**
 * The anti-invention check. Drops an idea when it names an unknown cluster, cites ANY
 * post id that is not a known competitor post (including your own posts, which are never
 * evidence), or ends up with fewer than two distinct evidence posts. Unknown format
 * families are not ids: they fall back to the creator's main family.
 */
export function groundIdeas(raw: readonly RawIdea[], ctx: Pick<IdeaContext, 'knownPosts' | 'knownClusters' | 'families'>): { kept: RawIdea[]; dropped: Dropped[] } {
  const kept: RawIdea[] = [];
  const dropped: Dropped[] = [];
  for (const r of raw) {
    if (!ctx.knownClusters.has(r.clusterId)) {
      dropped.push({ title: r.title, reason: `unknown cluster ${r.clusterId}` });
      continue;
    }
    const unknown = r.evidence.filter((e) => !ctx.knownPosts.has(e.postId)).map((e) => e.postId);
    if (unknown.length) {
      dropped.push({ title: r.title, reason: `cites unknown post${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}` });
      continue;
    }
    const evidence = [...new Map(r.evidence.map((e) => [e.postId, e])).values()].slice(0, MAX_EVIDENCE);
    if (evidence.length < 2) {
      dropped.push({ title: r.title, reason: 'fewer than two evidence posts' });
      continue;
    }
    const family = LabFormatSchema.safeParse(r.formatFamily).success && (ctx.families.length === 0 || ctx.families.includes(r.formatFamily)) ? r.formatFamily : (ctx.families[0] ?? r.formatFamily);
    kept.push({ ...r, evidence, formatFamily: family });
  }
  return { kept, dropped };
}

/* ── fit, recommendations, enrichment (pure over the store) ───────────── */

const TIMING_FIT: Record<string, number> = { early: 1, open: 0.85, closing: 0.35, closed: 0 };

export type FitInput = { familyShare: number; maxFamilyShare: number; pillarOverlap: number; covered: boolean; coveredBeat: boolean | null; timing: LabTiming | null; penalty: number };

/**
 * fit (0-1) = 0.35 format fit (your share of the family relative to your main family)
 *           + 0.25 topic fit (share of your posts in the evidence posts' pillar)
 *           + 0.15 coverage (not covered 1, covered below your normal 0.6, covered and beat it 0.4)
 *           + 0.25 timing (early 1, open 0.85, closing 0.35, closed 0, unknown 0.5)
 *           - dismissal penalty (reasons feed ranking)
 */
export function fitScore(f: FitInput): number {
  const format = f.maxFamilyShare > 0 ? Math.min(1, f.familyShare / f.maxFamilyShare) : 0;
  const cov = !f.covered ? 1 : f.coveredBeat ? 0.4 : 0.6;
  const timing = f.timing ? TIMING_FIT[f.timing] : 0.5;
  const raw = 0.35 * format + 0.25 * Math.min(1, Math.max(0, f.pillarOverlap)) + 0.15 * cov + 0.25 * timing - f.penalty;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
}

/** Dismissal reasons feed ranking: each dismissed idea in the same cluster costs 0.08, a "not my format" reason on the same family 0.12, a "too late" reason on the cluster 0.1 (capped at 0.4). */
export function dismissPenalty(dismissed: readonly Pick<LabIdea, 'clusterId' | 'formatFamily' | 'dismissReason'>[], clusterId: string | null, family: string): number {
  let p = 0;
  for (const d of dismissed) {
    const reason = (d.dismissReason ?? '').toLowerCase();
    if (d.clusterId && d.clusterId === clusterId) p += 0.08 + (/clos|late|old|done|saturat|tired/.test(reason) ? 0.1 : 0);
    if (d.formatFamily === family && /format|not my|don'?t make|style/.test(reason)) p += 0.12;
  }
  return Math.min(0.4, Math.round(p * 100) / 100);
}

/** The top hook form × trigger cells among the family's competitor breakouts, with n and the profile's lift for the form. */
export function hookRecs(store: LabStore, family: string, limit = 3): LabHookRec[] {
  const ms = new Map(store.measures.all().map((m) => [m.postId, m]));
  const own = new Set(store.posts.all().filter((p) => p.isOwned).map((p) => p.id));
  const cells = new Map<string, number>();
  for (const d of store.dissections.all()) {
    if (d.format !== family || own.has(d.postId) || !ms.get(d.postId)?.isBreakout || d.ctaType === 'comment_keyword') continue;
    const k = `${d.hookForm}|${d.emotionalTrigger}`;
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  const prof = store.profiles.latest().find((p) => p.formatFamily === family);
  return [...cells.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([k, n]) => {
      const [form, trigger] = k.split('|') as [LabHookForm, LabTrigger];
      const f = prof?.features.find((x) => x.feature === 'hook_form' && x.value === form);
      return { form, trigger, n, lift: f?.lift ?? null };
    });
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function enrichIdea(store: LabStore, r: RawIdea, ctx: IdeaContext, opts: { id?: string; createdAt?: string } = {}): LabIdea {
  const brief = ctx.clusters.find((c) => c.id === r.clusterId);
  const snap = latestSnapshots(store).get(r.clusterId);
  const cov = brief ? { covered: brief.covered, beatBaseline: brief.coveredBeat } : coverage(store, r.clusterId);
  const mix = ctx.dna.mix;
  const maxShare = Math.max(0, ...mix.map((m) => m.share));
  const familyShare = mix.find((m) => m.family === r.formatFamily)?.share ?? 0;
  const pillars = r.evidence.map((e) => ctx.postInfo.get(e.postId)?.pillar).filter(Boolean) as string[];
  const topPillar = pillars.sort((a, b) => pillars.filter((x) => x === b).length - pillars.filter((x) => x === a).length)[0];
  const ownDis = store.dissections.all().filter((d) => store.posts.get(d.postId)?.isOwned);
  const pillarOverlap = ownDis.length && topPillar ? ownDis.filter((d) => d.pillar === topPillar).length / ownDis.length : 0;
  const dismissed = store.ideas.all('dismissed');
  const timing = snap?.timing ?? null;
  const evidenceBreakouts = r.evidence.filter((e) => ctx.postInfo.get(e.postId)?.isBreakout).length;
  const recs = hookRecs(store, r.formatFamily);
  const prof = store.profiles.latest().find((p) => p.formatFamily === r.formatFamily);
  return {
    id: opts.id ?? `idea-${randomUUID().slice(0, 8)}`,
    title: r.title.replace(/\s+/g, ' ').trim(),
    clusterId: r.clusterId,
    angle: r.angle.trim(),
    tension: r.tension,
    formatFamily: r.formatFamily,
    strand: prof?.strand ?? [],
    hookRecs: recs,
    evidence: r.evidence.map((e) => {
      const info = ctx.postInfo.get(e.postId);
      return { postId: e.postId, why: e.why.trim() || (info ? `${fmtRatio(info.breakout)} its creator's normal, ${info.hookForm.replaceAll('_', ' ')} hook` : '') };
    }),
    timing,
    fit: fitScore({ familyShare, maxFamilyShare: maxShare, pillarOverlap, covered: cov.covered, coveredBeat: cov.beatBaseline, timing, penalty: dismissPenalty(dismissed, r.clusterId, r.formatFamily) }),
    // thin: the idea stands on fewer than two real breakouts, or the family's hook cells are under n 5
    thin: evidenceBreakouts < 2 || recs.reduce((a, h) => a + h.n, 0) < 5,
    status: 'open',
    dismissReason: null,
    createdAt: opts.createdAt ?? ctx.now.toISOString(),
    actedOnAt: null,
  };
}

/** Deterministic ideas for dry runs: the best uncrowded angle of each top cluster, its strongest posts as evidence. */
export function dryIdeas(ctx: IdeaContext): RawIdea[] {
  return ctx.clusters.slice(0, 4).flatMap((c) => {
    const angle = c.angles.find((a) => a.whitespace) ?? c.angles.find((a) => !a.exhausted) ?? c.angles[0];
    const ev = c.posts.slice(0, MAX_EVIDENCE);
    if (!angle || ev.length < 2) return [];
    const counts = new Map<string, number>();
    for (const p of ev) counts.set(p.format, (counts.get(p.format) ?? 0) + 1);
    const evFamily = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const family = ctx.families.includes(evFamily) ? evFamily : (ctx.families[0] ?? evFamily);
    const exhausted = c.angles.find((a) => a.exhausted);
    return [{
      title: `${c.label}: ${angle.angle}`.slice(0, 90),
      clusterId: c.id,
      angle: angle.angle,
      tension: exhausted ? { falseBelief: `Everyone already covered ${c.label.toLowerCase()} with ${exhausted.angle}`, reframe: `${angle.angle.charAt(0).toUpperCase()}${angle.angle.slice(1)} is the part that still breaks out` } : null,
      formatFamily: family,
      evidence: ev.map((p) => ({ postId: p.postId, why: `${fmtRatio(p.breakout)} its creator's normal on "${p.angle}"` })),
    }];
  });
}

export type GenerateResult = { added: LabIdea[]; dropped: Dropped[]; duplicates: number; by: 'claude' | 'dry'; runId: string; open: number };

/**
 * Generate, ground, enrich and queue ideas until SYNC_OPEN_CAP sync ideas are open. Never
 * writes an idea that failed grounding. Throws when the model is unavailable (the caller
 * shows it honestly) or CapError from the gate.
 */
export async function generateIdeas(store: LabStore, opts: { now?: Date; ask?: Ask; override?: boolean; scheduled?: boolean } = {}): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const ctx = ideaContext(store, { now });
  const existing = store.ideas.all();
  const prompt = ideaPrompt(ctx, existing);
  const ask: Ask = opts.ask ?? ((p) => claudeJson(p, IdeaReplySchema, { timeoutMs: 150_000 }));
  const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'ideas', actor: 'claude-cli', input: { promptVersion: IDEA_PROMPT_VERSION, clusters: ctx.clusters.map((c) => c.id) }, override: opts.override, scheduled: opts.scheduled, now }, {
    dry: () => ({ result: { raw: dryIdeas(ctx), by: 'dry' as 'claude' | 'dry' }, items: 0 }),
    live: async () => {
      const res = await ask(prompt);
      if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `idea generation failed: ${res.error}`);
      return { result: { raw: res.data.ideas, by: 'claude' as 'claude' | 'dry' }, units: 1, actualUsd: 0, items: res.data.ideas.length };
    },
  });
  const { kept, dropped } = groundIdeas(out.result.raw, ctx);
  const seen = new Set(existing.flatMap((i) => [`${i.clusterId}|${norm(i.angle)}`, `t|${norm(i.title)}`]));
  let duplicates = 0;
  const fresh: LabIdea[] = [];
  for (const r of kept) {
    const keys = [`${r.clusterId}|${norm(r.angle)}`, `t|${norm(r.title)}`];
    if (keys.some((k) => seen.has(k))) {
      duplicates++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    fresh.push(enrichIdea(store, r, ctx));
  }
  fresh.sort((a, b) => b.fit - a.fit);
  const room = Math.max(0, SYNC_OPEN_CAP - openSyncIdeas(store));
  const added = fresh.slice(0, room);
  store.transaction(() => {
    for (const i of added) store.ideas.upsert(i);
  });
  store.runs.update(out.run.id, { items: added.length });
  return { added, dropped, duplicates, by: out.result.by, runId: out.run.id, open: store.ideas.all('open').length };
}

/* ── hand-offs ────────────────────────────────────────────────────────── */

/** The Creative Engine's intake is a concept (3-300 chars): the idea's angle as the seed. Organic only flows one way (SPEC §3). */
export function engineConcept(idea: LabIdea, clusterLabel: string | null): { text: string; product: string; audience: string; goal: 'unset' } {
  const t = idea.tension ? ` ${idea.tension.falseBelief}? ${idea.tension.reframe}.` : '';
  const text = `${clusterLabel ? `${clusterLabel}: ` : ''}${idea.angle}.${t} (organic idea from the Content Lab)`.replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, 300), product: '', audience: '', goal: 'unset' };
}

/** What the Wizard dock gets (lib/wizard-dock openWizard): a prefill, never auto-sent. */
export function wizardPrefill(idea: LabIdea, clusterLabel: string | null): WizardOpenDetail {
  const ev = idea.evidence.length;
  const text = [
    `Content Lab idea: ${idea.title}.`,
    `Topic ${clusterLabel ?? 'unclustered'}, angle "${idea.angle}"${idea.timing ? `, timing ${idea.timing}` : ''}, fit ${idea.fit.toFixed(2)}, ${ev} evidence post${ev === 1 ? '' : 's'}${idea.thin ? ' (thin evidence)' : ''}.`,
    idea.tension ? `Tension: "${idea.tension.falseBelief}" then "${idea.tension.reframe}".` : '',
    'Is this worth making this week, and what would you change about the angle?',
  ]
    .filter(Boolean)
    .join(' ');
  return { text, broadcast: false, source: 'content-lab' };
}

export const formatOk = (f: string): f is LabFormat => LabFormatSchema.safeParse(f).success;
