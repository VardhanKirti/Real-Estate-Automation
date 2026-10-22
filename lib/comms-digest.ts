import type { CommsItem } from '@/lib/comms';

/**
 * The morning digest: who the operator actually needs to respond to.
 * Ported verbatim from the 2026-10-06 parts bin, which ported FounderOS
 * (FounderOS UI merge, pages/feature-additions.md F3). Rule-based, no LLM (T11).
 *
 * Priority order, highest first: people you have a call with, then clients
 * and prospects, then people (tagged contacts and anyone human), then brand
 * deals, then group chats, and last anything from a company or a piece of
 * software. People rank above systems.
 *
 * Pure, so the ranking is unit-testable; the connectors are gathered in
 * lib/comms-digest-run.ts and the 07:00 job is fired by lib/cron-runner.ts. The rule that matters most: a real human NEVER falls
 * into `noise`. Only detected bulk/automated senders do, because that tier is
 * also the unsubscribe list and dropping a client into it would lose them.
 *
 * Client-safe: no connector or node imports, so the panel can use the helpers.
 */

/** Priority order, highest first. Index doubles as the sort rank. */
export const TIER_ORDER = ['call', 'client', 'people', 'branddeal', 'group', 'noise'] as const;
export type DigestTier = (typeof TIER_ORDER)[number];

export type DigestContext = {
  /** Calendar event titles in/near the window: "people I have calls with". */
  meetingTitles: string[];
  /** Client and prospect names (the Attio roster). */
  clientNames: string[];
  /** People tagged in contact_tags (any tag). */
  tagged: string[];
  /** Open brand deals from bdpilot: brand names and contact addresses. */
  brandDeals: string[];
  /**
   * The operator's own name, brands and ventures (COMMS_OWN_NAMES). A calendar
   * full of your own company name would otherwise put every sender carrying
   * that name into the call tier, so these words never identify a person.
   */
  ownNames?: string[];
  now: number;
};

export type DigestEntry = {
  tier: DigestTier;
  rank: number; // TIER_ORDER index; ties broken by recency
  reason: string;
  source: CommsItem['source'];
  sender: string;
  title: string;
  preview: string;
  ts: string;
  replyTo?: string;
  account?: string;
  jid?: string;
  /** true when this rode over from an earlier report instead of arriving today */
  carried?: boolean;
  /** when it FIRST appeared in a report; set once and never moved */
  firstSeenAt?: string;
};

export type UnsubscribeCandidate = { sender: string; count: number; reason: string };

export type CommsDigest = {
  generatedAt: string;
  windowHours: number;
  entries: DigestEntry[];
  unsubscribes: UnsubscribeCandidate[];
  counts: Record<DigestTier, number>;
  total: number;
  /** Entries genuinely awaiting a reply: everything above group chatter. */
  needsReply: number;
};

export const WINDOW_HOURS = 24;

/**
 * How long an unanswered entry keeps riding along. The 24h window decides
 * what is NEW; this decides how long something never answered stays in front
 * of the operator. Capped so a month of ignored newsletters cannot grow the
 * report without bound.
 */
export const CARRY_MAX_DAYS = 30;

/**
 * How long a "cleared" mark is kept. MUST exceed CARRY_MAX_DAYS: if a read key
 * were pruned while its entry could still be carried, the entry would come
 * back the next morning as though it had never been answered.
 */
export const READ_RETENTION_DAYS = CARRY_MAX_DAYS + 15;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Words that never identify a PERSON: filler, mail words, role words. */
const STOP = new Set([
  'the', 'and', 'com', 'net', 'org', 'call', 'with', 'meeting', 'sync', 'chat', 'zoom', 'meet',
  're', 'fwd', 'gmail', 'group', 'inc', 'llc', 'ltd', 'team', 'founder', 'agency', 'cohort', 'core',
  'sales', 'demo', 'ops', 'support', 'admin', 'invited', 'you', 'new', 'via', 'linkedin', 'intro',
  'weekly', 'daily', 'review', 'check', 'standup', 'kickoff', 'onboarding', 'discovery', 'session',
]);

/** Tokens worth matching on: drops initials, filler and the operator's own words. */
function tokens(s: string, own: Set<string> = new Set()): string[] {
  return norm(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP.has(t) && !own.has(t));
}

function ownSet(ctx: Pick<DigestContext, 'ownNames'>): Set<string> {
  return new Set((ctx.ownNames ?? []).flatMap((n) => norm(n).split(' ')).filter(Boolean));
}

const BULK_LOCALPARTS = /^(no-?reply|do-?not-?reply|notifications?|alerts?|mailer|bounce|postmaster|support|info|hello|hi|team|news|newsletter|updates?|billing|receipts?|digest|marketing|noreply)$/i;

const BULK_SUBJECT = /\b(unsubscribe|newsletter|digest|webinar|invoice|receipt|your order|deployment|build (succeeded|failed)|password reset|verify your|security alert|sign-?in|new login|promo|% off|sale ends|limited time)\b/i;

const BULK_BODY = /\b(unsubscribe|manage (your )?(email )?preferences|opt ?out|view (this|in) browser|you (are )?receiv(ed|ing) this)\b/i;

