/**
 * The one server fetch behind /inbox's FounderOS additions (F3, F4, F5). Reads
 * SQLite plus the Slack pull the comms feed already cached (lib/swr.ts); no
 * other network call. Fathom is pulled on demand by GET /api/calls/archive
 * when the Recordings tab opens (10 minute cache), never by the render.
 *
 * Sample (`?sample=1` on a blank feature) and Filming answer with the fixtures
 * in lib/fo-sample.ts and set `sample`, so every tree shows the Sample badge.
 */
import { getDb } from '@/lib/data';
import { cronEnabled } from '@/lib/gates';
import { digestDate } from '@/lib/comms-digest-run';
import type { CommsDigest } from '@/lib/comms-digest';
import { fathomKey } from '@/lib/connectors/fathom';
import { plaudIngestConfigured } from '@/lib/connectors/plaud';
import { recentMessages } from '@/lib/connectors/slack';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { foMode, sampleClientLanes, sampleDigestBody, sampleRecordings, sampleWeekEvents } from '@/lib/fo-sample';
import { clientLanes, digestState, weekDays, type CommsExtras, type DigestEvent } from '@/lib/comms-extras';

export async function buildCommsExtras(opts: {
  url: string;
  events: DigestEvent[];
  slackConnected: boolean;
  calendarConnected: boolean;
  now?: Date;
}): Promise<CommsExtras> {
  const now = opts.now ?? new Date();
  const db = getDb();
  const today = digestDate(now.getTime());
  const cron = cronEnabled();

  // F3 digest
  const latest = db.commsDigests.latest();
  const digestMode = foMode(opts.url, latest === null);
  const isToday = (e: DigestEvent) => digestDate(Date.parse(e.start)) === today;
  const digest: CommsExtras['digest'] =
    digestMode !== 'live'
      ? {
          state: 'ready',
          digest: { id: 'sample-digest', date: today, body: sampleDigestBody(now) as unknown as CommsDigest, createdAt: now.toISOString() },
          read: false,
          clearedKeys: [],
          cronEnabled: cron,
          today: sampleWeekEvents(now).filter(isToday),
          sample: true,
        }
      : {
          state: digestState({ cronEnabled: cron, latestDate: latest?.date ?? null, today }),
          digest: latest ? { id: latest.id, date: latest.date, body: latest.body as CommsDigest, createdAt: latest.createdAt } : null,
          read: latest ? db.commsDigests.isRead(latest.id) : false,
          clearedKeys: db.commsDigests.reads.clearedKeys(),
          cronEnabled: cron,
          today: opts.events.filter(isToday),
          sample: false,
        };

  // F4 recordings
  const fathomOn = Boolean(fathomKey());
  const recMode = foMode(opts.url, db.callRecordings.count() === 0 && !fathomOn);
  const recordings: CommsExtras['recordings'] = {
    rows: recMode !== 'live' ? sampleRecordings(now) : db.callRecordings.recent(200),
    sources: {
      plaud: { configured: plaudIngestConfigured(), error: null, setupHref: setupHrefFor('plaud') },
      fathom: { configured: fathomOn, error: null, setupHref: setupHrefFor('fathom') },
    },
    sample: recMode !== 'live',
  };

  // F5 Slack client board
  const confirmed = db.clientConfirmations.all();
  const withChannel = confirmed.filter((c) => c.slackChannel);
  const clientMode = foMode(opts.url, withChannel.length === 0);
  let clients: CommsExtras['clients'];
  if (clientMode !== 'live') {
    clients = { state: 'ready', lanes: sampleClientLanes(now), clientsWithoutChannel: 0, sample: true, error: null };
  } else if (!opts.slackConnected) {
    clients = { state: 'unconfigured', setupHref: setupHrefFor('slack'), clientsWithoutChannel: confirmed.length - withChannel.length };
  } else {
    let messages: Awaited<ReturnType<typeof recentMessages>> = [];
    let error: string | null = null;
    if (withChannel.length > 0) {
      try {
        messages = await recentMessages(200);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    clients = { state: 'ready', lanes: clientLanes(withChannel, messages), clientsWithoutChannel: confirmed.length - withChannel.length, sample: false, error };
  }

  // F5 week calendar
  const weekMode = foMode(opts.url, opts.events.length === 0 && !opts.calendarConnected);
  const weekEvents = weekMode !== 'live' ? sampleWeekEvents(now) : opts.events;
  const placed = weekDays(weekEvents, now);
  const week: CommsExtras['week'] = {
    configured: weekMode !== 'live' || opts.calendarConnected,
    setupHref: setupHrefFor('calendar'),
    ...placed,
    sample: weekMode !== 'live',
  };

  return { digest, recordings, clients, week };
}
