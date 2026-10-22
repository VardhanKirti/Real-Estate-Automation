import type { LabGate, LabGateCheck, LabScriptBody } from '@/lib/schemas';
import { wordBudget, wordCount } from '@/lib/lab/measures';

/** A beat id as a reader sees it in a check label: "demo" reads "Demo", "cta" reads "CTA". */
const sectionName = (t: string): string => (t === 'cta' ? 'CTA' : (t.charAt(0).toUpperCase() + t.slice(1)).replaceAll('_', ' '));

/**
 * The script validation gate (SPEC §4.12, AC8). Deterministic first, and nothing is
 * shown as ready until it passes:
 *   - no dashes of any kind (em, en, figure, minus, a spaced hyphen, a double hyphen;
 *     an en dash between two numbers is a range and allowed, per the voice skills)
 *   - no banned words: the voice skill's own list (`bannedFromSkill`) plus the defaults
 *   - no hedging and no "in conclusion"
 *   - no engagement-bait CTA ("comment X below", "type Y", "drop a Z")
 *   - total words within ±15% of the budget, each section within ±25% of its share
 *   - the chosen hook within its form's word budget
 * Then ONE cheap model check (lib/lab/scripts.ts `modelCheck`) fills `scores` 1-5;
 * `gateWithScores` folds it in (any score under 3 fails the gate).
 *
 * Every rule here is pure, so tests pin each one (tests/lab-gate.test.ts).
 */

/** Words that read as AI copy or as hedging, matched on word boundaries, case-insensitive. */
export const DEFAULT_BANNED = ['in conclusion', 'delve', 'game-changer', 'game changer', 'game-changing', 'unlock', 'leverage', 'seamless', 'seamlessly', 'it is important to note', "it's important to note", 'arguably', 'perhaps', 'kind of', 'sort of'];
/** Hedges: soften a claim the evidence already backs. Separate check so the failure names the problem. */
export const HEDGES = ['i think maybe', 'it could be said', 'it might be', 'might possibly', 'in my humble opinion', 'to be honest', 'i guess', 'somewhat', 'more or less', 'probably', 'it seems like', 'could potentially'];

/** Any dash that is not a plain hyphen inside a word. En dash between digits (a range) is allowed. */
export function findDash(text: string): string | null {
  const stripped = text.replace(/(\d)\s?–\s?(\d)/g, '$1 to $2');
  const m = stripped.match(/[‐‑‒—―−]|–|\s-\s|--|^-\s|\s-$/m);
  return m ? m[0].trim() || m[0] : null;
}

const BAIT_CTA = [
  /\b(comment|type|drop|reply with|dm me)\b[^.!?]{0,40}\b(below|keyword|word|in the comments|and i('|’)ll send)\b/i,
  /\bcomment\s+["'“‘]?[A-Z]{2,}["'”’]?/,
  /\b(smash|hit) (that|the) (like|subscribe)\b/i,
  /\btag (a|someone|a friend)\b/i,
  /\blike (and|&) (share|follow)\b/i,
];
export const isBaitCta = (cta: string): boolean => BAIT_CTA.some((re) => re.test(cta));

/** The longest a hook may run per form, in spoken words (results land fast; questions are short). */
export const HOOK_WORD_BUDGET: Record<string, number> = {
  results_first: 14, contrarian: 12, open_loop: 14, direct_challenge: 12, pattern_interrupt: 10, howto_promise: 14, news_react: 14,
  social_proof_claim: 14, identity_call: 12, confession: 14, list_tease: 12, direct_question: 12, mid_action: 12, number_stat: 12,
  imperative: 10, direct_address: 12, time_saving: 12, problem_question: 12, quote: 16, other: 14,
};
export const SECTION_TOLERANCE = 0.25;
export const TOTAL_TOLERANCE = 0.15;
/** Model scores (1-5) below this fail the gate and trigger the one regenerate. */
export const MIN_MODEL_SCORE = 3;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Word-boundary phrase match (so "unlocked" does not trip "unlock" … but "unlock" does). */
export function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(phrase.toLowerCase())}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text.toLowerCase());
}

/**
 * Pull the banned words out of a voice skill's markdown: on lines that talk about banned
 * words, AI-tell words or hedging, every short double-quoted phrase and every item of a
 * parenthesised comma list ("No AI-tell words (unlock, leverage, seamless, etc.)").
 * Long quoted examples (more than four words) are rewrite examples, not banned words.
 */
