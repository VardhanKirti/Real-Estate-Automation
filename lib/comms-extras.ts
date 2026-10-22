/**
 * Comms additions from FounderOS (pages/feature-additions.md F3, F4, F5): the
 * shapes /inbox hands both trees, and the pure helpers that build them. One
 * server fetch in app/inbox/page.tsx fills `CommsExtras`; the GladOS and
 * Classic trees only present it (README "one server fetch per page").
 *
 * Client-safe: no connector, db or node imports.
 */
import type { CommsDigest, DigestEntry } from '@/lib/comms-digest';
import { assignLanes, hourBounds } from '@/lib/calendar-layout';
import type { CallRecording } from '@/lib/schemas';

// ── F3 morning digest ────────────────────────────────────────────────────

/**
 * ready    today's digest is stored;
 * pending  the runner is on and today's has not been written yet ("arrives at 7:00");
 * off      the runner is off on this instance and there is no digest for today.
 * An older digest stays readable in `pending` and `off` (`digest` is the latest).
 */
export type DigestState = 'ready' | 'pending' | 'off';

export type DigestLaneId = 'email' | 'slack' | 'whatsapp' | 'calendar';
export const DIGEST_LANES: { id: DigestLaneId; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'slack', label: 'Slack' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'calendar', label: 'Calendar' },
];

export type DigestEvent = { id: string; title: string; start: string; end: string | null; allDay: boolean };

export type DigestPanelData = {
  state: DigestState;
  /** The latest stored digest (or the sample), null when none was ever built. */
  digest: { id: string; date: string; body: CommsDigest; createdAt: string } | null;
  /** The whole digest has a read mark (clears the unread dot). */
  read: boolean;
  /** Entry keys the operator cleared (lib/comms-digest.ts entryKey). */
  clearedKeys: string[];
  cronEnabled: boolean;
  /** Today's calendar, the digest's calendar lane (the digest itself carries messages only). */
  today: DigestEvent[];
  sample: boolean;
};

export function digestState(opts: { cronEnabled: boolean; latestDate: string | null; today: string }): DigestState {
  if (opts.latestDate === opts.today) return 'ready';
  return opts.cronEnabled ? 'pending' : 'off';
}

export const DIGEST_COPY = {
  off: 'Morning digest is off on this instance.',
  offHint: 'The digest is written at 07:00 by the cron runner, which only runs where GLADOS_CRON=1 is set (the always-on host).',
  pending: "Today's digest arrives at 7:00.",
} as const;

export type DigestLane = { id: DigestLaneId; label: string; entries: DigestEntry[]; events: DigestEvent[]; needsReply: number };

const NEEDS_REPLY = new Set(['call', 'client', 'people', 'branddeal']);
export const needsReply = (e: Pick<DigestEntry, 'tier'>) => NEEDS_REPLY.has(e.tier);

/** The digest split by lane; cleared entries are dropped. Calendar carries today's events. */
export function digestLanes(body: CommsDigest | null, today: DigestEvent[], cleared: Iterable<string> = []): DigestLane[] {
  const gone = new Set(cleared);
  const entries = (body?.entries ?? []).filter((e) => !gone.has(`${e.source}|${e.sender}|${e.ts}`));
  return DIGEST_LANES.map(({ id, label }) => {
    const mine = id === 'calendar' ? [] : entries.filter((e) => e.source === id);
    return { id, label, entries: mine, events: id === 'calendar' ? today : [], needsReply: mine.filter(needsReply).length };
  });
}

// ── F4 recordings ────────────────────────────────────────────────────────

export type RecordingSourceState = { configured: boolean; error: string | null; setupHref: string };
export type RecordingsData = {
  rows: CallRecording[];
  sources: { plaud: RecordingSourceState; fathom: RecordingSourceState };
  sample: boolean;
};

export const RECORDINGS_EMPTY = 'No recordings yet.';

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'unknown length';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

// ── F5 Slack client board ────────────────────────────────────────────────

