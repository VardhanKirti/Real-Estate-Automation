/**
 * The store side of the rule pack (07 7.6): the context one script's rules run in (lexicon,
 * entity list, the concreteness band for its family, whether it is a react script) and the
 * one call every version path makes: `gateWithRules(store, scriptIdeaId, body, gate)`.
 */
import type { LabGate, LabIdea, LabPlatform, LabScriptBody } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { bandFor, labEntities, loadLexicon, type Lexicon } from '@/lib/lab/gen/lexicon';
import { applyRules, runRules, type RuleContext, type ScriptPlatform } from '@/lib/lab/gen/rules';

const DAY = 86_400_000;

/** 7.6.4: the idea is an event idea, the chosen hook is news_react, or an evidence post is a news_breakdown. */
export function isReactScript(store: LabStore, idea: LabIdea | null, body: LabScriptBody): boolean {
  if (idea?.source === 'event') return true;
  const hook = body.hooks[body.hookChoice] ?? body.hooks[0];
  if (hook?.form === 'news_react') return true;
  return (idea?.evidence ?? []).some((e) => store.dissections.get(e.postId)?.structureType === 'news_breakdown');
}

export function ruleContext(store: LabStore, idea: LabIdea | null, body: LabScriptBody, opts: { lexicon?: Lexicon | null } = {}): RuleContext {
  return {
    lexicon: opts.lexicon === undefined ? loadLexicon() : opts.lexicon,
    entities: labEntities(store),
    band: bandFor(store, idea?.formatFamily ?? null),
    isReact: isReactScript(store, idea, body),
  };
}

/** Rules on top of a v1 gate; `passed` = v1 checks pass AND no block rule fails. */
export function gateWithRules(store: LabStore, idea: LabIdea | null, body: LabScriptBody, gate: LabGate, opts: { lexicon?: Lexicon | null } = {}): LabGate {
  return applyRules(gate, runRules(body, ruleContext(store, idea, body, opts)));
}

/**
 * 7.6 platform default: the most common platform among the idea's evidence posts when 2 or
 * more share it; else the operator's main platform by owned posts in the last 90 days; else multi.
 */
export function defaultPlatform(store: LabStore, idea: LabIdea | null, now: Date = new Date()): ScriptPlatform {
  const count = (xs: LabPlatform[]) => {
    const m = new Map<LabPlatform, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const ev = count((idea?.evidence ?? []).map((e) => store.posts.get(e.postId)?.platform).filter((p): p is LabPlatform => Boolean(p)));
  if (ev[0] && ev[0][1] >= 2) return ev[0][0];
  const since = now.getTime() - 90 * DAY;
  const own = count(store.posts.all().filter((p) => p.isOwned && p.postedAt && Date.parse(p.postedAt) >= since).map((p) => p.platform));
  return own[0]?.[0] ?? 'multi';
}
