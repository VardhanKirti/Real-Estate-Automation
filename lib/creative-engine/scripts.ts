import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ANTI_INVENTION_RULE, claudeJson } from '@/lib/creative-engine/claude';
import { TONE_BANK, INTRO_BANK } from '@/lib/creative-engine/compose';
import { isDry } from '@/lib/creative-engine/dry';
import { countWords, secondsForWords, wordsForSeconds } from '@/lib/creative-engine/duration';
import { BeatSchema, type Angle, type Campaign, type Framework, type PoolAd, type Script, type ScriptControls, type ScriptVersion } from '@/lib/creative-engine/schemas';
import { FRAMEWORK_BANK } from '@/lib/creative-engine/frameworks';

export { FRAMEWORK_BANK };

/**
 * Scripting — frameworks declare beats; the model fills the beats; the
 * hook IS the first beat's spoken line (no separate hook field, which is
 * what made the standalone app's hook and script disagree). Word budget
 * is checked against the target duration and one tighten pass runs
 * before a warning shows. "No stage directions" is always on: the spoken
 * text pipes straight into an Arcads actor.
 */

const ScriptReplySchema = z.object({
  beats: z.array(z.object({ name: z.string().min(1).max(40), spoken: z.string().max(600), action: z.string().max(300).default('') })).min(1).max(8),
  cta: z.string().max(140),
  notes: z.string().max(300).default(''),
});

function proofFor(campaign: Campaign, angle: Angle): PoolAd[] {
  const pool = campaign.research?.pool ?? [];
  return angle.proofAdIds.map((id) => pool.find((a) => a.id === id)).filter((a): a is PoolAd => !!a);
}

function allocateSeconds(framework: Framework, beats: { spoken: string }[], targetSeconds: number | null): number[] {
  const shares = FRAMEWORK_BANK[framework].beats.map((b) => b.share);
  if (targetSeconds === null) return beats.map((b) => secondsForWords(countWords(b.spoken)));
  const total = shares.slice(0, beats.length).reduce((s, x) => s + x, 0) || 1;
  return beats.map((_, i) => Math.max(1, Math.round((targetSeconds * (shares[i] ?? 0.2)) / total)));
}

export function assemble(framework: Framework, reply: z.infer<typeof ScriptReplySchema>, controls: ScriptControls, n: number, by: ScriptVersion['by']): ScriptVersion {
  const seconds = allocateSeconds(framework, reply.beats, controls.targetSeconds);
  const beats = reply.beats.map((b, i) => BeatSchema.parse({ name: b.name, spoken: b.spoken.trim(), action: b.action.trim(), seconds: seconds[i] }));
  const fullScript = beats.map((b) => b.spoken).filter(Boolean).join(' ');
  const wordCount = countWords(fullScript);
  const fits = controls.targetSeconds === null ? true : wordCount <= wordsForSeconds(controls.targetSeconds);
  return { n, hook: beats[0]?.spoken ?? '', beats, cta: reply.cta.trim(), fullScript, wordCount, targetSeconds: controls.targetSeconds, fits, notes: reply.notes, at: new Date().toISOString(), by };
}

function dryReply(angle: Angle, framework: Framework, controls: ScriptControls): z.infer<typeof ScriptReplySchema> {
  const fw = FRAMEWORK_BANK[framework];
  const budget = controls.targetSeconds ? wordsForSeconds(controls.targetSeconds) : 60;
  const per = Math.max(4, Math.floor(budget / fw.beats.length));
  const words = (s: string) => s.split(' ').slice(0, per).join(' ');
  return {
    beats: fw.beats.map((b, i) => ({ name: b.name, spoken: words(i === 0 ? `${angle.hookPattern.replace(/"/g, '') || angle.title}. Here is what actually happened when I tried it.` : `${b.framing}, in plain words, for the ${angle.title.toLowerCase()} angle, kept short on purpose.`), action: `${INTRO_BANK[controls.intro].split(',')[0]}` })),
    cta: controls.cta || 'Link in bio.',
    notes: 'dry run: templated beats',
  };
}

