/**
 * Novelty tag (05 section 8). Rules N1 to N4 are deterministic; N5 asks the local claude CLI
 * once per batch through an injected `ask` (never in dry).
 */
import { z } from 'zod';
import { LabNoveltySchema, type LabEvent, type LabEventPing, type LabNovelty } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { FAMILY_WORDS, keyTokens, splitKey, versionTokens } from '@/lib/lab/radar/names';

/** 05 8 [LIVE-CHECK LC-05-4]: versions as of 2026-10-11. */
export const SEED_FAMILIES = ['gpt 6', 'claude 5.5', 'gemini 4', 'llama 4', 'grok 4', 'qwen 4', 'deepseek r1', 'mistral large 4', 'sora 2', 'veo 4'] as const;

export const NOVELTY_PRIORS: Record<LabNovelty, { medianLift: number | null; n: number; note: string }> = {
  new_category: { medianLift: 2.8, n: 8, note: 'Jev, 7 channels' },
  new_flagship: { medianLift: 1.36, n: 34, note: 'GPT-6 Astra (30, first wave 1.94) and Gemini 4 (4)' },
  new_surface: { medianLift: 1.25, n: 9, note: 'ChatGPT Dots' },
  point_release: { medianLift: 1.06, n: 13, note: 'Claude Opus 5.5' },
  ecosystem: { medianLift: null, n: 0, note: 'no prior' },
};

export const NOVELTY_LABEL: Record<LabNovelty, string> = {
  new_category: 'New category',
  new_flagship: 'New flagship',
  new_surface: 'New surface',
  point_release: 'Point release',
  ecosystem: 'Ecosystem',
};

const SURFACE_RE = /\b(comes to|now in|available in|in (chatgpt|gemini|claude|copilot|the api))\b/i;

type Version = { prefix: string; major: number; minor: number; suffix: string };

/** A version token (`6`, `5.5`, `4o`) or a letter-prefixed one (`r1`). */
function parseVersion(tokens: readonly string[]): { version: Version | null; rest: string[] } {
  const rest: string[] = [];
  let version: Version | null = null;
  for (const t of tokens) {
    const m = t.match(/^(v?)(\d+)(?:\.(\d+))?([a-z]?)$/) ?? t.match(/^([a-z])(\d+)(?:\.(\d+))?()$/);
    if (m && !version) {
      version = { prefix: m[1] === 'v' ? '' : m[1], major: Number(m[2]), minor: Number(m[3] ?? 0), suffix: m[4] ?? '' };
      continue;
    }
    rest.push(t);
  }
  return { version, rest };
}

export type KnownFamily = { key: string };

/** The known families: SEED_FAMILIES plus previously confirmed events. */
export function knownFamilies(events: readonly Pick<LabEvent, 'key' | 'status' | 'id'>[], exceptId?: string): KnownFamily[] {
  return [...SEED_FAMILIES.map((s) => ({ key: s.replace(/ /g, '-') })), ...events.filter((e) => e.status === 'confirmed' && e.id !== exceptId).map((e) => ({ key: e.key }))];
}

/** 05 8 N1 to N4; null = N5 (ask the LLM). */
export function noveltyByRule(event: Pick<LabEvent, 'key'>, known: readonly KnownFamily[], pings: readonly Pick<LabEventPing, 'family' | 'title'>[]): LabNovelty | null {
  const ev = parseVersion(splitKey(event.key));
  if (ev.version) {
    let best: LabNovelty | null = null;
    for (const k of known) {
      const kv = parseVersion(splitKey(k.key));
      if (!kv.version || kv.version.prefix !== ev.version.prefix) continue;
      if (!kv.rest.length || !kv.rest.every((t) => ev.rest.includes(t))) continue;
      if (ev.version.major > kv.version.major) best = best ?? 'new_flagship';
      else if (ev.version.major === kv.version.major && (ev.version.minor > kv.version.minor || (ev.version.minor === kv.version.minor && ev.version.suffix > kv.version.suffix))) best = best === 'new_flagship' ? best : 'point_release';
    }
    if (best === 'new_flagship') return 'new_flagship';
    if (best === 'point_release') return 'point_release';
  }
  const tokens = [...keyTokens(event.key), ...versionTokens(event.key)];
  const knownFamily = tokens.some((t) => (FAMILY_WORDS as readonly string[]).includes(t)) || known.some((k) => keyTokens(k.key).some((t) => tokens.includes(t) && (FAMILY_WORDS as readonly string[]).includes(t)));
  if (pings.some((p) => p.family === 'vendor' && SURFACE_RE.test(p.title)) && knownFamily) return 'new_surface';
  const families = new Set(pings.map((p) => p.family));
  if (!families.has('vendor') && families.size > 0 && [...families].every((f) => f === 'github' || f === 'hf') && !knownFamily) return 'ecosystem';
  return null;
}