/** Relayed list mail: "Someone via LinkedIn", "X via Substack". */
const BULK_RELAY = /\bvia (linkedin|substack|medium|quora|facebook|nextdoor|meetup|eventbrite)\b/i;

/** Sender names that are an ORGANISATION, not a person. */
const BULK_ORG = /\b(ticketmaster|nextdoor|eventbrite|stubhub|club|theat(er|re)|arena|casino|store|shop|dealership|bank|airlines?|hotel|tickets?)\b|^trending on\b|^the .* (team|crew)$|^mail delivery|daemon|postmaster/i;

/** Machine mail: repo notifications, CI, deploys, monitors. */
const BULK_MACHINE = /\[[\w.-]+\/[\w.-]+\]|\b(run (failed|succeeded)|workflow run|build (failed|passed)|pipeline|pull request|commit|merged in|alert:|incident|uptime|delivery status notification|undeliverable|recap of your meeting)\b/i;

/**
 * Is this an automated / company sender rather than a person? Conservative on
 * purpose: a false positive here hides a client.
 *
 * Both text fields are searched. lib/connectors/email.ts puts
 * "<inbox> — <sender>" in `title` and the SUBJECT in `preview`, while Slack
 * puts the channel in `title` and the message in `preview`.
 */
export function isBulkSender(sender: string, title: string, preview: string): boolean {
  const local = sender.includes('@') ? sender.split('@')[0] : '';
  if (local && BULK_LOCALPARTS.test(local.replace(/[._-]?\d+$/, ''))) return true;
  if (BULK_RELAY.test(sender) || BULK_ORG.test(sender)) return true;
  const text = `${title}\n${preview}`;
  return BULK_MACHINE.test(text) || BULK_BODY.test(text) || BULK_SUBJECT.test(text);
}

/** WhatsApp/Slack group threads: a member count, a group jid or an obvious group label. */
export function isGroupChat(item: CommsItem): boolean {
  if (item.jid?.endsWith('@g.us')) return true;
  const s = item.sender ?? '';
  if (/\(\s*\d+\s*\)\s*$/.test(s)) return true; // "Cohort 1 (12)"
  return /\b(group|chat|crew|team|family|squad|community)\b/i.test(s) && item.source !== 'email';
}

const BRAND_RE = /\b(sponsor|sponsorship|partnership|collab|collaboration|brand deal|ambassador|paid promo|ugc|affiliate)\b/i;
const REPLY_RE = /\b(re:|following up|circling back|as discussed|per our call|proposal|quote|invoice attached|contract|next steps?|kick ?off)\b/i;

/**
 * Does `needle` identify the same person as one of `haystack`? Strict, because
 * this decides the top of the report: a match needs TWO tokens in the same
 * entry (first + last name) or one distinctive token of six characters or more.
 */
export function nameHits(needle: string, haystack: string[], own: Set<string> = new Set()): boolean {
  const nt = tokens(needle, own);
  if (nt.length === 0) return false;
  return haystack.some((entry) => {
    const h = norm(entry);
    const hit = nt.filter((t) => h.includes(t));
    return hit.length >= 2 || hit.some((t) => t.length >= 6);
  });
}

/** An address or brand from bdpilot's open deals, matched against sender + reply address. */
function dealHit(item: CommsItem, deals: string[], own: Set<string>): boolean {
  if (deals.length === 0) return false;
  const addr = (item.replyTo ?? (item.sender?.includes('@') ? item.sender : '') ?? '').toLowerCase();
  for (const d of deals) {
    const v = d.trim().toLowerCase();
    if (!v) continue;
    if (v.includes('@')) {
      if (addr && addr === v) return true;
      continue;
    }
    // a brand name: the sender, or the domain of the reply address
    if (nameHits(item.sender ?? '', [d], own)) return true;
    const domain = addr.split('@')[1]?.split('.')[0] ?? '';
    if (domain.length >= 4 && norm(v).replace(/ /g, '') === domain) return true;
  }
  return false;
}

export function classify(item: CommsItem, ctx: DigestContext): { tier: DigestTier; reason: string } {
  const sender = item.sender ?? '';
  const title = item.title ?? '';
  const preview = item.preview ?? '';
  const group = isGroupChat(item);
  const bulk = isBulkSender(sender, title, preview);
  const text = `${title}\n${preview}`;
  const own = ownSet(ctx);

  // 1. Anyone with a call booked. CalDAV gives no attendee list, so the
  //    sender is matched against the event title text.
  if (!bulk && sender && nameHits(sender, ctx.meetingTitles, own)) {
    return { tier: 'call', reason: 'on your calendar' };
  }

  // 2. A client or prospect on the Attio roster.
  if (!bulk && sender && nameHits(sender, ctx.clientNames, own)) {
    return { tier: 'client', reason: 'client or prospect' };
  }
  if (!bulk && !group && REPLY_RE.test(text) && nameHits(sender, ctx.clientNames.concat(ctx.meetingTitles), own)) {
    return { tier: 'client', reason: 'reply on a deal thread' };
  }

  // 3. A brand that bdpilot is already negotiating with.
  if (!group && dealHit(item, ctx.brandDeals, own)) {
    return { tier: 'branddeal', reason: 'open brand deal' };
  }

  // 4. Tagged contacts, even inside a group.
  if (sender && nameHits(sender, ctx.tagged, own)) return { tier: 'people', reason: 'tagged contact' };

  // 5. Group chatter.
  if (group) return { tier: 'group', reason: 'group chat' };

  // 6. Brand-deal wording from someone not yet in bdpilot. Bulk-checked first,
  //    so a newsletter about someone else's "partnership" is not a brand deal.
  if (!bulk && BRAND_RE.test(text)) {
    return { tier: 'branddeal', reason: 'brand deal or partnership' };
  }

  // 7. Companies and software last; everyone else is a person worth reading.
  if (bulk) return { tier: 'noise', reason: 'automated sender' };
  return { tier: 'people', reason: 'a person wrote to you' };
}

