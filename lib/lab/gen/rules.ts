/**
 * The script rule pack (07 7.6): a second deterministic layer that runs after the v1 gate on
 * every new version (draft, regenerate, section regenerate, hand edit, duration, hook and
 * platform changes). Pure functions; the gate's `passed` becomes "v1 checks pass AND no rule
 * with severity block fails" (`applyRules`).
 */
import type { LabGate, LabPlatform, LabRuleId, LabRuleResult, LabScriptBody } from '@/lib/schemas';
import { LEXICON_CITATION, concreteness, hookTokens, isReferent, type ConcretenessBand, type Lexicon } from '@/lib/lab/gen/lexicon';
import { LINKEDIN_BAIT, OUTGROUP_SNEER, X_HOSTILITY, firstRiskMatch } from '@/lib/lab/gen/risk';

export const RULEPACK_VERSION = 'rules-v1';

export type ScriptPlatform = LabPlatform | 'multi';

const SRC = {
  concreteness: `Aubin Le Quere and Matias 2025; lexicon: ${LEXICON_CITATION}`,
  referent: 'Loewenstein 1994; Kang et al. 2009; Aubin Le Quere and Matias 2025',
  loops: 'Alaybek et al. 2022 (peak-end, r 0.58); Kang et al. 2009',
  originality: 'Instagram recommendations for mostly-repost accounts (2026-04-30); YouTube on re-uploads that add nothing (2026-10)',
  linkedin: 'LinkedIn platform guidance relayed in the platform-algorithms report (practitioner)',
  x: 'xai-org/x-algorithm params dated 2026-08-13 (mute -58.8, like 0.5; a weight ratio, not counts)',
  outgroup: 'Platform-algorithms report: contrast with the old way, not the people still using it',
} as const;

const LABEL: Record<LabRuleId, string> = {
  'hook-concreteness': 'Hook concreteness',
  'hook-referent': 'One referent, one withheld fact',
  'loops-closed': 'Every loop closes',
  'promise-by-80': 'Promise paid before 80%',
  'late-peak': 'A second peak late',
  'end-on-payoff': 'Ends on the payoff',
  'one-cta': 'One CTA',
  originality: 'A beat of your own',
  'risk-linkedin-bait': 'No LinkedIn bait',
  'risk-x-hostility': 'No hostility on X',
  'risk-outgroup': 'No sneering at people',
};

/** Rule metadata for the Playbook Rules list (7.6.6). `agrees` is filled by the route. */
export type RuleMeta = {
  id: LabRuleId;
  label: string;
  why: string;
  source: string;
  severity: Record<ScriptPlatform, 'block' | 'warn' | 'info' | null>;
};

const ALL_PLATFORMS: ScriptPlatform[] = ['instagram', 'tiktok', 'youtube', 'linkedin', 'twitter', 'multi'];
const sev = (f: (p: ScriptPlatform) => 'block' | 'warn' | 'info' | null) => Object.fromEntries(ALL_PLATFORMS.map((p) => [p, f(p)])) as Record<ScriptPlatform, 'block' | 'warn' | 'info' | null>;