export const NoveltyReplySchema = z.object({ items: z.array(z.object({ eventId: z.string(), novelty: LabNoveltySchema, reason: z.string().max(200) })) });
export type NoveltyAsk = (prompt: string) => Promise<{ ok: true; data: z.infer<typeof NoveltyReplySchema> } | { ok: false; unavailable?: boolean; error: string }>;

export function noveltyPrompt(items: { eventId: string; text: string }[]): string {
  return [
    'Tag each AI launch below with one novelty class. Definitions:',
    '- new_category: a new kind of product that did not exist before (example: Jev).',
    '- new_flagship: a new generation of a flagship model (GPT-6 Astra, Gemini 4).',
    '- new_surface: an existing model in a new product surface (ChatGPT Dots).',
    '- point_release: a version bump of an existing model (Claude Opus 5.5).',
    '- ecosystem: a tool, library or integration around existing models.',
    '',
    'Reply with strict JSON only: {"items":[{"eventId":"...","novelty":"...","reason":"one short sentence"}]}',
    '',
    ...items.map((i) => `eventId ${i.eventId}: ${i.text}`),
  ].join('\n');
}

/**
 * Tag every confirmed, untagged event: rules first, then one LLM batch for the rest.
 * Dry never asks (AC-05-18). Manual tags are never overwritten.
 */
export async function tagNovelty(store: LabStore, now: Date, opts: { ask?: NoveltyAsk | null; dry: boolean }): Promise<{ byRule: number; byLlm: number; asked: boolean }> {
  const all = store.events.all();
  const todo = all.filter((e) => e.status === 'confirmed' && e.novelty === null);
  let byRule = 0;
  let byLlm = 0;
  const rest: { e: LabEvent; text: string }[] = [];
  for (const e of todo) {
    const pings = store.eventPings.forEvent(e.id);
    const tag = noveltyByRule(e, knownFamilies(all, e.id), pings);
    if (tag) {
      store.events.upsert({ ...e, novelty: tag, noveltySource: 'rule', updatedAt: now.toISOString() });
      byRule++;
    } else {
      const lead = pings.find((p) => p.family === 'vendor') ?? pings.find((p) => p.source === 'hn') ?? pings[0];
      rest.push({ e, text: `${e.name}. ${(lead?.title ?? '').slice(0, 500)}` });
    }
  }
  if (!rest.length || opts.dry || !opts.ask) return { byRule, byLlm, asked: false };
  const reply = await opts.ask(noveltyPrompt(rest.map((r) => ({ eventId: r.e.id, text: r.text }))));
  if (reply.ok) {
    for (const it of reply.data.items) {
      const r = rest.find((x) => x.e.id === it.eventId);
      if (!r) continue;
      store.events.upsert({ ...r.e, novelty: it.novelty, noveltySource: 'llm', updatedAt: now.toISOString() });
      byLlm++;
    }
  }
  return { byRule, byLlm, asked: true };
}

/** 05 8 display line. `own` = the Lab's own covering-post median for this tag when n >= 5. */
export function noveltyPriorLine(novelty: LabNovelty | null, own: { median: number; n: number } | null): string {
  if (own && own.n >= 5) return `In your niche: ${own.median.toFixed(1)}x (n ${own.n})`;
  if (!novelty) return 'Prior: not enough yet';
  const p = NOVELTY_PRIORS[novelty];
  if (p.medianLift === null || p.n < 5) return 'Prior: not enough yet';
  return `Prior from big AI channels: ${p.medianLift.toFixed(1)}x their normal (n ${p.n}, YouTube long-form).`;
}
