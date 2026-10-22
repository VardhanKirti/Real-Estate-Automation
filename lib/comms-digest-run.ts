/**
 * Build and store the morning digest (pages/feature-additions.md F3), adapted
 * from the 2026-10-06 parts bin. Messages come from gatherCommsFeed, the SAME
 * gatherer /inbox uses, so the digest and the page cannot disagree about what
 * arrived; the classifier is rule-based (lib/comms-digest.ts, no LLM, T11).
 *
 * Context for the ranking: calendar titles (call tier), the confirmed client
 * roster plus Attio deal names (client tier), contact_tags (people tier). Each
 * context read is guarded: a dead connector degrades the ranking, it never
 * loses the morning. All reads are free; nothing is sent.
 */
import { randomUUID } from 'node:crypto';
import { getDb } from '@/lib/data';
import { gatherCommsFeed } from '@/lib/comms-feed';
import { upcomingEvents } from '@/lib/connectors/gcal';
import { attioClients } from '@/lib/connectors/attio';
import { buildDigest, stackDigest, type CommsDigest, type DigestContext, type DigestEntry } from '@/lib/comms-digest';
import type { CommsItem } from '@/lib/comms';
import type { CommsDigestRow } from '@/lib/schemas';

/** The local day a digest covers. */
export function digestDate(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function gatherDigestContext(now = Date.now()): Promise<DigestContext> {
  const db = getDb();
  const [events, attio] = await Promise.all([
    upcomingEvents(process.env, { days: 2, limit: 60, now: new Date(now) }).catch(() => []),
    attioClients().catch(() => ({ clients: [] as { name: string }[] })),
  ]);
  let tagged: string[] = [];
  try {
    tagged = db.contactTags.all().map((t) => t.person);
  } catch {
    tagged = [];
  }
  const confirmed = db.clientConfirmations.all().flatMap((c) => [c.name, c.company]).filter(Boolean);
  return {
    meetingTitles: events.map((e) => e.title).filter(Boolean),
    clientNames: [...new Set([...confirmed, ...attio.clients.map((c) => c.name).filter(Boolean)])],
    tagged,
    brandDeals: [],
    ownNames: [process.env.GLADOS_OPERATOR_NAME ?? '', ...(process.env.COMMS_OWN_NAMES ?? '').split(',')].map((n) => n.trim()).filter(Boolean),
    now,
  };
}

/** What the previous digest still owes: its entries plus every cleared key. */
function backlog(): { previous: DigestEntry[]; cleared: string[] } {
  try {
    const db = getDb();
    const last = db.commsDigests.latest();
    const body = last?.body as { entries?: DigestEntry[] } | null | undefined;
    return { previous: Array.isArray(body?.entries) ? body!.entries : [], cleared: db.commsDigests.reads.clearedKeys() };
  } catch {
    return { previous: [], cleared: [] };
  }
}

export async function buildCommsDigest(opts: { now?: number; feed?: () => Promise<CommsItem[]> } = {}): Promise<CommsDigest> {
  const now = opts.now ?? Date.now();
  const [items, ctx] = await Promise.all([(opts.feed ?? (() => gatherCommsFeed(200)))().catch(() => [] as CommsItem[]), gatherDigestContext(now)]);
  const { previous, cleared } = backlog();
  return stackDigest(buildDigest(items, ctx), previous, cleared, now);
}

/** Build and persist, so /inbox renders this morning's digest on load. */
export async function runAndStoreCommsDigest(opts: { now?: number; feed?: () => Promise<CommsItem[]> } = {}): Promise<CommsDigestRow> {
  const now = opts.now ?? Date.now();
  const digest = await buildCommsDigest({ ...opts, now });
  return getDb().commsDigests.insert({ id: randomUUID(), date: digestDate(now), body: digest, createdAt: new Date(now).toISOString() });
}

/** One-line headline for the cron run log. */
export function digestSummary(d: CommsDigest): string {
  const c = d.counts;
  return `${d.needsReply} need a reply (${c.call} call, ${c.client} client, ${c.people} people) of ${d.total}; ${d.unsubscribes.length} to unsubscribe`;
}
