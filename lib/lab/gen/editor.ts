/**
 * Script editor server behaviour (07 7.8). The controls that never call a model: set_hook,
 * set_duration, set_platform and restore_version each write exactly one new version with the
 * v1 deterministic gate and the rule pack re-run; judge_hooks orders the three hooks (no new
 * version); send_engine and ask_wizard hand off (the Wizard prefill is never sent).
 */
import type { LabGate, LabIdea, LabPlatform, LabScriptBody, LabScriptVersion } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { deterministicGate, gateWithScores } from '@/lib/lab/gate';
import { planScript } from '@/lib/lab/scripts';
import { engineConcept } from '@/lib/lab/ideas';
import { wordCount } from '@/lib/lab/measures';
import { scriptText } from '@/lib/lab/outcomes';
import type { WizardOpenDetail } from '@/lib/wizard-dock';
import { gateWithRules } from '@/lib/lab/gen/script-rules';
import { bodyV2, gateCounts, type ScriptPlatform } from '@/lib/lab/gen/rules';
import { judgeHooks, type JudgeDeps, type JudgeRecord, type JudgeVerdict } from '@/lib/lab/gen/judge';
import { activeModel, cosine, localVec, LOCAL_EMBED_MODEL } from '@/lib/lab/gen/embed';
import { familyName } from '@/lib/lab/scripts';

export const DURATION_MIN_S = 10;
export const DURATION_MAX_S = 1800;
export const PUBLISH_WINDOW_DAYS = 7;

export class EditorError extends Error {
  constructor(message: string, public status: 400 | 404 | 409) {
    super(message);
    this.name = 'EditorError';
  }
}

function current(store: LabStore, scriptId: string): { cur: LabScriptVersion; idea: LabIdea | null } {
  const script = store.scripts.get(scriptId);
  const cur = store.scripts.latestVersion(scriptId);
  if (!script || !cur) throw new EditorError('no such script', 404);
  return { cur, idea: script.ideaId ? store.ideas.get(script.ideaId) : null };
}

function bannedFor(store: LabStore, idea: LabIdea | null, durationS: number): string[] {
  if (!idea) return [];
  try {
    return planScript(store, idea.id, { durationS }).bannedWords;
  } catch {
    return [];
  }
}

/** v1 deterministic gate, the previous model scores carried (the text was scored; nothing new was asked), then the rules. */
export function regate(store: LabStore, idea: LabIdea | null, body: LabScriptBody, prev: LabGate | null): LabGate {
  const det = deterministicGate(body, { bannedWords: bannedFor(store, idea, body.durationS) });
  return gateWithRules(store, idea, body, prev?.scores ? gateWithScores(det, prev.scores) : det);
}

function addVersion(store: LabStore, scriptId: string, cur: LabScriptVersion, body: LabScriptBody, gate: LabGate, now: Date): LabScriptVersion {
  const version: LabScriptVersion = { scriptId, version: cur.version + 1, body, gate, createdAt: now.toISOString(), editDiff: null };
  store.scripts.addVersion(version);
  return version;
}

export function setHook(store: LabStore, scriptId: string, hookChoice: number, opts: { now?: Date } = {}): LabScriptVersion {
  const { cur, idea } = current(store, scriptId);
  if (!Number.isInteger(hookChoice) || hookChoice < 0 || hookChoice >= cur.body.hooks.length) throw new EditorError('no such hook', 400);
  const body: LabScriptBody = { ...cur.body, hookChoice };
  return addVersion(store, scriptId, cur, body, regate(store, idea, body, cur.gate), opts.now ?? new Date());
}

export function setDuration(store: LabStore, scriptId: string, durationS: number, opts: { now?: Date } = {}): LabScriptVersion {
  const { cur, idea } = current(store, scriptId);
  if (!Number.isFinite(durationS) || durationS < DURATION_MIN_S || durationS > DURATION_MAX_S) throw new EditorError(`durationS must be ${DURATION_MIN_S} to ${DURATION_MAX_S}`, 400);
  const body: LabScriptBody = { ...cur.body, durationS: Math.round(durationS) };
  return addVersion(store, scriptId, cur, body, regate(store, idea, body, cur.gate), opts.now ?? new Date());
}

export function setPlatform(store: LabStore, scriptId: string, platform: ScriptPlatform, opts: { now?: Date } = {}): LabScriptVersion {
  const { cur, idea } = current(store, scriptId);
  const body: LabScriptBody = { ...cur.body, platform: platform as LabPlatform | 'multi' };
  return addVersion(store, scriptId, cur, body, regate(store, idea, body, cur.gate), opts.now ?? new Date());
}

/** A new version copying an older body; history is never rewritten. */
export function restoreVersion(store: LabStore, scriptId: string, version: number, opts: { now?: Date } = {}): LabScriptVersion {
  const { cur, idea } = current(store, scriptId);
  const src = store.scripts.versions(scriptId).find((v) => v.version === version);
  if (!src) throw new EditorError('no such version', 404);
  const body: LabScriptBody = { ...src.body, hooks: src.body.hooks.map((h) => ({ ...h, words: wordCount(h.spoken) })) };
  return addVersion(store, scriptId, cur, body, regate(store, idea, body, src.gate), opts.now ?? new Date());
}

