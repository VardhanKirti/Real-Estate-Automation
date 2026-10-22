import type { CommsItem, CommsSource } from '@/lib/comms';
import type { CalEvent } from '@/lib/connectors/gcal';

/**
 * The /inbox model (2026-09-16). One reading surface for every channel —
 * email, Slack, WhatsApp and the calendar — where the source is spelled out
 * in words, every thread carries a triage state derived from the message
 * itself, and the reader shows the whole exchange. Pure and tested; the React
 * layer is a thin renderer over `buildThreads` + `filterThreads`.
 */

export type InboxSource = CommsSource | 'calendar';

export const SOURCES: { id: InboxSource; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'slack', label: 'Slack' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'calendar', label: 'Meetings' },
];

export type Triage = 'reply' | 'waiting' | 'fyi' | 'done';

export const TRIAGE: { id: Triage; label: string; hint: string }[] = [
  { id: 'reply', label: 'Needs reply', hint: 'They asked something, or a priority contact is waiting on you' },
  { id: 'waiting', label: 'Waiting on them', hint: 'The ball is in their court' },
  { id: 'fyi', label: 'FYI', hint: 'Read it, nothing to send back' },
  { id: 'done', label: 'Done', hint: 'Older than three days with nothing unread' },
];

export type Sort = 'newest' | 'oldest' | 'urgency';

export const SORTS: { id: Sort; label: string }[] = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'urgency', label: 'Most urgent' },
];

export type Range = 'today' | 'yesterday' | 'week' | 'all';

export const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'all', label: 'All' },
];

export type MediaKind = 'image' | 'video' | 'gif' | 'voice' | 'document';

export type ThreadMedia = {
  kind: MediaKind;
  url: string;
  name: string;
  /** Seconds, for voice notes and video. */
  duration?: number;
  bytes?: number;
};

export type ThreadMessage = {
  from: 'them' | 'me';
  text: string;
  ts: string;
  /** Who spoke, in a group. */
  author?: string;
  /** Attached media, when the app has the file on disk. */
  media?: ThreadMedia;
};

export interface InboxThread {
  key: string;
  source: InboxSource;
  /** The person (or, for a meeting, the event title). */
  sender: string;
  /** Company / channel / calendar account — the second line under the name. */
  context: string;
  /** The latest line — subject-like for email, the message itself elsewhere. */
  preview: string;
  ts: string;
  unread: number;
  priority?: 1 | 2 | 3;
  triage: Triage;
  /** Why the triage state was chosen — shown in the reader, never invented. */
  reasons: string[];
  /** A real cached profile picture, when one exists. Absent means initials. */
  avatarUrl?: string;
  /** WhatsApp chat id, so the reader can load the real history on demand. */
  jid?: string;
  replyTo?: string;
  account?: string;
  /** Meeting-only details. */
  event?: { end: string | null; location: string | null; joinUrl: string | null; allDay: boolean; color: string };
}

const DAY = 86_400_000;

const QUESTION_RE = /\?\s*$|\bcan you\b|\bcould you\b|\bwhen can\b|\bwhere do\b|\bwhat is\b|\bstill good\b/i;
const WAITING_RE = /\b(sending|will send|sharing|forwarding|attached|circling back|is set|are in the (doc|drive))\b/i;

/** Split a feed title into who and where. Email is "Name — Org", Slack is
    "#channel — Name", WhatsApp is "Name (brand)" or just "Name". */
export function parseTitle(item: CommsItem): { sender: string; context: string } {
  if (item.source === 'slack') {
    const [channel, name] = item.title.split(' — ');
    return { sender: (name ?? item.sender ?? channel).trim(), context: channel.trim() };
  }
  if (item.source === 'email') {
    const [name, org] = item.title.split(' — ');
    return { sender: name.trim(), context: (org ?? item.replyTo ?? '').trim() };
  }
  const m = item.title.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (m) return { sender: m[1].trim(), context: m[2].trim() };
  return { sender: item.title.trim(), context: 'WhatsApp' };
}