export const RULE_META: RuleMeta[] = [
  { id: 'hook-concreteness', label: LABEL['hook-concreteness'], why: 'Concrete headlines won below a test mean of 2.58 and lost above 3.06 across 8,977 tests.', source: SRC.concreteness, severity: sev(() => 'warn') },
  { id: 'hook-referent', label: LABEL['hook-referent'], why: 'Curiosity needs a named thing and one gap: name the tool, number or person and hold one fact back.', source: SRC.referent, severity: sev(() => 'warn') },
  { id: 'loops-closed', label: LABEL['loops-closed'], why: 'An open loop that never pays off leaves the viewer feeling cheated.', source: SRC.loops, severity: sev(() => 'block') },
  { id: 'promise-by-80', label: LABEL['promise-by-80'], why: 'Pay the hook before the viewer gives up on it.', source: SRC.loops, severity: sev(() => 'warn') },
  { id: 'late-peak', label: LABEL['late-peak'], why: 'Memory of a video leans on its peak and its end (peak-end).', source: SRC.loops, severity: sev(() => 'warn') },
  { id: 'end-on-payoff', label: LABEL['end-on-payoff'], why: 'The end is remembered most; end on the payoff or a callback, then the CTA.', source: SRC.loops, severity: sev(() => 'warn') },
  { id: 'one-cta', label: LABEL['one-cta'], why: 'Two asks split the action; one is followed more often.', source: SRC.loops, severity: sev(() => 'warn') },
  { id: 'originality', label: LABEL.originality, why: 'React content needs something only you did or saw, or the platforms cut its reach.', source: SRC.originality, severity: sev((p) => (p === 'instagram' || p === 'youtube' ? 'block' : 'warn')) },
  { id: 'risk-linkedin-bait', label: LABEL['risk-linkedin-bait'], why: 'LinkedIn demotes posts that ask for engagement.', source: SRC.linkedin, severity: sev((p) => (p === 'linkedin' ? 'block' : p === 'multi' ? 'warn' : null)) },
  { id: 'risk-x-hostility', label: LABEL['risk-x-hostility'], why: 'On X one mute costs about what 118 likes earn (a weight ratio).', source: SRC.x, severity: sev((p) => (p === 'twitter' ? 'block' : p === 'multi' ? 'warn' : null)) },
  { id: 'risk-outgroup', label: LABEL['risk-outgroup'], why: 'Sneering at people draws mutes and hides; contrast with the old way instead.', source: SRC.outgroup, severity: sev(() => 'warn') },
];

export type RuleContext = {
  /** null = the lexicon is not installed (the concreteness rule becomes info) */
  lexicon: Lexicon | null;
  entities?: ReadonlySet<string>;
  band: ConcretenessBand;
  /** 7.6.4: the idea is an event idea, the hook form is news_react, or an evidence post is a news_breakdown */
  isReact: boolean;
};

/** The body's v2 fields with 07's defaults for v1 versions (AC-07-25). */
export function bodyV2(b: LabScriptBody) {
  return {
    platform: b.platform ?? ('multi' as ScriptPlatform),
    loops: b.loops ?? [],
    withheld: b.withheld ?? '',
    peakSection: b.peakSection ?? null,
    endType: b.endType ?? null,
    arm: b.arm ?? 'grounded',
    armP: b.armP ?? null,
  };
}

const STOP = new Set(['that', 'this', 'with', 'from', 'have', 'what', 'when', 'your', 'they', 'them', 'then', 'than', 'there', 'their', 'just', 'like', 'into', 'about', 'will', 'were', 'been', 'only', 'some', 'more', 'most', 'also', 'very', 'over', 'much', 'here', 'where', 'which', 'while', 'would', 'could', 'should', 'does', 'doing', 'done', 'every', 'thing', 'things', 'because', 'after', 'before', 'really', 'actually', 'still']);

