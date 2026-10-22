import { mergeFeed, type CommsItem } from '@/lib/comms';
import { latestEmails } from '@/lib/connectors/email';
import { recentChats } from '@/lib/connectors/whatsapp';
import { recentMessages } from '@/lib/connectors/slack';
import { isFilming, demoComms } from '@/lib/demo-mode';
import { runtimeEnv } from '@/lib/creds';

/** Gather the unified comms feed from every source that is reachable. */
export async function gatherCommsFeed(limit = 40): Promise<CommsItem[]> {
  // Filming mode: scripted stand-in (lib/demo-mode.ts)
  if (isFilming()) return demoComms().slice(0, limit);
  // Each source is asked for as much as the caller wants. The old fixed 15/5/15
  // capped WhatsApp at the 15 newest chats however large the request, so unread
  // sitting in older chats never reached the feed at all.
  const per = Math.max(15, Math.min(limit, 200));
  const [whatsapp, email, slack] = await Promise.allSettled([
    recentChats(per),
    latestEmails(Math.min(per, 50)),
    runtimeEnv().SLACK_BOT_TOKEN
      ? recentMessages(per).then((messages) =>
          messages.map(
            (m): CommsItem => ({
              source: 'slack',
              title: `#${m.channel} — ${m.user}`,
              sender: m.user,
              replyTo: m.channel,
              preview: m.text.slice(0, 140),
              ts: new Date(Number(m.ts) * 1000).toISOString(),
            }),
          ),
        )
      : Promise.resolve([] as CommsItem[]),
  ]);
  const items: CommsItem[] = [
    ...(whatsapp.status === 'fulfilled' ? whatsapp.value : []),
    ...(email.status === 'fulfilled' ? email.value : []),
    ...(slack.status === 'fulfilled' ? slack.value : []),
  ];
  return mergeFeed(items, limit);
}
