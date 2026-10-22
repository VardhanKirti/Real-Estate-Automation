import { InboxWorkspace } from '@/components/inbox/InboxWorkspace';
import { InboxG } from '@/components/inbox/InboxG';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';
import { gatherCommsFeed } from '@/lib/comms-feed';
import { annotatePriorities } from '@/lib/comms';
import { buildThreads, type InboxSource } from '@/lib/inbox';
import { emailStatus } from '@/lib/connectors/email';
import { slackStatus } from '@/lib/connectors/slack';
import { whatsappStatus, weeklyMessages } from '@/lib/connectors/whatsapp';
import { sendCreds } from '@/lib/connectors/whatsapp-send';
import { calendarStatus, upcomingEvents } from '@/lib/connectors/gcal';
import { getDb } from '@/lib/data';
import { cachedStatus } from '@/lib/connectors';
import { isFilming, demoEvents, demoThreadBodies } from '@/lib/demo-mode';
import { buildCommsExtras } from '@/lib/comms-extras-server';

export const dynamic = 'force-dynamic';

/**
 * /inbox — the comms redo (2026-09-16), shipped beside /comms while it is
 * judged. Every channel in one list with the source in words, a triage state
 * derived from the message, and a reader that shows the whole exchange.
 */
export default async function InboxPage(props: { searchParams?: { sample?: string } }) {
  const now = new Date();
  const [rawFeed, email, slack, whatsapp, calendar, liveEvents, weekly] = await Promise.all([
    gatherCommsFeed(140),
    // Source chips: cached real checks, shared with the connector board's window (lib/swr.ts).
    cachedStatus('email', () => emailStatus()),
    cachedStatus('slack', () => slackStatus()),
    cachedStatus('whatsapp', whatsappStatus),
    cachedStatus('calendar', () => calendarStatus()),
    upcomingEvents(undefined, { days: 7, limit: 200, now }),
    weeklyMessages(now),
  ]);
  // Filming mode: a scripted week and thread histories (lib/demo-mode.ts). Otherwise
  // thread histories arrive once the connectors expose them; until then the
  // reader shows the latest message the feed knows about.
  const events = isFilming() ? demoEvents() : liveEvents;
  const bodies = isFilming() ? demoThreadBodies() : {};
  const feed = annotatePriorities(rawFeed, getDb().contactTags.all());
  const threads = buildThreads(feed, events, now);
  const connected: Record<InboxSource, boolean> = {
    email: email.state === 'connected',
    slack: slack.state === 'connected',
    whatsapp: whatsapp.state === 'connected',
    calendar: calendar.state === 'connected',
  };
  // FounderOS additions (F3 digest, F4 recordings, F5 client board and week): one fetch, both trees.
  // `props?` because the smoke test renders every page with no arguments.
  const extras = await buildCommsExtras({
    url: `/inbox${props?.searchParams?.sample === '1' ? '?sample=1' : ''}`,
    events: events.map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay })),
    slackConnected: connected.slack,
    calendarConnected: connected.calendar,
    now,
  });
  // GladOS tree (glados-ui SPEC S04 §4.9, X5): same data and state hook, kit presentation.
  const Tree = treeFor(getAppearance(), '/inbox') === 'glados' ? InboxG : InboxWorkspace;
  return (
    <Tree
      threads={threads}
      bodies={bodies}
      connected={connected}
      nowISO={now.toISOString()}
      weekly={weekly}
      whatsappSendReady={!!sendCreds()}
      extras={extras}
    />
  );
}