/** Content words: 4 or more letters, not a stop word, lower-cased. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => w.replace(/'/g, '')).filter((w) => w.length >= 4 && !STOP.has(w));
}

const hasWord = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);

const sentenceCount = (s: string) => s.trim() ? s.trim().split(/[.!?]+\s+/).filter((x) => x.trim()).length : 0;

function result(id: LabRuleId, severity: LabRuleResult['severity'], ok: boolean, detail: string, section: number | null, value: number | null = null, source?: string): LabRuleResult {
  const meta = RULE_META.find((m) => m.id === id)!;
  return { id, severity, ok, label: LABEL[id], detail, section, value, source: source ?? meta.source };
}

const fmt2 = (x: number) => x.toFixed(2);

export function hookConcreteness(body: LabScriptBody, ctx: RuleContext): LabRuleResult {
  if (!ctx.lexicon) return result('hook-concreteness', 'info', true, 'Lexicon not installed. Fetch it in Setup.', 0);
  const hook = body.hooks[body.hookChoice] ?? body.hooks[0];
  const c = concreteness(hook?.spoken ?? '', ctx.lexicon, ctx.entities);
  if (c.score === null) return result('hook-concreteness', 'warn', true, 'Not enough known words to score.', 0);
  const { lo, hi } = ctx.band;
  const bandName = ctx.band.source === 'yours' ? `your sweet spot (n ${ctx.band.n})` : 'the niche prior (news headlines, 2013 to 2015)';
  if (c.score < lo) return result('hook-concreteness', 'warn', false, `Concreteness ${fmt2(c.score)}. Below ${fmt2(lo)}: name the tool, number or person.`, 0, c.score);
  if (c.score > hi) return result('hook-concreteness', 'warn', false, `Concreteness ${fmt2(c.score)}. Above ${fmt2(hi)}: hold one thing back. Never withhold the topic itself.`, 0, c.score);
  return result('hook-concreteness', 'warn', true, `Concreteness ${fmt2(c.score)}, inside ${bandName} ${fmt2(lo)} to ${fmt2(hi)}.`, 0, c.score);
}

export function hookReferent(body: LabScriptBody, ctx: RuleContext): LabRuleResult {
  const hook = body.hooks[body.hookChoice] ?? body.hooks[0];
  const spoken = hook?.spoken ?? '';
  const lex = ctx.lexicon ?? { words: new Map<string, number>(), bigrams: new Map<string, number>() };
  const referent = hookTokens(spoken).some((t) => isReferent(t.token, t.sentenceStart, lex, ctx.entities));
  if (!referent) return result('hook-referent', 'warn', false, 'No named tool, number or person in the hook.', 0);
  const withheld = bodyV2(body).withheld.trim();
  if (!withheld) return result('hook-referent', 'warn', false, 'The script does not say what the hook holds back.', 0);
  const hookText = `${spoken}\n${hook?.onScreen ?? ''}`.toLowerCase();
  for (const w of [...new Set(contentWords(withheld))]) {
    const count = (hookText.match(new RegExp(`(^|[^\\p{L}\\p{N}])${w}(?=$|[^\\p{L}\\p{N}])`, 'gu')) ?? []).length;
    if (count > 1) return result('hook-referent', 'warn', false, `The hook gives away what it should hold back: "${w}".`, 0);
  }
  return result('hook-referent', 'warn', true, 'One named referent, one fact held back.', 0);
}

export function loopRules(body: LabScriptBody): LabRuleResult[] {
  const { loops, peakSection, endType } = bodyV2(body);
  const secs = body.sections;
  const out: LabRuleResult[] = [];
  const typeOf = (i: number | null) => (i !== null && secs[i] ? secs[i].type : 'the script');
  // loops-closed (block)
  if (loops.length === 0) out.push(result('loops-closed', 'info', true, 'No loops declared.', null));
  else {
    let bad = false;
    for (const l of loops) {
      if (l.closes === null || l.closes < l.opens || !secs[l.closes]) {
        out.push(result('loops-closed', 'block', false, `Loop ${l.id} opens in ${typeOf(l.opens)} and never closes.`, secs[l.opens] ? l.opens : null));
        bad = true;
        continue;
      }
      const words = contentWords(l.answer);
      if (words.length === 0 || !words.some((w) => hasWord(secs[l.closes!].spoken, w))) {
        out.push(result('loops-closed', 'block', false, `Loop ${l.id}'s answer is not in ${typeOf(l.closes)}.`, l.closes));
        bad = true;
      }
    }
    if (!bad) out.push(result('loops-closed', 'block', true, `${loops.length} ${loops.length === 1 ? 'loop opens and closes' : 'loops open and close'}.`, null));
  }
  // promise-by-80 (warn)
  const hookLoop = loops.find((l) => l.opens === 0);
  if (!hookLoop) out.push(result('promise-by-80', 'warn', true, 'No hook promise declared.', null));
  else if (hookLoop.closes === null || !secs[hookLoop.closes]) out.push(result('promise-by-80', 'warn', false, "The hook's promise is never paid. Pay it before 80%.", 0));
  else {
    const end = secs[hookLoop.closes].endPct;
    out.push(result('promise-by-80', 'warn', end <= 80, end <= 80 ? `Paid by ${Math.round(end)}%.` : `The hook's promise is paid at ${Math.round(end)}%. Pay it before 80%.`, end <= 80 ? null : hookLoop.closes, end));
  }
  // late-peak (warn)
  const latePeak = (peakSection !== null && secs[peakSection] && secs[peakSection].startPct >= 75) || secs.some((s) => s.startPct >= 75 && (s.type === 'reveal' || s.type === 'payoff'));
  out.push(result('late-peak', 'warn', latePeak, latePeak ? 'A second peak sits in the last quarter.' : 'No second peak in the last quarter.', null));
  // end-on-payoff (warn)
  let lastNonCta = -1;
  for (let i = secs.length - 1; i >= 0; i--) if (secs[i].type !== 'cta') {
    lastNonCta = i;
    break;
  }
  const lastType = lastNonCta >= 0 ? secs[lastNonCta].type : 'nothing';
  const endsWell = (lastNonCta >= 0 && (secs[lastNonCta].type === 'payoff' || secs[lastNonCta].type === 'reveal')) || endType === 'payoff' || endType === 'callback';
  out.push(result('end-on-payoff', 'warn', endsWell, endsWell ? 'Ends on the payoff.' : `The script ends on ${lastType}. End on the payoff or a callback, then the CTA.`, endsWell || lastNonCta < 0 ? null : lastNonCta));
  // one-cta (warn)
  const ctaSections = secs.filter((s) => s.type === 'cta').length;
  const ctaSentences = sentenceCount(body.cta);
  const n = Math.max(ctaSections, ctaSentences);
  const oneCta = ctaSections <= 1 && ctaSentences <= 1;
  out.push(result('one-cta', 'warn', oneCta, oneCta ? 'One CTA.' : `${n} CTAs. Keep one.`, null, n));
  return out;
}

const FIRST_PERSON = /\b(I|I'm|I've|I'd|my|me)\b/;
const FIRST_PERSON_LOWER = /\b(my|me)\b/i;
const OWN_BEAT_TYPES = new Set(['demo', 'evidence', 'claim', 'reveal', 'payoff']);
const CREDIT = /\b(credit to|via @|reposting|clip from)/i;

export function originality(body: LabScriptBody, ctx: RuleContext): LabRuleResult[] {
  if (!ctx.isReact) return [];
  const platform = bodyV2(body).platform;
  const severity = platform === 'instagram' || platform === 'youtube' ? 'block' : 'warn';
  const own = body.sections.some((s) => OWN_BEAT_TYPES.has(s.type) && (FIRST_PERSON.test(s.spoken) || FIRST_PERSON_LOWER.test(s.spoken)) && (s.spoken.match(/\S+/g) ?? []).length >= 20);
  const out = [result('originality', severity, own, own ? 'Has a beat of your own.' : 'React script with no beat of your own. Add a section where you show or say what you did.', null)];
  const texts = [...body.sections.map((s, i) => ({ t: `${s.spoken}\n${s.onScreen}`, i })), { t: body.cta, i: null as number | null }];
  const credit = texts.find((x) => CREDIT.test(x.t));
  if (credit) out.push(result('originality', 'warn', false, 'Credit lines do not count as adding something. Add your own beat.', credit.i));
  return out;
}

export function riskRules(body: LabScriptBody): LabRuleResult[] {
  const platform = bodyV2(body).platform;
  const hook = body.hooks[body.hookChoice] ?? body.hooks[0];
  const texts = [
    ...(hook ? [{ text: `${hook.spoken}\n${hook.onScreen}`, section: 0 as number | null }] : []),
    ...body.sections.map((s, i) => ({ text: `${s.spoken}\n${s.onScreen}`, section: i as number | null })),
    { text: body.cta, section: null },
    { text: body.caption, section: null },
  ];
  const out: LabRuleResult[] = [];
  if (platform === 'linkedin' || platform === 'multi') {
    const m = firstRiskMatch(LINKEDIN_BAIT, texts);
    out.push(result('risk-linkedin-bait', platform === 'linkedin' ? 'block' : 'warn', !m, m ? `"${m.match}" reads as engagement bait on LinkedIn.` : 'No engagement bait.', m?.section ?? null));
  }
  if (platform === 'twitter' || platform === 'multi') {
    const m = firstRiskMatch(X_HOSTILITY, texts);
    out.push(result('risk-x-hostility', platform === 'twitter' ? 'block' : 'warn', !m, m ? `"${m.match}" aims at people. On X, one mute costs about what 118 likes earn. Contrast with the old way instead.` : 'No hostility.', m?.section ?? null));
  }
  const s = firstRiskMatch(OUTGROUP_SNEER, texts);
  out.push(result('risk-outgroup', 'warn', !s, s ? `"${s.match}" sneers at people. Contrast with the old way, not the people still using it.` : 'No sneering.', s?.section ?? null));
  return out;
}

/** Every rule on one body, in the 7.6 order. */
export function runRules(body: LabScriptBody, ctx: RuleContext): LabRuleResult[] {
  return [hookConcreteness(body, ctx), hookReferent(body, ctx), ...loopRules(body), ...originality(body, ctx), ...riskRules(body)];
}

