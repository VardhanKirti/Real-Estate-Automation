import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { LabBeatTypeSchema, LabHookFormSchema, LabScriptBodySchema, LabTriggerSchema, emptyGrounding, type LabBeat, type LabBeatType, type LabGate, type LabGrounding, type LabIdea, type LabProfile, type LabScriptBody, type LabScriptVersion } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { claudeJson, type ClaudeJson } from '@/lib/creative-engine/claude';
import { readSkillMarkdown } from '@/lib/skills-catalog';
import { getBrainProvider } from '@/lib/brain';
import { BRAND } from '@/lib/brand';
import { gatedCall } from '@/lib/lab/spend';
import { isDry } from '@/lib/lab/dry';
import { bestLines, computeDna, sentences, type VoiceStats } from '@/lib/lab/dna';
import { effective } from '@/lib/lab/priors';
import { fmtRatio, wordBudget, wordCount } from '@/lib/lab/measures';
import { HOOK_WORD_BUDGET, bannedFromSkill, deterministicGate, gateBadness, gateWithScores, sectionBudgets, type ModelScores } from '@/lib/lab/gate';
import { recordOutcomes } from '@/lib/lab/outcomes';
import { FORMAT_LABEL } from '@/lib/lab/distill';
import { hasLivePrediction, linkPredictionsToPost } from '@/lib/lab/ledger/freeze';
import { readEnvLocal } from '@/lib/creds';
import { contrastBlock, retrieveGrounding } from '@/lib/lab/gen/grounding';
import { voiceSkillsFor } from '@/lib/lab/gen/skills';
import { defaultPlatform, gateWithRules } from '@/lib/lab/gen/script-rules';
import { bodyV2, type ScriptPlatform } from '@/lib/lab/gen/rules';

/**
 * Scripts (SPEC §4.12). One idea → one script with versions:
 *
 *   plan     word budget = duration × your WPM ÷ 60 (your prior when it has earned it,
 *            else your measured pace, else the niche's), sections from the idea's strand
 *   prompt   four blocks: CONTEXT (brand, audience, offer from Optimal Engine), VOICE (the voice
 *            skill markdown read through readSkillMarkdown, your measured stats, 10-15 of
 *            your own best lines), EVIDENCE (the idea, hook recs with n, 2-3 evidence
 *            hooks quoted), STRUCTURE (section percentages and word budgets)
 *   gate     deterministic (lib/lab/gate.ts) then ONE cheap model check (1-5 scores);
 *            a failure regenerates once with the failures fed back, then the better
 *            attempt is kept and its failures stay on the offending sections
 *   versions section regenerate and hand edits each add a version; an edit stores a
 *            sentence diff (`edit_diff`) that later becomes a voice sample (dna.bestLines)
 *
 * Every model call goes through the spend gate (provider `llm`, the local claude CLI);
 * dry builds a deterministic draft from the plan (it passes the gate by construction).
 * `ask`, `askCheck`, `askSection`, `readSkill` and `context` are injectable for tests.
 */

/** v2 (07 7.6): the CONTRAST and LOOPS blocks and the loop fields in the reply. */
export const SCRIPT_PROMPT_VERSION = 'script-v2';
export const DEFAULT_DURATION_S = 45;
export const DEFAULT_WPM = 160;
/** Long form above this many seconds uses the YouTube voice skill. */
export const LONG_FORM_S = 180;
export const VOICE_SKILLS = { long: ['brody-voice-youtube', 'brody-voice-speaking'], short: ['reel', 'brody-voice-speaking'] } as const;
const SKILL_CHARS = 7_000;

const ReplyHook = z.object({ form: LabHookFormSchema.catch('other'), trigger: LabTriggerSchema.catch('other'), spoken: z.string().min(1), onScreen: z.string().default('') });
const ReplySection = z.object({ type: z.string().optional(), spoken: z.string().min(1), onScreen: z.string().default(''), visualNote: z.string().default('') });
const ReplyLoop = z.object({ id: z.string().min(1), question: z.string().default(''), answer: z.string().default(''), opens: z.number().int().min(0), closes: z.number().int().min(0).nullable().default(null) });
export const ScriptReplySchema = z.object({
  hooks: z.array(ReplyHook).min(1).max(3),
  sections: z.array(ReplySection).min(1),
  cta: z.string().default(''),
  caption: z.string().default(''),
  titles: z.array(z.string()).max(3).default([]),
  /* v2 (07 7.6): the loop ledger and the contrast paragraph (copied into grounding.contrast) */
  loops: z.array(ReplyLoop).max(6).default([]),
  withheld: z.string().default(''),
  peakSection: z.number().int().min(0).nullable().default(null),
  endType: z.enum(['payoff', 'callback', 'cta', 'fade']).nullable().catch(null).default(null),
  contrast: z.string().default(''),
});
export const SectionReplySchema = ReplySection;
export const CheckReplySchema = z.object({
  voice: z.number().int().min(1).max(5),
  tension: z.number().int().min(1).max(5),
  evidence: z.number().int().min(1).max(5),
  register: z.number().int().min(1).max(5),
  /** section index the weakest score is about, or null */
  blame: z.object({ voice: z.number().int().nullable().optional(), tension: z.number().int().nullable().optional(), evidence: z.number().int().nullable().optional(), register: z.number().int().nullable().optional() }).default({}),
});
/** What `ask` returns: the reply as parsed, or (tests) as written; `toBody` fills the v2 defaults. */
export type ScriptReply = z.input<typeof ScriptReplySchema>;
export type CheckReply = z.infer<typeof CheckReplySchema>;

