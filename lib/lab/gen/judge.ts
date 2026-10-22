/**
 * The pairwise hook judge (07 7.7). One cheap model, pairwise, order swapped, abstaining
 * unless both orders agree. It only orders hook variants before a real test; it never prints
 * a number about a post's future. Every non-abstained live verdict is written to the ledger
 * (06's recordJudgeVerdict) and graded later against a real test; `judgeRecord` turns that
 * record into the learning / on / off state, and in `off` it runs in shadow.
 */
import { z } from 'zod';
import type { LabStore } from '@/lib/lab/store';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { gatedCall } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { readEnvLocal } from '@/lib/creds';
import { wilson } from '@/lib/lab/measures';
import { recordJudgeVerdict } from '@/lib/lab/ledger/freeze';

export const JUDGE_PROMPT_VERSION = 'judge-v1';
export const JUDGE_WINDOW_DAYS = 90;
/** graded, non-abstained pairs before the record can switch it off or prove it */
export const JUDGE_MIN_N = 20;
export const JUDGE_MODEL_ENV = 'LAB_JUDGE_MODEL';
export const JUDGE_TIMEOUT_MS = 60_000;

export type JudgeVerdict = { aId: string; bId: string; pickAB: 'A' | 'B'; pickBA: 'A' | 'B'; winner: string | null; abstained: boolean; reasonAB: string; reasonBA: string };
export type JudgeRecord = { n: number; right: number; rate: number | null; lo: number | null; hi: number | null; state: 'learning' | 'on' | 'off' };

export const JudgeReplySchema = z.object({ pick: z.enum(['A', 'B']), why: z.string().default('') });
export type JudgeReply = z.infer<typeof JudgeReplySchema>;
export type JudgeAsk = (prompt: string) => Promise<ClaudeJson<JudgeReply>>;

const env = () => ({ ...process.env, ...readEnvLocal() });
/** LAB_JUDGE=0 disables the judge entirely (no calls). */
export const judgeEnabled = (): boolean => env().LAB_JUDGE?.trim() !== '0';

export function judgePrompt(first: string, second: string, ctx: { platform: string; format: string; durationS: number }): string {
  return [
    `Two opening lines for the same ${ctx.durationS}s ${ctx.format} video on ${ctx.platform}. A viewer is scrolling.`,
    'Which one keeps that viewer watching past 3 seconds? Answer with the letter, then one sentence on why.',
    `A: "${first}"`,
    `B: "${second}"`,
    'Reply with STRICT JSON only: {"pick":"A","why":""}',
  ].join('\n');
}

const wordsOf = (s: string) => (s.match(/\S+/g) ?? []).length;

/** Dry: the shorter hook wins both orders (ties: the first id), deterministic. */
function dryPick(first: { id: string; text: string }, second: { id: string; text: string }): JudgeReply {
  const a = wordsOf(first.text);
  const b = wordsOf(second.text);
  const winner = a < b ? first : b < a ? second : first.id <= second.id ? first : second;
  return { pick: winner === first ? 'A' : 'B', why: 'Dry run: the shorter line wins.' };
}

export type JudgeDeps = { ask?: JudgeAsk; now?: Date; override?: boolean; scriptId?: string | null; record?: boolean };

/**
 * Two calls, A then B and B then A; the swapped pick is mapped back to ids. `winner` is set
 * only when both pick the same id, otherwise the verdict abstains. Each call is gated
 * (provider and line `llm`, kind `judge`). A live non-abstained verdict is written to the
 * ledger as predictor `judge`; abstentions and dry verdicts never are.
 */