/** lab_priors key holding the last judge order for a script (no new version is written). */
export const judgeWinsKey = (scriptId: string) => `judge:wins:${scriptId}`;
export type StoredJudgeWins = { version: number; wins: number[]; order: number[]; applied: boolean; at: string };

export function storedJudgeWins(store: LabStore, scriptId: string): StoredJudgeWins | null {
  const p = store.priors.get(judgeWinsKey(scriptId));
  const v = p?.value as StoredJudgeWins | undefined;
  return v && Array.isArray(v.wins) ? v : null;
}

/** judge_hooks: the 3 hooks pairwise, both orders; sets judgeWins per hook. In state `off` the order is the generator's. */
export async function judgeScriptHooks(store: LabStore, scriptId: string, deps: JudgeDeps = {}): Promise<{ verdicts: JudgeVerdict[]; order: number[]; record: JudgeRecord; wins: number[] }> {
  const { cur, idea } = current(store, scriptId);
  const v2 = bodyV2(cur.body);
  const hooks = cur.body.hooks.map((h, i) => ({ id: `${scriptId}:v${cur.version}:h${i}`, text: h.spoken }));
  const ctx = { platform: v2.platform === 'multi' ? 'short-form platforms' : v2.platform, format: idea ? familyName(idea.formatFamily) : 'short', durationS: cur.body.durationS };
  const r = await judgeHooks(store, hooks, ctx, { ...deps, scriptId });
  const at = (deps.now ?? new Date()).toISOString();
  store.priors.set({ key: judgeWinsKey(scriptId), value: { version: cur.version, wins: r.applied ? r.wins : r.wins.map(() => 0), order: r.order, applied: r.applied, at } satisfies StoredJudgeWins, n: r.verdicts.length, supersedesDefault: false, updatedAt: at });
  return { verdicts: r.verdicts, order: r.order, record: r.record, wins: r.wins };
}

/** send_engine: v1 engineConcept with the script's chosen hook appended. */
export function scriptEngineConcept(store: LabStore, scriptId: string): ReturnType<typeof engineConcept> {
  const { cur, idea } = current(store, scriptId);
  if (!idea) throw new EditorError('this script has no idea to send', 400);
  const label = idea.clusterId ? (store.clusters.all().find((c) => c.id === idea.clusterId)?.label ?? null) : null;
  const base = engineConcept(idea, label);
  const hook = cur.body.hooks[cur.body.hookChoice]?.spoken ?? '';
  return { ...base, text: `${base.text} Hook: "${hook}"`.replace(/\s+/g, ' ').trim().slice(0, 300) };
}

/** ask_wizard: a prefill, never auto-sent (broadcast false). */
export function scriptWizardPrefill(store: LabStore, scriptId: string): WizardOpenDetail {
  const script = store.scripts.get(scriptId);
  const { cur } = current(store, scriptId);
  const hook = cur.body.hooks[cur.body.hookChoice]?.spoken ?? '';
  const { toFix } = gateCounts(cur.gate);
  const platform = bodyV2(cur.body).platform;
  const gate = cur.gate.passed ? 'passed' : `not passed: ${toFix} to fix`;
  return { text: `Content Lab script: ${script?.title ?? scriptId}. Hook: "${hook}". Gate ${gate}. ${platform === 'multi' ? 'Several platforms' : platform}, ${cur.body.durationS}s. What would you change before I film it?`, broadcast: false, source: 'content-lab' };
}

/**
 * Mark as posted picker (7.8): the operator's own posts from the last 7 days, ranked by cosine
 * between the script's spoken text and each post's embedding (active model; local vectors are
 * computed when no row exists).
 */
export function publishCandidates(store: LabStore, scriptId: string, opts: { now?: Date; limit?: number } = {}): { postId: string; label: string; postedAt: string | null; similarity: number | null }[] {
  const now = opts.now ?? new Date();
  const v = store.scripts.latestVersion(scriptId);
  if (!v) return [];
  const model = activeModel({ store });
  const qv = model === LOCAL_EMBED_MODEL ? localVec(scriptText(v.body)) : null;
  const since = now.getTime() - PUBLISH_WINDOW_DAYS * 86_400_000;
  return store.posts
    .all()
    .filter((p) => p.isOwned && p.postedAt && Date.parse(p.postedAt) >= since && Date.parse(p.postedAt) <= now.getTime())
    .map((p) => {
      const row = store.embeddings.get('post', p.id, model);
      const pv = row?.vec ?? (model === LOCAL_EMBED_MODEL ? localVec(`${store.dissections.get(p.id)?.hookText ?? ''}\n${p.caption}\n${store.transcripts.get(p.id)?.text ?? ''}`) : null);
      const sim = qv && pv && qv.length === pv.length ? Math.round(cosine(qv, pv) * 1000) / 1000 : null;
      const d = store.dissections.get(p.id);
      return { postId: p.id, label: (d?.hookText || p.caption.split('\n')[0] || p.id).slice(0, 120), postedAt: p.postedAt, similarity: sim };
    })
    .sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1) || (b.postedAt ?? '').localeCompare(a.postedAt ?? '') || a.postId.localeCompare(b.postId))
    .slice(0, opts.limit ?? 8);
}