export type ScriptDeps = {
  ask?: (prompt: string) => Promise<ClaudeJson<ScriptReply>>;
  askCheck?: (prompt: string) => Promise<ClaudeJson<CheckReply>>;
  askSection?: (prompt: string) => Promise<ClaudeJson<z.infer<typeof SectionReplySchema>>>;
  readSkill?: (slug: string) => string | null;
  /** CONTEXT block text; default asks Optimal Engine for brand, audience and offer. */
  context?: string | null;
  now?: Date;
  override?: boolean;
};

/* ── plan ─────────────────────────────────────────────────────────────── */

export type PlanSection = { type: LabBeatType; startPct: number; endPct: number; budget: number };
export type ScriptPlan = {
  idea: LabIdea;
  clusterLabel: string | null;
  profile: LabProfile | null;
  durationS: number;
  durationSource: string;
  wpm: number;
  wpmSource: string;
  words: number;
  sections: PlanSection[];
  evidence: { postId: string; handle: string; breakout: number | null; hookText: string; why: string }[];
  skills: { slug: string; md: string }[];
  bannedWords: string[];
  voice: VoiceStats;
  lines: string[];
  /* v2 (07 7.5, 7.6) */
  platform: ScriptPlatform;
  grounding: LabGrounding;
  arm: 'grounded' | 'control';
  armP: number | null;
  /** creator id to handle, for the CONTRAST block */
  handles: Record<string, string>;
};

/** LAB_GROUNDING_CONTROL (default 0, off): the probability a new draft is written without examples. */
export function groundingControlP(): number {
  const raw = Number(({ ...process.env, ...readEnvLocal() }).LAB_GROUNDING_CONTROL ?? '0');
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
}

const DEFAULT_STRAND: LabBeat[] = [
  { type: 'hook', startPct: 0, endPct: 8, summary: '' },
  { type: 'context', startPct: 8, endPct: 22, summary: '' },
  { type: 'demo', startPct: 22, endPct: 72, summary: '' },
  { type: 'payoff', startPct: 72, endPct: 92, summary: '' },
  { type: 'cta', startPct: 92, endPct: 100, summary: '' },
];

const mid = (x: [number, number] | null | undefined) => (x ? (x[0] + x[1]) / 2 : null);

/** Sections from a strand, re-based to 0-100 with budgets that sum to the total. */
export function planSections(strand: readonly LabBeat[], words: number): PlanSection[] {
  const beats = (strand.length ? strand : DEFAULT_STRAND).filter((b) => b.endPct > b.startPct);
  const start = beats[0].startPct;
  const span = beats[beats.length - 1].endPct - start || 100;
  const out = beats.map((b) => ({ type: b.type, startPct: Math.round(((b.startPct - start) / span) * 1000) / 10, endPct: Math.round(((b.endPct - start) / span) * 1000) / 10, budget: 0 }));
  out[out.length - 1].endPct = 100;
  for (const s of out) s.budget = Math.max(1, Math.round((words * (s.endPct - s.startPct)) / 100));
  return out;
}