export async function writeScript(campaign: Campaign, angle: Angle, framework: Framework, controls: ScriptControls, opts: { instruction?: string; priorVersion?: ScriptVersion } = {}): Promise<{ version: Omit<ScriptVersion, 'n'>; by: ScriptVersion['by'] }> {
  const by: ScriptVersion['by'] = isDry() ? 'dry' : 'claude';
  if (isDry()) {
    const v = assemble(framework, dryReply(angle, framework, controls), controls, 0, 'dry');
    const { n: _n, ...rest } = v;
    return { version: rest, by };
  }
  const fw = FRAMEWORK_BANK[framework];
  const proof = proofFor(campaign, angle);
  const budget = controls.targetSeconds ? wordsForSeconds(controls.targetSeconds) : null;
  const tone = TONE_BANK[controls.tone];
  const prompt = [
    'You write spoken UGC ad scripts that an AI actor will read to camera. Output is spoken words only: no stage directions, no brackets, no emoji, no hashtags.',
    `Concept: "${campaign.concept.text}"${campaign.concept.product ? ` · Product: ${campaign.concept.product}` : ''}${campaign.concept.audience ? ` · Audience: ${campaign.concept.audience}` : ''}`,
    `Angle: ${angle.title} — ${angle.thesis}${angle.hookPattern ? ` · hook pattern: ${angle.hookPattern}` : ''}`,
    'Proof hooks from ads still running (match their energy, do not copy them):',
    ...proof.map((a) => `- "${a.hook ?? '(no hook)'}" (${a.brand}, ${a.daysRunning}d live)`),
    `Framework: ${fw.label}. Beats in order: ${fw.beats.map((b) => `${b.name} (${b.framing})`).join('; ')}.`,
    `Tone: ${tone.label} — ${tone.cue}. Product intro: ${INTRO_BANK[controls.intro]}.`,
    controls.cta ? `CTA must be exactly or close to: "${controls.cta}"` : 'End with one clear CTA.',
    budget ? `Hard budget: ${budget} spoken words total (${controls.targetSeconds}s at 2.5 words/s). Fewer is better.` : 'No length cap (briefing only), but stay under 150 words.',
    opts.priorVersion ? `Previous version:\n${opts.priorVersion.beats.map((b) => `${b.name}: ${b.spoken}`).join('\n')}` : '',
    opts.instruction ? `Instruction for this rewrite: ${opts.instruction}` : '',
    ANTI_INVENTION_RULE,
    'Reply with STRICT JSON only: {"beats":[{"name":"","spoken":"","action":"what is on screen, 1 short clause"}],"cta":"","notes":""}. The first beat\'s spoken line is the hook. No markdown.',
  ]
    .filter(Boolean)
    .join('\n');

  let res = await claudeJson(prompt, ScriptReplySchema, { timeoutMs: 120_000 });
  if (!res.ok) throw new Error(res.unavailable ? 'Claude engine not present on this host' : `script writing failed: ${res.error}`);
  let v = assemble(framework, res.data, controls, 0, 'claude');
  if (!v.fits && budget) {
    // one tighten pass, then the warning shows
    const tighten = `${prompt}\n\nYour script was ${v.wordCount} words; the budget is ${budget}. Cut adjectives and repeated ideas, keep every beat, reply again with STRICT JSON only.`;
    res = await claudeJson(tighten, ScriptReplySchema, { timeoutMs: 120_000, retry: false });
    if (res.ok) v = assemble(framework, res.data, controls, 0, 'claude');
  }
  const { n: _n, ...rest } = v;
  return { version: rest, by };
}

export function newScript(angleId: string, framework: Framework, controls: ScriptControls): Script {
  return { id: `scr-${randomUUID().slice(0, 6)}`, angleId, framework, controls, versions: [], approvedVersion: null, createdAt: new Date().toISOString() };
}

/** Manual edit of a version → a new version tagged `edit`, recomputed. */
export function editedVersion(prev: ScriptVersion, beats: { name: string; spoken: string; action: string; seconds: number }[], cta: string): Omit<ScriptVersion, 'n'> {
  const parsed = beats.map((b) => BeatSchema.parse(b));
  const fullScript = parsed.map((b) => b.spoken).filter(Boolean).join(' ');
  const wordCount = countWords(fullScript);
  const fits = prev.targetSeconds === null ? true : wordCount <= wordsForSeconds(prev.targetSeconds);
  return { hook: parsed[0]?.spoken ?? '', beats: parsed, cta, fullScript, wordCount, targetSeconds: prev.targetSeconds, fits, notes: 'edited', at: new Date().toISOString(), by: 'edit' };
}