export async function judgePair(store: LabStore, a: { id: string; text: string }, b: { id: string; text: string }, ctx: { platform: string; format: string; durationS: number }, deps: JudgeDeps = {}): Promise<JudgeVerdict> {
  const model = env()[JUDGE_MODEL_ENV]?.trim() || undefined;
  const ask: JudgeAsk = deps.ask ?? ((p) => claudeJson(p, JudgeReplySchema, { timeoutMs: JUDGE_TIMEOUT_MS, model }));
  const call = async (first: { id: string; text: string }, second: { id: string; text: string }, order: 'AB' | 'BA'): Promise<JudgeReply> => {
    const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'judge', actor: 'claude-cli:judge', input: { promptVersion: JUDGE_PROMPT_VERSION, order, aId: a.id, bId: b.id }, override: deps.override, now: deps.now }, {
      dry: () => ({ result: dryPick(first, second) }),
      live: async () => {
        const res = await ask(judgePrompt(first.text, second.text, ctx));
        if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `judge failed: ${res.error}`);
        return { result: res.data, units: 1, actualUsd: 0 };
      },
    });
    return out.result;
  };
  const ab = await call(a, b, 'AB');
  const ba = await call(b, a, 'BA');
  const idAB = ab.pick === 'A' ? a.id : b.id;
  const idBA = ba.pick === 'A' ? b.id : a.id;
  const agree = idAB === idBA;
  const v: JudgeVerdict = { aId: a.id, bId: b.id, pickAB: ab.pick, pickBA: ba.pick, winner: agree ? idAB : null, abstained: !agree, reasonAB: ab.why, reasonBA: ba.why };
  if (deps.record !== false && !v.abstained && !isDry() && deps.scriptId) {
    recordJudgeVerdict(store, { scriptId: deps.scriptId, aId: v.aId, bId: v.bId, winner: v.winner, abstained: false, promptVersion: JUDGE_PROMPT_VERSION, dry: false, now: deps.now ?? new Date() });
  }
  return v;
}

/** Pure state rule (7.7): learning under 20; on when the Wilson 90% low end is above 0.5; else off. */
export function judgeState(right: number, n: number): JudgeRecord {
  if (n <= 0) return { n: 0, right: 0, rate: null, lo: null, hi: null, state: 'learning' };
  const iv = wilson(right, n);
  const lo = iv ? Math.round(iv[0] * 100) / 100 : null;
  const hi = iv ? Math.round(iv[1] * 100) / 100 : null;
  const rate = Math.round((right / n) * 100) / 100;
  const state = n < JUDGE_MIN_N ? 'learning' : iv && iv[0] > 0.5 ? 'on' : 'off';
  return { n, right, rate, lo, hi, state };
}

/** Graded, non-abstained, live judge predictions in the last 90 days. */
export function judgeRecord(store: LabStore, now: Date = new Date()): JudgeRecord {
  const since = new Date(now.getTime() - JUDGE_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = store.predictions.list({ predictor: 'judge', origin: 'live', status: 'graded' }).filter((p) => p.origin === 'live' && !p.dry && p.status === 'graded' && p.pairRight !== null && (p.gradedAt ?? p.frozenAt) >= since);
  return judgeState(rows.filter((p) => p.pairRight === true).length, rows.length);
}

/** HookPicker copy for each state (7.7). `lean` is the hook label the judge prefers, when it has one. */
export function judgeMessage(r: JudgeRecord, lean: string | null): string {
  if (!judgeEnabled()) return 'Judge disabled in Setup.';
  if (r.state === 'off') return `Judge off: ${r.right} of ${r.n} in 90 days, no better than a coin. It keeps a silent record and comes back if that changes.`;
  if (!lean) return r.state === 'on' ? `Judge record: right ${r.right} of ${r.n} in 90 days.` : `Judge is learning: record ${r.right} of ${r.n}, at chance until n 20.`;
  if (r.state === 'on') return `Judge leans ${lean} (right ${r.right} of ${r.n} in 90 days)`;
  return `Judge leans ${lean} (not a forecast; record ${r.right} of ${r.n}, at chance until n 20)`;
}

/**
 * Order hooks by pair wins: every pair judged both ways; abstained pairs count 0 for both;
 * ties keep the generator's order. In state `off` the verdicts are still recorded (shadow)
 * but the returned order is the generator's.
 */
export async function judgeHooks(store: LabStore, hooks: readonly { id: string; text: string }[], ctx: { platform: string; format: string; durationS: number }, deps: JudgeDeps = {}): Promise<{ verdicts: JudgeVerdict[]; wins: number[]; order: number[]; record: JudgeRecord; applied: boolean }> {
  const record = judgeRecord(store, deps.now);
  const generator = hooks.map((_, i) => i);
  if (!judgeEnabled()) return { verdicts: [], wins: hooks.map(() => 0), order: generator, record, applied: false };
  const verdicts: JudgeVerdict[] = [];
  const wins = hooks.map(() => 0);
  for (let i = 0; i < hooks.length; i++) for (let j = i + 1; j < hooks.length; j++) {
    const v = await judgePair(store, hooks[i], hooks[j], ctx, deps);
    verdicts.push(v);
    if (v.winner === hooks[i].id) wins[i]++;
    else if (v.winner === hooks[j].id) wins[j]++;
  }
  const applied = record.state !== 'off';
  const order = applied ? [...generator].sort((x, y) => wins[y] - wins[x] || x - y) : generator;
  return { verdicts, wins, order, record, applied };
}