export type SlackLine = { channel: string; user: string; text: string; ts: string };
export type ClientLane = { clientId: string; name: string; channel: string; openUrl: string; messages: SlackLine[] };
export type ClientBoardData =
  | { state: 'unconfigured'; setupHref: string; clientsWithoutChannel: number }
  | { state: 'ready'; lanes: ClientLane[]; clientsWithoutChannel: number; sample: boolean; error: string | null };

export const normChannel = (c: string) => c.trim().replace(/^#/, '').toLowerCase();

/** Opens the channel in Slack by name (Slack's own redirect; no workspace id needed). */
export const slackChannelUrl = (channel: string) => `https://slack.com/app_redirect?channel=${encodeURIComponent(normChannel(channel))}`;

/** One lane per confirmed client with a Slack channel, newest messages first. */
export function clientLanes(
  clients: { clientId: string; name: string; slackChannel: string | null }[],
  messages: SlackLine[],
  perLane = 8,
): ClientLane[] {
  return clients
    .filter((c) => c.slackChannel && normChannel(c.slackChannel))
    .map((c) => {
      const channel = normChannel(c.slackChannel!);
      const mine = messages
        .filter((m) => normChannel(m.channel) === channel)
        .sort((a, b) => Number(b.ts) - Number(a.ts))
        .slice(0, perLane);
      return { clientId: c.clientId, name: c.name, channel, openUrl: slackChannelUrl(channel), messages: mine };
    });
}

// ── F5 week calendar ─────────────────────────────────────────────────────

export type WeekEvent = DigestEvent & { lane: number; lanes: number; topPct: number; heightPct: number };
export type WeekDay = { key: string; label: string; date: string; isToday: boolean; allDay: DigestEvent[]; timed: WeekEvent[] };
export type WeekData = { configured: boolean; setupHref: string; days: WeekDay[]; loHour: number; hiHour: number; sample: boolean };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

/**
 * Seven local days from today, events placed on an hour grid (lib/calendar-layout.ts):
 * overlapping events share the column in lanes, all-day events sit in a strip above.
 */
export function weekDays(events: DigestEvent[], now: Date): { days: WeekDay[]; loHour: number; hiHour: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const buckets = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const timedAll: { day: number; startMin: number; endMin: number; ev: DigestEvent }[] = [];
  const allDay: DigestEvent[][] = buckets.map(() => []);
  for (const ev of events) {
    const s = new Date(ev.start);
    if (!Number.isFinite(s.getTime())) continue;
    const day = buckets.findIndex((b) => ymd(b) === ymd(s));
    if (day < 0) continue;
    if (ev.allDay) {
      allDay[day].push(ev);
      continue;
    }
    const e = ev.end ? new Date(ev.end) : new Date(s.getTime() + 30 * 60_000);
    const startMin = minutesOf(s);
    const endMin = ymd(e) === ymd(s) ? Math.max(startMin + 15, minutesOf(e)) : 24 * 60;
    timedAll.push({ day, startMin, endMin, ev });
  }
  const { loHour, hiHour } = hourBounds(timedAll, { minSpanHours: 10, defaultLo: 8, defaultHi: 18 });
  const span = (hiHour - loHour) * 60;
  const days: WeekDay[] = buckets.map((b, i) => {
    const mine = timedAll.filter((t) => t.day === i).sort((a, z) => a.startMin - z.startMin);
    const lanes = assignLanes(mine);
    return {
      key: ymd(b),
      date: ymd(b),
      label: `${b.toLocaleDateString('en-US', { weekday: 'short' })} ${b.getDate()}`,
      isToday: i === 0,
      allDay: allDay[i],
      timed: mine.map((t, k) => ({
        ...t.ev,
        lane: lanes[k].lane,
        lanes: lanes[k].lanes,
        topPct: Math.max(0, ((t.startMin - loHour * 60) / span) * 100),
        heightPct: Math.max(2.5, ((Math.min(t.endMin, hiHour * 60) - Math.max(t.startMin, loHour * 60)) / span) * 100),
      })),
    };
  });
  return { days, loHour, hiHour };
}

/** Everything the page hands both trees for F3 to F5. */
export type CommsExtras = {
  digest: DigestPanelData;
  recordings: RecordingsData;
  clients: ClientBoardData;
  week: WeekData;
};
