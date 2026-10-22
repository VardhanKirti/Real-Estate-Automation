/**
 * Event naming and dedupe (05 6). Pure functions: a ping's name, its canonical key, and which
 * event it belongs to (rules R1 to R4, first hit wins).
 */
import type { LabEvent, LabEventPing } from '@/lib/schemas';
import { canonicalKey as urlKey } from '@/lib/lab/feeds';

const LAUNCH_VERB = /^(introducing|announcing|meet|launching|say hello to|releasing|welcome)\b[\s,:-]*/i;

export const VENDOR_WORDS = ['openai', 'anthropic', 'google', 'deepmind', 'meta', 'xai', 'mistral', 'alibaba', 'huggingface', 'microsoft', 'nvidia'] as const;
export const FAMILY_WORDS = ['gemini', 'claude', 'llama', 'mistral', 'qwen', 'grok', 'sora', 'veo', 'gpt', 'deepseek'] as const;
export const STOPWORDS: ReadonlySet<string> = new Set(['the', 'a', 'an', 'our', 'new', 'now', 'available', 'today', 'model']);

/** 05 6.3: an extra token from this list makes a different product. */
export const DISTINCT_SUFFIXES = ['mini', 'nano', 'pro', 'flash', 'lite', 'turbo', 'max', 'ultra', 'haiku', 'sonnet', 'opus', 'small', 'medium', 'large', 'vision', 'code', 'coder', 'realtime', 'audio', 'image', 'video'] as const;

const VERSION_RE = /^v?\d+(\.\d+)*[a-z]?$/;

/** 05 6.2 */
export function canonicalKey(name: string): string {
  let s = name.normalize('NFKC').toLowerCase().trim();
  s = s.replace(LAUNCH_VERB, '');
  s = s.split(':')[0];
  s = s.replace(/(?<=[a-z0-9])[_/-](?=[a-z0-9])/g, ' ').replace(/[_/]/g, ' ');
  s = s.replace(/\b([a-z]{3,})(\d)/g, '$1 $2');
  s = s.replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
  let tokens = s
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t && !STOPWORDS.has(t));
  if (tokens.length >= 3 && (VENDOR_WORDS as readonly string[]).includes(tokens[0]) && !(FAMILY_WORDS as readonly string[]).includes(tokens[0])) tokens = tokens.slice(1);
  return tokens.join('-');
}

export const splitKey = (key: string): string[] => key.split('-').filter(Boolean);
export const versionTokens = (key: string): string[] => splitKey(key).filter((t) => VERSION_RE.test(t));
export const keyTokens = (key: string): string[] => splitKey(key).filter((t) => !VERSION_RE.test(t));

/**
 * 05 6.1: drop a leading launch verb, cut at the first `:`, ` | `, ` (` or ` with `. A name of 1 to
 * 6 words with a capitalised word or a version token; else null (the LLM namer decides).
 */
export function nameFromTitle(title: string): string | null {
  let s = title.trim().replace(LAUNCH_VERB, '');
  const cuts = [s.indexOf(':'), s.indexOf(' | '), s.indexOf(' ('), s.search(/ with /i)].filter((i) => i > 0);
  if (cuts.length) s = s.slice(0, Math.min(...cuts));
  s = s.trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 6) return null;
  const hasCap = words.some((w) => /^[A-Z]/.test(w) || /[A-Z].*\d|\d.*[A-Z]/.test(w));
  const hasVersion = words.some((w) => /\d/.test(w) && VERSION_RE.test(w.toLowerCase().replace(/^[a-z]+-/, '')));
  return hasCap || hasVersion ? s : null;
}

/** 05 6.1: `Qwen/Qwen4-32B-Instruct-AWQ` gives `qwen4`. */
export function hfFamily(id: string): string {
  const name = (id.split('/')[1] ?? id).toLowerCase();
  return name
    .split(/[-_]/)
    .filter((t) => t && !/^(\d+(\.\d+)?[bmk]|a\d+b|instruct|it|chat|base|gguf|awq|gptq|fp8|bf16|int4|int8|mlx|\d+bit|preview|hf)$/.test(t))
    .join('-');
}

export type MatchRule = 'key' | 'url' | 'repo' | 'contain';
export type MatchCtx = { events: readonly LabEvent[]; pingsOf: (eventId: string) => readonly LabEventPing[] };

const DAY_MS = 86_400_000;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** 05 6.3 R4: containment of two keys. */
export function containMatch(pingKey: string, eventKey: string): boolean {
  if (!pingKey || !eventKey || pingKey === eventKey) return pingKey === eventKey && Boolean(pingKey);
  const va = versionTokens(pingKey), vb = versionTokens(eventKey);
  if (!sameSet(va, vb)) return false;
  const a = splitKey(pingKey), b = splitKey(eventKey);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return false;
  const shortNon = short.filter((t) => !VERSION_RE.test(t));
  const longNon = long.filter((t) => !VERSION_RE.test(t));
  if (!shortNon.every((t) => longNon.includes(t))) return false;
  const extra = longNon.filter((t) => !shortNon.includes(t));
  return !extra.some((t) => (DISTINCT_SUFFIXES as readonly string[]).includes(t));
}

const repoOf = (p: Pick<LabEventPing, 'source' | 'externalId'>): string | null => (p.source === 'hf_models' || p.source === 'hf_spaces' ? `hf:${hfFamily(p.externalId)}` : p.source === 'github' ? `gh:${p.externalId.toLowerCase()}` : null);

/**
 * 05 6.3: which event a ping belongs to. Events considered: candidate or confirmed, first seen
 * within 30 days of `at`. First hit wins.
 */
export function matchEvent(ping: { name: string | null; url: string; source: LabEventPing['source']; externalId: string }, at: string, ctx: MatchCtx): { eventId: string; rule: MatchRule } | null {
  const t = Date.parse(at);
  const live = ctx.events.filter((e) => (e.status === 'candidate' || e.status === 'confirmed') && Math.abs(t - Date.parse(e.firstSeenAt)) <= 30 * DAY_MS);
  const key = ping.name ? canonicalKey(ping.name) : '';
  if (key) {
    const r1 = live.find((e) => e.key === key || e.aliases.includes(key));
    if (r1) return { eventId: r1.id, rule: 'key' };
  }
  const u = ping.url ? urlKey({ url: ping.url, title: '' }) : '';
  if (u.startsWith('u:')) {
    const r2 = live.find((e) => ctx.pingsOf(e.id).some((p) => p.url && urlKey({ url: p.url, title: '' }) === u));
    if (r2) return { eventId: r2.id, rule: 'url' };
  }
  const repo = repoOf(ping);
  if (repo) {
    const r3 = live.find((e) => ctx.pingsOf(e.id).some((p) => repoOf(p) === repo));
    if (r3) return { eventId: r3.id, rule: 'repo' };
  }
  if (key) {
    const r4 = live.find((e) => Math.abs(t - Date.parse(e.firstSeenAt)) <= 14 * DAY_MS && [e.key, ...e.aliases].some((k) => containMatch(key, k)));
    if (r4) return { eventId: r4.id, rule: 'contain' };
  }
  return null;
}