export function planScript(store: LabStore, ideaId: string, opts: { durationS?: number; now?: Date; readSkill?: (slug: string) => string | null; platform?: ScriptPlatform; arm?: 'grounded' | 'control'; random?: () => number } = {}): ScriptPlan {
  const idea = store.ideas.get(ideaId);
  if (!idea) throw new Error('no such idea');
  const now = opts.now ?? new Date();
  const profile = store.profiles.latest().find((p) => p.formatFamily === idea.formatFamily) ?? null;
  const dna = computeDna(store, { now });
  const dur = opts.durationS ? { value: opts.durationS, source: 'requested' } : (() => {
    const e = effective(store, `yours:duration:${idea.formatFamily}`, { value: mid(profile?.stats.durationS), n: profile?.breakoutsN ?? 0 }, DEFAULT_DURATION_S);
    return { value: e.value, source: e.source === 'prior' ? `your prior, n ${e.n}` : e.source === 'niche' ? `niche breakouts, n ${e.n}` : 'default' };
  })();
  const ownWpm = dna.voice.wpm.n >= 5 ? dna.voice.wpm.median : null;
  const wpmE = effective(store, 'yours:wpm', { value: ownWpm ?? mid(profile?.stats.wpm), n: ownWpm !== null ? dna.voice.wpm.n : (profile?.breakoutsN ?? 0) }, DEFAULT_WPM);
  const wpm = Math.round(wpmE.value);
  const wpmSource = wpmE.source === 'prior' ? `your prior, n ${wpmE.n}` : wpmE.source === 'niche' ? (ownWpm !== null ? `your transcripts, n ${wpmE.n}` : `niche breakouts, n ${wpmE.n}`) : 'default';
  const durationS = Math.round(dur.value);
  const words = wordBudget(durationS, wpm);
  const read = opts.readSkill ?? ((slug: string) => readSkillMarkdown(slug));
  const platform = opts.platform ?? defaultPlatform(store, idea, now);
  const slugs = voiceSkillsFor(idea, { durationS, platform });
  const skills = slugs.flatMap((slug) => {
    const md = read(slug);
    return md ? [{ slug, md }] : [];
  });
  const posts = new Map(store.posts.all().map((p) => [p.id, p]));
  const sources = new Map(store.sources.all().map((s) => [s.id, s]));
  // 7.5: the idea's stored grounding when it has exemplars, else a fresh retrieval
  const stored = idea.grounding && idea.grounding.exemplars.length ? idea.grounding : null;
  const grounding: LabGrounding = stored ?? retrieveGrounding(store, { query: `${idea.title} ${idea.angle}`, formatFamily: idea.formatFamily, angle: idea.launchAngle ?? null, now });
  const controlP = groundingControlP();
  const arm = opts.arm ?? (controlP > 0 && (opts.random ?? Math.random)() < controlP ? 'control' : 'grounded');
  const handles: Record<string, string> = {};
  for (const r of [...grounding.exemplars, ...grounding.duds]) handles[r.creatorId] = sources.get(r.creatorId)?.handle ?? r.creatorId;
  return {
    platform,
    grounding: { ...grounding, contrast: '' },
    arm,
    armP: controlP > 0 ? controlP : null,
    handles,
    idea,
    clusterLabel: idea.clusterId ? (store.clusters.all().find((c) => c.id === idea.clusterId)?.label ?? null) : null,
    profile,
    durationS,
    durationSource: dur.source,
    wpm,
    wpmSource,
    words,
    sections: planSections(idea.strand.length ? idea.strand : (profile?.strand ?? []), words),
    evidence: idea.evidence.slice(0, 3).map((e) => {
      const p = posts.get(e.postId);
      return { postId: e.postId, handle: p ? (sources.get(p.sourceId)?.handle ?? '') : '', breakout: store.measures.get(e.postId)?.breakout ?? null, hookText: store.dissections.get(e.postId)?.hookText ?? '', why: e.why };
    }),
    skills,
    bannedWords: [...new Set(skills.flatMap((s) => bannedFromSkill(s.md)))],
    voice: dna.voice,
    lines: bestLines(store, { now }),
  };
}

/* ── prompt ───────────────────────────────────────────────────────────── */

export async function brainContext(): Promise<string> {
  try {
    const provider = getBrainProvider();
    const hits = await Promise.race([provider.search('brand audience offer positioning'), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))]);
    return hits.slice(0, 3).map((h) => `- ${h.title}: ${h.snippet.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n');
  } catch {
    return '';
  }
}

export function scriptPrompt(plan: ScriptPlan, context: string, feedback: string[] = []): string {
  const v = plan.voice;
  const i = plan.idea;
  const recs = i.hookRecs.map((h) => `${h.form.replaceAll('_', ' ')} × ${h.trigger.replaceAll('_', ' ')} (n ${h.n}${h.lift !== null ? `, form lift ${fmtRatio(h.lift)}` : ''})`).join('; ');
  const blocks = [
    `You write one short video script for ${BRAND.name}'s operator, in their voice, grounded in measured evidence. Prompt ${SCRIPT_PROMPT_VERSION}.`,
    '',
    '## CONTEXT',
    context.trim() || '(no brand context found in Optimal Engine; write for builders and operators using AI tools)',
    '',
    '## VOICE',
    ...plan.skills.map((s) => `### skill: ${s.slug}\n${s.md.slice(0, SKILL_CHARS)}`),
    `Measured from the operator's own transcripts: pace ${v.wpm.median ?? 'unknown'} wpm (n ${v.wpm.n}); sentence length mean ${v.sentence.mean ?? 'n/a'} words (p10 ${v.sentence.p10 ?? 'n/a'}, p90 ${v.sentence.p90 ?? 'n/a'}); common openers ${v.openers.slice(0, 5).map((o) => `"${o.word}"`).join(', ') || 'n/a'}; transitions ${v.transitions.slice(0, 4).map((t) => `"${t.phrase}"`).join(', ') || 'n/a'}.`,
    plan.lines.length ? `Their own best lines (match this register):\n${plan.lines.map((l) => `- ${l}`).join('\n')}` : '',
    '',
    '## EVIDENCE',
    `Idea: ${i.title}. Topic ${plan.clusterLabel ?? 'n/a'}. Angle: ${i.angle}.`,
    i.tension ? `Tension: the viewer believes "${i.tension.falseBelief}"; the script lands "${i.tension.reframe}".` : 'No tension recorded: open a loop instead.',
    recs ? `Hook form × trigger that broke out in this format: ${recs}.` : '',
    // the control arm (LAB_GROUNDING_CONTROL) is written without examples: no evidence hooks, no CONTRAST
    ...(plan.arm === 'control' ? [] : plan.evidence.map((e) => `- @${e.handle} (${e.breakout === null ? 'n/a' : fmtRatio(e.breakout)} their normal) opened: "${e.hookText}". Why it matters: ${e.why}`)),
    '',
    plan.arm === 'control' ? '' : contrastBlock(plan.grounding, (id) => plan.handles[id] ?? id),
    '',
    '## LOOPS',
    "Every open loop you start must close. Pay the hook's promise before 80% of the runtime. Put a second peak in the last quarter. End on the payoff or a callback, then one short CTA.",
    'Return "loops": [{"id":"L1","question":"","answer":"","opens":0,"closes":3}], "withheld": the one fact the hook holds back, "peakSection": index of the strongest moment after the hook, "endType": payoff|callback|cta|fade.',
    `Target platform: ${plan.platform === 'multi' ? 'several platforms' : plan.platform}.`,
    '',
    '## STRUCTURE',
    `${plan.durationS} seconds at ${plan.wpm} words a minute = ${plan.words} spoken words in the sections (±15% total, ±25% per section).`,
    ...plan.sections.map((s, k) => `${k}. ${s.type} ${s.startPct}-${s.endPct}% · ${s.budget} words`),
    `Write 3 hook variants (one per recommended form when given); each hook at most ${HOOK_WORD_BUDGET[i.hookRecs[0]?.form ?? 'other'] ?? 14} words. The chosen hook is also the first words of section 0.`,
    ...(feedback.length ? ['', '## FIX THESE FROM THE LAST ATTEMPT', ...feedback.map((f) => `- ${f}`)] : []),
    '',
    'Rules: no dashes of any kind, no hedging, no "in conclusion", no comment or keyword bait in the CTA, never invent a number that is not in EVIDENCE.',
    `Reply with STRICT JSON only: {"hooks":[{"form":"","trigger":"","spoken":"","onScreen":""}],"sections":[${plan.sections.map((s) => `{"type":"${s.type}","spoken":"","onScreen":"","visualNote":""}`).join(',')}],"cta":"","caption":"","titles":["",""],"loops":[{"id":"L1","question":"","answer":"","opens":0,"closes":0}],"withheld":"","peakSection":0,"endType":"payoff"${plan.arm === 'control' || plan.grounding.exemplars.length === 0 ? '' : ',"contrast":""'}}. Exactly ${plan.sections.length} sections in this order. No markdown.`,
  ];
  return blocks.filter((l) => l !== '').join('\n');
}