/** Triage state plus the plain-language reasons behind it. */
export function triageOf(item: CommsItem, now: Date = new Date()): { triage: Triage; reasons: string[] } {
  const reasons: string[] = [];
  const ageMs = now.getTime() - Date.parse(item.ts);
  const unread = item.unread ?? 0;
  if (item.priority === 1) reasons.push('Priority 1 contact');
  else if (item.priority === 2) reasons.push('Priority 2 contact');
  if (QUESTION_RE.test(item.preview)) reasons.push('They asked a question');
  if (unread) reasons.push(unread === 1 ? '1 unread message' : `${unread} unread messages`);

  if (ageMs > 3 * DAY && unread === 0 && item.priority !== 1) {
    reasons.push('Older than three days, nothing unread');
    return { triage: 'done', reasons };
  }
  // Unread stands on its own. Priority comes from contact tags, and a fresh
  // install has none — keying "needs reply" off tags alone filed every unread
  // thread as FYI, including one sitting on two dozen messages.
  if (item.priority === 1 || QUESTION_RE.test(item.preview) || unread > 0) {
    return { triage: 'reply', reasons };
  }
  if (WAITING_RE.test(item.preview)) {
    reasons.push('They said what happens next');
    return { triage: 'waiting', reasons };
  }
  reasons.push('Nothing to send back');
  return { triage: 'fyi', reasons };
}

/**
 * The phone number a WhatsApp chat can be replied to on, or null. Only
 * "<number>@s.whatsapp.net" carries one — "@lid" is an opaque linked id and
 * "@g.us" is a group, neither of which the Cloud API can address. Pure, so the
 * reader can decide what to offer without a round trip.
 */
export function whatsappNumber(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const [head, domain] = String(jid).split('@');
  if (domain !== 's.whatsapp.net') return null;
  return /^[0-9]{7,15}$/.test(head) ? head : null;
}

/** FNV-1a, 32-bit, as 8 hex chars. Small, deterministic, no crypto needed. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A thread's stable identity: source plus a hash of who it is from and what
 * it says. It used to be `source-ts-index`, which changed whenever a newer
 * item shifted the list (and on every load of the Filming feed, whose times
 * are relative to now), so a Done or Snooze saved on this browser
 * (lib/inbox-triage.ts, H32) could never find its thread again. A new
 * message in the same chat changes the preview, so it gets a new key and
 * comes back to the inbox: a new message is new work.
 */
export function threadKey(item: CommsItem): string {
  const who = item.jid ?? item.replyTo ?? item.sender ?? '';
  return `${item.source}-${fnv1a([who, item.title, item.preview].join('\u0000'))}`;
}

/** Fold the comms feed and the calendar into one list, newest first. */
export function buildThreads(feed: CommsItem[], events: CalEvent[] = [], now: Date = new Date()): InboxThread[] {
  const seen = new Map<string, number>();
  const threads: InboxThread[] = feed.map((item) => {
    const { sender, context } = parseTitle(item);
    const { triage, reasons } = triageOf(item, now);
    // identical items (same source, sender and text) get -2, -3 … in feed order
    const base = threadKey(item);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return {
      key: n === 1 ? base : `${base}-${n}`,
      source: item.source,
      sender,
      context,
      preview: item.preview,
      ts: item.ts,
      unread: item.unread ?? 0,
      priority: item.priority,
      triage,
      reasons,
      replyTo: item.replyTo,
      account: item.account,
      avatarUrl: item.avatarUrl,
      jid: item.jid,
    };
  });
  for (const ev of events) {
    const startMs = Date.parse(ev.start);
    const upcoming = startMs >= now.getTime();
    threads.push({
      key: `calendar-${ev.id}`,
      source: 'calendar',
      sender: ev.title,
      context: ev.account,
      preview: ev.location ? ev.location : ev.joinUrl ? 'Video call' : ev.allDay ? 'All day' : 'Meeting',
      ts: ev.start,
      unread: 0,
      triage: upcoming ? 'fyi' : 'done',
      reasons: [upcoming ? 'Upcoming on your calendar' : 'Already happened'],
      event: { end: ev.end, location: ev.location, joinUrl: ev.joinUrl, allDay: ev.allDay, color: ev.color },
    });
  }
  return orderThreads(threads, now);
}

/** Reading order: what is about to happen today (soonest first), then the
    past newest-first, then meetings later in the week (soonest first). */