/** passed = v1 checks all ok AND every rule with severity block is ok. */
export function applyRules(gate: LabGate, rules: LabRuleResult[]): LabGate {
  return { ...gate, rules, rulesVersion: RULEPACK_VERSION, passed: gate.checks.every((c) => c.ok) && rules.every((r) => r.severity !== 'block' || r.ok) };
}

/** Header counts (7.6.6): failing block rules plus failing v1 checks to fix; failing warn rules to consider. */
export function gateCounts(gate: LabGate): { toFix: number; toConsider: number } {
  const rules = gate.rules ?? [];
  return {
    toFix: gate.checks.filter((c) => !c.ok).length + rules.filter((r) => r.severity === 'block' && !r.ok).length,
    toConsider: rules.filter((r) => r.severity === 'warn' && !r.ok).length,
  };
}

/**
 * The Playbook "agrees" column (7.6.6): only hook-concreteness can be yes/no in v2 (an adopted
 * band overlapping the prior is yes, else no); loop, referent and originality rules wait on
 * retention data; the risk rules cannot be tested from public data.
 */
export function ruleAgreement(id: LabRuleId, bands: readonly { n: number; value: { lo: number; hi: number } }[], prior: readonly [number, number]): { agrees: 'yes' | 'no' | 'not enough yet' | 'not testable from public data'; n: number } {
  if (id === 'risk-linkedin-bait' || id === 'risk-x-hostility' || id === 'risk-outgroup') return { agrees: 'not testable from public data', n: 0 };
  if (id === 'hook-concreteness') {
    const adopted = bands.filter((b) => typeof b.value?.lo === 'number' && typeof b.value?.hi === 'number');
    if (!adopted.length) return { agrees: 'not enough yet', n: 0 };
    const n = adopted.reduce((a, b) => a + b.n, 0);
    const overlaps = adopted.some((b) => b.value.lo <= prior[1] && b.value.hi >= prior[0]);
    return { agrees: overlaps ? 'yes' : 'no', n };
  }
  return { agrees: 'not enough yet', n: 0 };
}