/* ── body + dry draft ─────────────────────────────────────────────────── */

export function toBody(raw: ScriptReply, plan: ScriptPlan): LabScriptBody {
  const reply = ScriptReplySchema.parse(raw);
  const hooks = reply.hooks.slice(0, 3).map((h) => ({ form: h.form, trigger: h.trigger, spoken: h.spoken.trim(), onScreen: h.onScreen.trim(), words: wordCount(h.spoken) }));
  const firstOk = hooks.findIndex((h) => h.words <= (HOOK_WORD_BUDGET[h.form] ?? 14));
  return LabScriptBodySchema.parse({
    durationS: plan.durationS,
    wpm: plan.wpm,
    hooks,
    hookChoice: firstOk >= 0 ? firstOk : 0,
    sections: plan.sections.map((s, k) => {
      const r = reply.sections[k];
      return { type: s.type, startPct: s.startPct, endPct: s.endPct, spoken: (r?.spoken ?? '').trim(), onScreen: (r?.onScreen ?? '').trim(), visualNote: (r?.visualNote ?? '').trim() };
    }),
    cta: reply.cta.trim(),
    caption: reply.caption.trim(),
    titles: reply.titles.map((t) => t.trim()).filter(Boolean).slice(0, 3),
    ...v2Fields(plan, {
      loops: reply.loops.map((l) => ({ id: l.id, question: l.question.trim(), answer: l.answer.trim(), opens: l.opens, closes: l.closes })),
      withheld: reply.withheld.trim(),
      peakSection: reply.peakSection !== null && reply.peakSection < plan.sections.length ? reply.peakSection : null,
      endType: reply.endType,
      contrast: reply.contrast.trim(),
    }),
  });
}

/** The 07 7.6 body fields every new draft carries (platform, loops, grounding with its contrast, arm). */
function v2Fields(plan: ScriptPlan, r: { loops: NonNullable<LabScriptBody['loops']>; withheld: string; peakSection: number | null; endType: LabScriptBody['endType']; contrast: string }) {
  return {
    platform: plan.platform,
    loops: r.loops,
    withheld: r.withheld,
    peakSection: r.peakSection,
    endType: r.endType ?? null,
    grounding: plan.arm === 'control' ? { ...emptyGrounding, query: plan.grounding.query, embedModel: plan.grounding.embedModel } : { ...plan.grounding, contrast: r.contrast },
    arm: plan.arm,
    armP: plan.armP,
  };
}

const SPARE = ['That matters more than it looks.', 'Keep that in mind for the next part.', 'This is the bit people skip.', 'It took me a while to see it.', 'And it holds up on real work.', 'You can check it yourself.'];

/**
 * Whole sentences from `pool` (then a few spare lines) until the count sits inside
 * 85-110% of `words`; only the last resort trims a sentence, and it still ends on a stop.
 */
