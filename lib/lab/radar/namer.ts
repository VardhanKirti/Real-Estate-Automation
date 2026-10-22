/**
 * The LLM name fallback (05 6.1): one local claude CLI call per tick for up to 20 unnamed
 * qualifying pings. `name: null` means "not a launch". If the CLI is missing, unnamed pings
 * stay unnamed and the Radar header says naming is paused.
 */
import { z } from 'zod';
import type { LabEventPing } from '@/lib/schemas';
import type { LabStore } from '@/lib/lab/store';
import { canonicalKey } from '@/lib/lab/radar/names';
import { DAY } from '@/lib/lab/radar/util';

export const NAME_BATCH = 20;
export const NAMING_KEY = 'radar:naming';

export const NameReply = z.object({ items: z.array(z.object({ pingId: z.string(), name: z.string().max(60).nullable(), vendor: z.string().max(30).nullable() })) });
export type NameAsk = (prompt: string) => Promise<{ ok: true; data: z.infer<typeof NameReply> } | { ok: false; unavailable?: boolean; error: string }>;

export function unnamedQualifying(store: LabStore, now: Date, limit = NAME_BATCH): LabEventPing[] {
  return store.eventPings
    .unattached(new Date(now.getTime() - 3 * DAY).toISOString())
    .filter((p) => p.qualifies && !p.name && !p.isBaseline)
    .slice(0, limit);
}

export function namePrompt(pings: readonly Pick<LabEventPing, 'id' | 'title' | 'author'>[]): string {
  return [
    'For each item below, give the product or model name exactly as the vendor writes it, or null if the text is not about a specific new release. Also give the vendor (company) or null.',
    'Reply with strict JSON only: {"items":[{"pingId":"...","name":"..." or null,"vendor":"..." or null}]}',
    '',
    ...pings.map((p) => `pingId ${p.id}${p.author ? ` (from ${p.author})` : ''}: ${p.title.slice(0, 400)}`),
  ].join('\n');
}

export type NamingState = { paused: boolean; reason: string | null; at: string };

/** Name up to 20 pings in one call. Dry never asks. Returns how many were named. */
export async function nameCandidates(store: LabStore, now: Date, opts: { ask?: NameAsk | null; dry: boolean }): Promise<{ asked: number; named: number; notLaunch: number; paused: boolean }> {
  const todo = unnamedQualifying(store, now);
  if (!todo.length || opts.dry || !opts.ask) return { asked: 0, named: 0, notLaunch: 0, paused: false };
  const reply = await opts.ask(namePrompt(todo));
  const at = now.toISOString();
  if (!reply.ok) {
    const paused = Boolean(reply.unavailable);
    store.priors.set({ key: NAMING_KEY, value: { paused, reason: paused ? 'claude CLI not found' : reply.error.slice(0, 200), at } satisfies NamingState, n: 0, supersedesDefault: false, updatedAt: at });
    return { asked: todo.length, named: 0, notLaunch: 0, paused };
  }
  store.priors.set({ key: NAMING_KEY, value: { paused: false, reason: null, at } satisfies NamingState, n: 0, supersedesDefault: false, updatedAt: at });
  let named = 0;
  let notLaunch = 0;
  for (const it of reply.data.items) {
    const p = todo.find((x) => x.id === it.pingId);
    if (!p) continue;
    if (!it.name || !canonicalKey(it.name)) {
      store.eventPings.upsert({ ...p, qualifies: false, qualifyReason: 'Not a specific release' });
      notLaunch++;
      continue;
    }
    store.eventPings.upsert({ ...p, name: it.name, nameKey: canonicalKey(it.name), vendor: p.vendor ?? it.vendor });
    named++;
  }
  return { asked: todo.length, named, notLaunch, paused: false };
}

export function namingState(store: LabStore): NamingState | null {
  const v = store.priors.get(NAMING_KEY)?.value as NamingState | null | undefined;
  return v && typeof v.paused === 'boolean' ? v : null;
}