export function bannedFromSkill(md: string | null | undefined): string[] {
  if (!md) return [];
  const out = new Set<string>();
  for (const line of md.split('\n')) {
    if (!/AI[- ]tell|hedg|banned word|never say|no ["“]/i.test(line)) continue;
    for (const m of line.matchAll(/["“]([^"”]{2,60})["”]/g)) {
      const phrase = m[1].trim().replace(/[.,!?]+$/, '');
      if (phrase && phrase.split(/\s+/).length <= 4 && !/\[|\]/.test(phrase)) out.add(phrase.toLowerCase());
    }
    for (const m of line.matchAll(/\(([^()]{3,200})\)/g)) {
      if (!m[1].includes(',')) continue;
      for (const raw of m[1].split(',')) {
        const w = raw.replace(/["“”]/g, '').replace(/\betc\.?$/i, '').trim().toLowerCase();
        if (w && w.split(/\s+/).length <= 4 && !/^etc\.?$/.test(w) && !/en dash|number/.test(w)) out.add(w);
      }
    }
  }
  return [...out];
}

export type SectionBudget = { index: number; type: string; words: number; budget: number; delta: number; over: boolean };

/** Per-section word counts against the budget split by each section's share of the runtime. */
export function sectionBudgets(body: LabScriptBody): SectionBudget[] {
  const total = wordBudget(body.durationS, body.wpm);
  return body.sections.map((s, index) => {
    const budget = Math.max(1, Math.round((total * (s.endPct - s.startPct)) / 100));
    const words = wordCount(s.spoken);
    const delta = (words - budget) / budget;
    return { index, type: s.type, words, budget, delta, over: Math.abs(delta) > SECTION_TOLERANCE };
  });
}

export function deterministicGate(body: LabScriptBody, opts: { bannedWords?: readonly string[] } = {}): LabGate {
  const banned = [...new Set([...DEFAULT_BANNED, ...(opts.bannedWords ?? [])].map((w) => w.toLowerCase()))];
  const checks: LabGateCheck[] = [];
  const hook = body.hooks[body.hookChoice] ?? body.hooks[0] ?? null;
  const texts: { text: string; section: number | null }[] = [
    ...body.sections.map((s, i) => ({ text: `${s.spoken}\n${s.onScreen}`, section: i })),
    ...(hook ? [{ text: `${hook.spoken}\n${hook.onScreen}`, section: 0 }] : []),
    { text: `${body.cta}\n${body.caption}\n${body.titles.join('\n')}`, section: null },
  ];
  const dash = texts.map((t) => ({ t, d: findDash(t.text) })).find((x) => x.d);
  checks.push({ id: 'no-dashes', label: 'No dashes', ok: !dash, detail: dash ? `"${dash.d}" appears in the copy` : 'None found', section: dash?.t.section ?? null });
  const hit = texts.flatMap((t) => banned.filter((w) => containsPhrase(t.text, w)).map((w) => ({ w, section: t.section })))[0];
  checks.push({ id: 'banned-words', label: 'No banned words', ok: !hit, detail: hit ? `"${hit.w}"` : 'None found', section: hit?.section ?? null });
  const hedge = texts.flatMap((t) => HEDGES.filter((w) => containsPhrase(t.text, w)).map((w) => ({ w, section: t.section })))[0];
  checks.push({ id: 'no-hedging', label: 'No hedging', ok: !hedge, detail: hedge ? `"${hedge.w}"` : 'None found', section: hedge?.section ?? null });
  const bait = isBaitCta(body.cta);
  checks.push({ id: 'cta', label: 'No engagement-bait CTA', ok: !bait, detail: bait ? 'The CTA asks for a comment, keyword or tag' : 'Clean', section: null });
  const budget = wordBudget(body.durationS, body.wpm);
  const words = body.sections.reduce((a, s) => a + wordCount(s.spoken), 0);
  const totalDelta = budget > 0 ? (words - budget) / budget : 0;
  checks.push({ id: 'total-words', label: 'Total words within 15%', ok: Math.abs(totalDelta) <= TOTAL_TOLERANCE, detail: `${words} of ${budget} words (${totalDelta >= 0 ? '+' : ''}${Math.round(totalDelta * 100)}%)`, section: null });
  for (const s of sectionBudgets(body)) {
    if (s.over) checks.push({ id: `section-${s.index}`, label: `${sectionName(s.type)} within 25%`, ok: false, detail: `${s.words} of ${s.budget} words, ${s.delta >= 0 ? '+' : ''}${Math.round(s.delta * 100)}%`, section: s.index });
  }
  if (hook) {
    const max = HOOK_WORD_BUDGET[hook.form] ?? 14;
    const hw = wordCount(hook.spoken);
    checks.push({ id: 'hook-words', label: 'Hook within its budget', ok: hw <= max, detail: `${hw} of ${max} words`, section: 0 });
  }
  return { passed: checks.every((c) => c.ok), checks, scores: null };
}

export type ModelScores = NonNullable<LabGate['scores']>;
const SCORE_LABEL: Record<keyof ModelScores, string> = { voice: 'Voice match', tension: 'Tension', evidence: 'Evidence specificity', register: 'Spoken register' };

/**
 * Fold the model check into a deterministic gate: each score under 3 adds a failing
 * check, pinned to the section the model blamed (or none). `null` scores (the model
 * was unavailable) leave the gate as it was, honestly marked as unscored.
 */
export function gateWithScores(gate: LabGate, scores: ModelScores | null, blame: Partial<Record<keyof ModelScores, number | null>> = {}): LabGate {
  if (!scores) return { ...gate, scores: null };
  const extra: LabGateCheck[] = (Object.keys(SCORE_LABEL) as (keyof ModelScores)[])
    .filter((k) => scores[k] < MIN_MODEL_SCORE)
    .map((k) => ({ id: `model-${k}`, label: SCORE_LABEL[k], ok: false, detail: `scored ${scores[k]} of 5`, section: blame[k] ?? null }));
  const checks = [...gate.checks.filter((c) => !c.id.startsWith('model-')), ...extra];
  return { passed: checks.every((c) => c.ok), checks, scores };
}

/** How bad a gate is, for keeping the better of two attempts: failing checks, then words off budget. */
export function gateBadness(gate: LabGate): number {
  return gate.checks.filter((c) => !c.ok).length * 100 + (gate.scores ? 20 - (gate.scores.voice + gate.scores.tension + gate.scores.evidence + gate.scores.register) : 0);
}