export function fitWords(pool: readonly string[], words: number): string {
  const target = Math.max(1, words);
  const lines = [...new Set([...pool, ...SPARE])];
  const out: string[] = [];
  let n = 0;
  for (const s of lines) {
    if (n >= target * 0.85) break;
    const w = wordCount(s);
    if (n + w <= target * 1.1) {
      out.push(s);
      n += w;
    }
  }
  if (n >= target * 0.85 && n > 0) return out.join(' ');
  const flat = [...out, ...lines].join(' ').split(/\s+/).filter(Boolean).slice(0, target).join(' ').replace(/[,;:]$/, '');
  return /[.!?]$/.test(flat) ? flat : `${flat}.`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A deterministic draft for dry runs: built from the plan, inside every budget, no banned words. */
export function dryBody(plan: ScriptPlan): LabScriptBody {
  const i = plan.idea;
  const topic = plan.clusterLabel ?? i.title;
  const ev = plan.evidence[0];
  const bank: Record<string, string[]> = {
    hook: ["Here is what actually happened."],
    context: [`Everyone is talking about ${topic.toLowerCase()} right now.`, i.tension ? `Most people think ${i.tension.falseBelief.toLowerCase()}.` : 'Most people stop at the launch video.', 'So I set it up on a real project this week.'],
    promise: [`By the end you will know exactly where ${i.angle} pays off.`],
    demo: ['Here is the setup on my screen.', 'I paste the config in and run it once.', 'Now watch the numbers on the right.', 'This is the part nobody shows you.', 'I run it again with one change.', 'The second run finishes in half the time.', 'Same task, same model, one setting different.'],
    claim: [i.tension ? `${cap(i.tension.reframe)}.` : `${cap(i.angle)} is the part that matters.`],
    evidence: [ev && ev.breakout !== null ? `The creators who showed this got ${fmtRatio(ev.breakout)} their usual views.` : 'I checked it against the posts that actually broke out.', 'The pattern held every time.'],
    contrast: ['Before, this took me an afternoon.', 'Now it takes a few minutes.'],
    reveal: [i.tension ? `${cap(i.tension.reframe)}.` : 'And this is the trick that makes it work.'],
    payoff: [`That is ${i.angle}, start to finish.`, 'Set it up once and it keeps paying you back.'],
    rehook: ['And there is one more part to this.'],
    cta: ['Follow for the next build.', 'Part two is already in the edit.'],
    other: ['One more thing to know.'],
  };
  const forms = i.hookRecs.length ? i.hookRecs : [{ form: 'results_first' as const, trigger: 'curiosity' as const, lift: null, n: 0 }];
  const hookLines = [`I tested ${i.angle} on a real project.`, `Nobody shows you ${i.angle}.`, `Here is ${i.angle} in one minute.`];
  const hooks = forms.slice(0, 3).map((h, k) => {
    const max = HOOK_WORD_BUDGET[h.form] ?? 14;
    const spoken = fitWords([hookLines[k] ?? hookLines[0]], Math.min(max, wordCount(hookLines[k] ?? hookLines[0])));
    return { form: h.form, trigger: h.trigger, spoken, onScreen: spoken.split(' ').slice(0, 5).join(' ').replace(/[.!?]$/, ''), words: wordCount(spoken) };
  });
  const sections = plan.sections.map((s, k) => ({
    type: s.type,
    startPct: s.startPct,
    endPct: s.endPct,
    spoken: k === 0 && Math.abs(hooks[0].words - s.budget) <= s.budget * 0.25 ? hooks[0].spoken : fitWords(k === 0 ? [hooks[0].spoken, ...bank.hook] : (bank[s.type] ?? bank.other), s.budget),
    onScreen: s.type === 'hook' ? hooks[0].onScreen : s.type === 'cta' ? 'Follow for part two' : '',
    visualNote: s.type === 'demo' ? 'Screen recording of the setup, numbers on the right' : '',
  }));
  // one loop: the hook's promise, closed by the last payoff or reveal (its answer is that section's first sentence)
  let close = -1;
  for (let k = sections.length - 1; k > 0; k--) {
    if (sections[k].type === 'payoff' || sections[k].type === 'reveal') {
      close = k;
      break;
    }
  }
  const loops = close > 0 ? [{ id: 'L1', question: `What does ${i.angle} change?`, answer: sentences(sections[close].spoken)[0] ?? sections[close].spoken, opens: 0, closes: close }] : [];
  return LabScriptBodySchema.parse({
    ...v2Fields(plan, { loops, withheld: close > 0 ? 'the result' : '', peakSection: close > 0 ? close : null, endType: close > 0 ? 'payoff' : null, contrast: plan.grounding.exemplars.length ? 'Dry run: no contrast was written.' : '' }),
    durationS: plan.durationS,
    wpm: plan.wpm,
    hooks,
    hookChoice: 0,
    sections,
    cta: 'Follow for part two, where I take it further.',
    caption: `${i.title}. The setup and the real numbers.`,
    titles: [i.title.slice(0, 80), `${cap(i.angle)}, tested`.slice(0, 80)],
  });
}

/* ── gate + model check ───────────────────────────────────────────────── */

export function checkPrompt(body: LabScriptBody, plan: ScriptPlan): string {
  return [
    'Score this short video script 1-5 on four axes. Be strict; 3 means usable.',
    'voice: sounds like the voice notes below, spoken and plain. tension: sets up a belief and turns it. evidence: specific, cites the evidence given, invents nothing. register: written for the ear, not the page.',
    `Voice notes: ${plan.skills.map((s) => s.slug).join(', ') || 'none'}; pace ${plan.wpm} wpm; their lines: ${plan.lines.slice(0, 5).map((l) => `"${l}"`).join(' ')}`,
    `Evidence available: ${plan.evidence.map((e) => `"${e.hookText}" (${e.breakout === null ? 'n/a' : fmtRatio(e.breakout)})`).join('; ')}`,
    `Hook: ${body.hooks[body.hookChoice]?.spoken ?? ''}`,
    ...body.sections.map((s, k) => `${k}. ${s.type}: ${s.spoken}`),
    `CTA: ${body.cta}`,
    'For any score under 3, set blame.<axis> to the section index it is about (or null).',
    'Reply with STRICT JSON only: {"voice":1,"tension":1,"evidence":1,"register":1,"blame":{}}',
  ].join('\n');
}

async function scoreBody(store: LabStore, body: LabScriptBody, plan: ScriptPlan, deps: ScriptDeps): Promise<{ scores: ModelScores | null; blame: CheckReply['blame'] }> {
  const ask = deps.askCheck ?? ((p: string) => claudeJson(p, CheckReplySchema, { timeoutMs: 90_000 }));
  try {
    const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'script', actor: 'claude-cli:check', input: { promptVersion: SCRIPT_PROMPT_VERSION, step: 'model-check' }, override: deps.override, now: deps.now }, {
      dry: () => ({ result: { scores: { voice: 4, tension: plan.idea.tension ? 4 : 3, evidence: 4, register: 4 }, blame: {} } }),
      live: async () => {
        const res = await ask(checkPrompt(body, plan));
        if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `model check failed: ${res.error}`);
        const { blame, ...scores } = res.data;
        return { result: { scores, blame }, units: 1, actualUsd: 0 };
      },
    });
    return out.result;
  } catch {
    // an unavailable check leaves the gate unscored (honest), it never invents a score
    return { scores: null, blame: {} };
  }
}