/** Bulk senders in the window, noisiest first: the unsubscribe worklist. */
export function unsubscribeCandidates(items: CommsItem[], ctx: DigestContext): UnsubscribeCandidate[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (classify(i, ctx).tier !== 'noise') continue;
    const s = i.sender ?? '';
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sender, count]) => ({
      sender,
      count,
      reason: count > 1 ? `${count} messages in 24h` : 'automated sender',
    }))
    .sort((a, b) => b.count - a.count || a.sender.localeCompare(b.sender));
}

export function buildDigest(items: CommsItem[], ctx: DigestContext, windowHours = WINDOW_HOURS): CommsDigest {
  const cutoff = ctx.now - windowHours * 3600_000;
  const fresh = items.filter((i) => {
    const t = Date.parse(i.ts);
    return Number.isFinite(t) && t >= cutoff && t <= ctx.now + 60_000;
  });

  const entries: DigestEntry[] = fresh.map((i) => {
    const { tier, reason } = classify(i, ctx);
    return {
      tier,
      rank: TIER_ORDER.indexOf(tier),
      reason,
      source: i.source,
      sender: i.sender ?? 'unknown',
      title: i.title,
      preview: i.preview,
      ts: i.ts,
      ...(i.replyTo ? { replyTo: i.replyTo } : {}),
      ...(i.account ? { account: i.account } : {}),
      ...(i.jid ? { jid: i.jid } : {}),
    };
  });

  const ordered = orderEntries(entries);
  return {
    generatedAt: new Date(ctx.now).toISOString(),
    windowHours,
    entries: ordered,
    unsubscribes: unsubscribeCandidates(fresh, ctx),
    ...tally(ordered),
  };
}

/** Tier first, then NEW above held-over, then newest inside each group. */
function orderEntries(entries: DigestEntry[]): DigestEntry[] {
  return [...entries].sort(
    (a, b) => a.rank - b.rank || Number(!!a.carried) - Number(!!b.carried) || Date.parse(b.ts) - Date.parse(a.ts),
  );
}

/** Recount a set of entries so the header never disagrees with the rows. */
function tally(entries: DigestEntry[]): Pick<CommsDigest, 'counts' | 'total' | 'needsReply'> {
  const counts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<DigestTier, number>;
  for (const e of entries) counts[e.tier] += 1;
  return {
    counts,
    total: entries.length,
    needsReply: counts.call + counts.client + counts.people + counts.branddeal,
  };
}

/**
 * Stack this morning's report ON TOP of what is left of the older ones. An
 * entry leaves the report for exactly one reason: the operator cleared it.
 * Falling out of the 24-hour window is not one. Pure: the caller supplies the
 * previous entries and the cleared keys.
 */
export function stackDigest(fresh: CommsDigest, previous: DigestEntry[], clearedKeys: Iterable<string>, now = Date.now()): CommsDigest {
  const cleared = new Set(clearedKeys);
  const seen = new Set(fresh.entries.map(entryKey));
  const oldest = now - CARRY_MAX_DAYS * 86_400_000;

  const carried: DigestEntry[] = [];
  for (const e of previous) {
    const key = entryKey(e);
    // fresh wins a collision: today's copy is the one with current context
    if (cleared.has(key) || seen.has(key)) continue;
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t) || t < oldest) continue;
    seen.add(key);
    carried.push({ ...e, carried: true, firstSeenAt: e.firstSeenAt ?? e.ts });
  }

  const entries = orderEntries([...fresh.entries, ...carried]);
  return { ...fresh, entries, ...tally(entries) };
}

/**
 * A stable id for one message in the report. Must survive a rebuild, so
 * channel + sender + timestamp, and deliberately NOT the tier: re-tuning the
 * ranking must not un-clear the inbox.
 */
export function entryKey(e: Pick<DigestEntry, 'source' | 'sender' | 'ts'>): string {
  return `${e.source}|${e.sender}|${e.ts}`;
}

/** Default panel state: open before noon, collapsed after (local time). */
export function digestOpenByDefault(now: Date = new Date()): boolean {
  return now.getHours() < 12;
}