export function orderThreads(threads: InboxThread[], now: Date = new Date()): InboxThread[] {
  const next: InboxThread[] = [];
  const past: InboxThread[] = [];
  const later: InboxThread[] = [];
  for (const t of threads) {
    const b = dateBucket(t.ts, now);
    if (b === 'next') next.push(t);
    else if (b === 'later') later.push(t);
    else past.push(t);
  }
  next.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  past.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  later.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return [...next, ...past, ...later];
}

/** Which day bucket a timestamp falls in, for the list's group labels. */
export function dateBucket(ts: string, now: Date = new Date()): 'next' | 'later' | 'today' | 'yesterday' | 'week' | 'older' {
  const t = Date.parse(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t > now.getTime() + 60_000) return t < startOfToday + DAY ? 'next' : 'later';
  if (t >= startOfToday) return 'today';
  if (t >= startOfToday - DAY) return 'yesterday';
  if (t >= startOfToday - 6 * DAY) return 'week';
  return 'older';
}

export const BUCKET_LABEL: Record<ReturnType<typeof dateBucket>, string> = {
  next: 'Up next',
  later: 'Later this week',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  older: 'Older',
};

export interface InboxFilter {
  source?: InboxSource | 'all';
  triage?: Triage | 'all';
  range?: Range;
  query?: string;
}

function inRange(ts: string, range: Range, now: Date): boolean {
  if (range === 'all') return true;
  const b = dateBucket(ts, now);
  if (range === 'today') return b === 'today' || b === 'next';
  if (range === 'yesterday') return b === 'yesterday';
  return b !== 'older' && b !== 'later';
}

export function filterThreads(threads: InboxThread[], f: InboxFilter, now: Date = new Date()): InboxThread[] {
  const q = (f.query ?? '').trim().toLowerCase();
  return threads.filter((t) => {
    if (f.source && f.source !== 'all' && t.source !== f.source) return false;
    if (f.triage && f.triage !== 'all' && t.triage !== f.triage) return false;
    if (f.range && !inRange(t.ts, f.range, now)) return false;
    if (q && !`${t.sender} ${t.context} ${t.preview}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

const TRIAGE_WEIGHT: Record<Triage, number> = { reply: 300, waiting: 120, fyi: 20, done: 0 };

/**
 * How loudly a thread is asking for attention. A tagged contact outranks
 * everything, then the queue it landed in, then how much is unread — so
 * "most urgent" surfaces the thread you would actually open first rather than
 * whichever one happens to be newest.
 */
export function urgencyScore(t: InboxThread): number {
  const priority = t.priority ? [0, 1000, 500, 150][t.priority] : 0;
  const unread = Math.min(t.unread, 50) * 6;
  return priority + TRIAGE_WEIGHT[t.triage] + unread;
}

/** Apply the chosen order. `newest` keeps the reading order (what is about to
    happen, then the past newest-first, then later this week). */
export function sortThreads(threads: InboxThread[], sort: Sort, now: Date = new Date()): InboxThread[] {
  if (sort === 'urgency') {
    return [...threads].sort((a, b) => {
      const d = urgencyScore(b) - urgencyScore(a);
      return d !== 0 ? d : Date.parse(b.ts) - Date.parse(a.ts);
    });
  }
  if (sort === 'oldest') return [...threads].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return orderThreads(threads, now);
}

export function countBy<K extends string>(threads: InboxThread[], pick: (t: InboxThread) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const t of threads) out[pick(t)] = (out[pick(t)] ?? 0) + 1;
  return out;
}

export function initials(name: string): string {
  const words = name.replace(/^#/, '').split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < -60) return `in ${Math.round(-minutes / 60)}h`;
  if (minutes < 0) return `in ${-minutes}m`;
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** A thread's messages: the scripted history when one exists, otherwise the
    single latest message the feed knows about. */
export function messagesFor(t: InboxThread, bodies: Record<string, ThreadMessage[]> = {}): ThreadMessage[] {
  const scripted = bodies[t.sender];
  if (scripted && scripted.length) return scripted;
  return [{ from: 'them', text: t.preview, ts: t.ts }];
}