export async function gateBody(store: LabStore, body: LabScriptBody, plan: ScriptPlan, deps: ScriptDeps): Promise<LabGate> {
  const det = deterministicGate(body, { bannedWords: plan.bannedWords });
  const { scores, blame } = await scoreBody(store, body, plan, deps);
  // 07 7.6: the rule pack runs after the v1 gate on every new version
  return gateWithRules(store, plan.idea, body, gateWithScores(det, scores, blame ?? {}));
}

const feedbackOf = (gate: LabGate): string[] => [
  ...gate.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}${c.section !== null ? ` (section ${c.section})` : ''}`),
  ...(gate.rules ?? []).filter((r) => !r.ok && r.severity !== 'info').map((r) => `${r.label}: ${r.detail}${r.section !== null ? ` (section ${r.section})` : ''}`),
];

async function draft(store: LabStore, plan: ScriptPlan, context: string, feedback: string[], deps: ScriptDeps): Promise<LabScriptBody> {
  const ask = deps.ask ?? ((p: string) => claudeJson(p, ScriptReplySchema, { timeoutMs: 180_000 }));
  const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'script', actor: 'claude-cli', input: { promptVersion: SCRIPT_PROMPT_VERSION, ideaId: plan.idea.id, retry: feedback.length > 0 }, override: deps.override, now: deps.now }, {
    dry: () => ({ result: dryBody(plan) }),
    live: async () => {
      const res = await ask(scriptPrompt(plan, context, feedback));
      if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `script generation failed: ${res.error}`);
      return { result: toBody(res.data, plan), units: 1, actualUsd: 0 };
    },
  });
  return out.result;
}

/* ── generate / regenerate / edit ─────────────────────────────────────── */

export type ScriptResult = { scriptId: string; version: LabScriptVersion; attempts: number };

/** Write a script for an idea: draft, gate, regenerate once on failure, keep the better attempt. */
export async function generateScript(store: LabStore, ideaId: string, deps: ScriptDeps & { durationS?: number } = {}): Promise<ScriptResult> {
  const now = deps.now ?? new Date();
  const plan = planScript(store, ideaId, { durationS: deps.durationS, now, readSkill: deps.readSkill });
  // dry drafts never read the prompt, so they never ask Optimal Engine either
  const context = deps.context ?? (isDry() ? '' : await brainContext());
  let body = await draft(store, plan, context, [], deps);
  let gate = await gateBody(store, body, plan, deps);
  let attempts = 1;
  if (!gate.passed) {
    attempts = 2;
    const body2 = await draft(store, plan, context, feedbackOf(gate), deps);
    const gate2 = await gateBody(store, body2, plan, deps);
    if (gateBadness(gate2) <= gateBadness(gate)) {
      body = body2;
      gate = gate2;
    }
  }
  const scriptId = `script-${randomUUID().slice(0, 8)}`;
  const version: LabScriptVersion = { scriptId, version: 1, body, gate, createdAt: now.toISOString(), editDiff: null };
  store.transaction(() => {
    store.scripts.upsert({ id: scriptId, ideaId, title: plan.idea.title, status: 'draft', publishedPostId: null, createdAt: now.toISOString() });
    store.scripts.addVersion(version);
  });
  return { scriptId, version, attempts };
}

export function sectionPrompt(body: LabScriptBody, index: number, plan: ScriptPlan, context: string, ruleFeedback: string[] = []): string {
  const s = body.sections[index];
  const budget = sectionBudgets(body)[index];
  const head = scriptPrompt(plan, context).split('## CONTRAST')[0].split('## LOOPS')[0].trim();
  const contrast = plan.arm === 'control' ? '' : contrastBlock(plan.grounding, (id) => plan.handles[id] ?? id, { short: true });
  return [
    head,
    ...(contrast ? [contrast] : []),
    ...(ruleFeedback.length ? ['## FIX THESE IN THIS SECTION', ...ruleFeedback.map((f) => `- ${f}`)] : []),
    '## THE SCRIPT SO FAR',
    ...body.sections.map((x, k) => `${k}. ${x.type}${k === index ? ' (REWRITE THIS ONE)' : ''}: ${x.spoken}`),
    '',
    `Rewrite section ${index} (${s.type}, ${s.startPct}-${s.endPct}%) in exactly about ${budget.budget} spoken words so it flows from section ${index - 1} into section ${index + 1}.`,
    'Rules: no dashes of any kind, no hedging, never invent a number.',
    `Reply with STRICT JSON only: {"type":"${s.type}","spoken":"","onScreen":"","visualNote":""}`,
  ].join('\n');
}

/** Rewrite one section; a new version with a fresh gate. */
export async function regenerateSection(store: LabStore, scriptId: string, index: number, deps: ScriptDeps = {}): Promise<ScriptResult> {
  const script = store.scripts.get(scriptId);
  const cur = store.scripts.latestVersion(scriptId);
  if (!script || !cur) throw new Error('no such script');
  if (!script.ideaId) throw new Error('this script has no idea to plan from');
  if (index < 0 || index >= cur.body.sections.length) throw new Error('no such section');
  const now = deps.now ?? new Date();
  const plan = planScript(store, script.ideaId, { durationS: cur.body.durationS, now, readSkill: deps.readSkill, platform: bodyV2(cur.body).platform, arm: bodyV2(cur.body).arm });
  plan.wpm = cur.body.wpm;
  if (cur.body.grounding && cur.body.grounding.exemplars.length) plan.grounding = { ...cur.body.grounding };
  // dry drafts never read the prompt, so they never ask Optimal Engine either
  const context = deps.context ?? (isDry() ? '' : await brainContext());
  const ask = deps.askSection ?? ((p: string) => claudeJson(p, SectionReplySchema, { timeoutMs: 90_000 }));
  const budget = sectionBudgets(cur.body)[index].budget;
  const out = await gatedCall(store, { provider: 'llm', line: 'llm', kind: 'script', actor: 'claude-cli:section', input: { promptVersion: SCRIPT_PROMPT_VERSION, scriptId, section: index }, override: deps.override, now }, {
    dry: () => {
      const d = dryBody({ ...plan, sections: cur.body.sections.map((s, k) => ({ type: s.type, startPct: s.startPct, endPct: s.endPct, budget: k === index ? budget : 1 })) });
      return { result: { spoken: d.sections[index].spoken, onScreen: d.sections[index].onScreen, visualNote: d.sections[index].visualNote } };
    },
    live: async () => {
      const res = await ask(sectionPrompt(cur.body, index, plan, context, (cur.gate.rules ?? []).filter((r) => !r.ok && r.severity !== 'info' && r.section === index).map((r) => `${r.label}: ${r.detail}`)));
      if (!res.ok) throw new Error(res.unavailable ? 'the claude CLI is not on this host' : `section regenerate failed: ${res.error}`);
      return { result: res.data, units: 1, actualUsd: 0 };
    },
  });
  const body: LabScriptBody = { ...cur.body, sections: cur.body.sections.map((s, k) => (k === index ? { ...s, spoken: out.result.spoken.trim(), onScreen: out.result.onScreen.trim(), visualNote: out.result.visualNote.trim() } : s)) };
  const gate = await gateBody(store, body, plan, deps);
  const version: LabScriptVersion = { scriptId, version: cur.version + 1, body, gate, createdAt: now.toISOString(), editDiff: null };
  store.scripts.addVersion(version);
  return { scriptId, version, attempts: 1 };
}

/* ── edits as diffs ───────────────────────────────────────────────────── */

/** Longest-common-subsequence diff of two sentence lists: "-" removed, "+" added. */
export function diffLines(a: readonly string[], b: readonly string[]): string[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) out.push(`-${a[i++]}`);
    else out.push(`+${b[j++]}`);
  }
  return out;
}

/** The edit as a readable diff, one `@@ field @@` hunk per changed field. Empty string = no change. */
export function diffBodies(prev: LabScriptBody, next: LabScriptBody): string {
  const fields: [string, string, string][] = [
    ['hook', prev.hooks[prev.hookChoice]?.spoken ?? '', next.hooks[next.hookChoice]?.spoken ?? ''],
    ...next.sections.map((s, k): [string, string, string] => [`${k} ${s.type}`, prev.sections[k]?.spoken ?? '', s.spoken]),
    ...prev.sections.slice(next.sections.length).map((s, k): [string, string, string] => [`${next.sections.length + k} ${s.type}`, s.spoken, '']),
    ['cta', prev.cta, next.cta],
    ['caption', prev.caption, next.caption],
    ['titles', prev.titles.join('\n'), next.titles.join('\n')],
  ];
  const hunks: string[] = [];
  for (const [label, a, b] of fields) {
    if (a.trim() === b.trim()) continue;
    const split = (t: string) => (label === 'titles' ? t.split('\n') : sentences(t));
    hunks.push(`@@ ${label} @@`, ...diffLines(split(a), split(b)));
  }
  return hunks.join('\n');
}

/**
 * The UI trees post a hand edit as a patch: `{ hookChoice?, sections?: {spoken?, onScreen?}[] }`
 * (one entry per section, same order). A full body passes through unchanged; a patch is laid
 * over the current version so the stored version is always a complete body.
 */
export function applyEditPatch(cur: LabScriptBody, raw: unknown): unknown {
  if (LabScriptBodySchema.safeParse(raw).success || !raw || typeof raw !== 'object') return raw;
  const p = raw as { hookChoice?: unknown; sections?: unknown; cta?: unknown; caption?: unknown };
  // a patch names only these keys, at least one of them; anything else stays malformed
  const keys = Object.keys(p);
  if (keys.length === 0 || keys.some((k) => !['hookChoice', 'sections', 'cta', 'caption'].includes(k))) return raw;
  if (p.sections !== undefined && (!Array.isArray(p.sections) || p.sections.length !== cur.sections.length)) return raw;
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  const hookChoice = typeof p.hookChoice === 'number' && Number.isInteger(p.hookChoice) && p.hookChoice >= 0 && p.hookChoice < cur.hooks.length ? p.hookChoice : cur.hookChoice;
  const sections = Array.isArray(p.sections)
    ? cur.sections.map((sec, i) => {
        const e = (p.sections as unknown[])[i] as { spoken?: unknown; onScreen?: unknown } | null;
        return e && typeof e === 'object' ? { ...sec, spoken: str(e.spoken, sec.spoken), onScreen: str(e.onScreen, sec.onScreen) } : sec;
      })
    : cur.sections;
  return { ...cur, hookChoice, sections, cta: str(p.cta, cur.cta), caption: str(p.caption, cur.caption) };
}

/**
 * Save a hand edit as a new version. The diff is stored (it feeds the voice samples), the
 * deterministic gate runs again, and the model scores are cleared: an edit is the
 * operator's own words, so it is not re-scored by a model.
 */
export function saveEdit(store: LabStore, scriptId: string, rawBody: unknown, opts: { now?: Date } = {}): ScriptResult & { changed: boolean } {
  const cur = store.scripts.latestVersion(scriptId);
  if (!cur) throw new Error('no such script');
  const parsed = LabScriptBodySchema.safeParse(applyEditPatch(cur.body, rawBody));
  if (!parsed.success) throw new Error(`the edited script is malformed: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  const body: LabScriptBody = { ...parsed.data, hooks: parsed.data.hooks.map((h) => ({ ...h, words: wordCount(h.spoken) })) };
  for (const s of body.sections) LabBeatTypeSchema.parse(s.type);
  const diff = diffBodies(cur.body, body);
  if (!diff) return { scriptId, version: cur, attempts: 0, changed: false };
  const script = store.scripts.get(scriptId);
  const idea = script?.ideaId ? store.ideas.get(script.ideaId) : null;
  const banned = idea ? (() => {
    try {
      return planScript(store, idea.id, { durationS: body.durationS }).bannedWords;
    } catch {
      return [];
    }
  })() : [];
  const gate = gateWithRules(store, idea, body, deterministicGate(body, { bannedWords: banned }));
  const version: LabScriptVersion = { scriptId, version: cur.version + 1, body, gate, createdAt: (opts.now ?? new Date()).toISOString(), editDiff: diff };
  store.scripts.addVersion(version);
  return { scriptId, version, attempts: 0, changed: true };
}

/** Link a draft to the live post and append its first outcome when the post already has a read. */
export function markPublished(store: LabStore, scriptId: string, postId: string, opts: { now?: Date } = {}): { ok: true; noPrediction: boolean } | { ok: false; error: string } {
  const script = store.scripts.get(scriptId);
  if (!script) return { ok: false, error: 'no such script' };
  const post = store.posts.get(postId);
  if (!post || !post.isOwned) return { ok: false, error: 'pick one of your own posts' };
  store.scripts.markPublished(script.id, post.id);
  if (script.ideaId) store.ideas.setStatus(script.ideaId, 'used', { at: (opts.now ?? new Date()).toISOString() });
  recordOutcomes(store, opts);
  // 06 2.5 (lane L): link the frozen predictions; without one, Studio says the post will not count in the Ledger
  linkPredictionsToPost(store, script.id, post.id, opts.now ?? new Date());
  return { ok: true, noPrediction: !hasLivePrediction(store, script.id) };
}

export const familyName = (f: string) => (FORMAT_LABEL as Record<string, string>)[f] ?? f.replaceAll('_', ' ');
