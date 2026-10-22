import { WebClient } from '@slack/web-api';
import type { ConnectorStatus } from '@/lib/connectors/types';
import { isFilming, demoConnector } from '@/lib/demo-mode';
import { runtimeEnv } from '@/lib/creds';
import { TTL, keyTag, swr } from '@/lib/swr';

export type SlackMessage = { channel: string; user: string; text: string; ts: string };

function client(env: Record<string, string | undefined>): WebClient | null {
  return env.SLACK_BOT_TOKEN ? new WebClient(env.SLACK_BOT_TOKEN) : null;
}

export async function slackStatus(env: Record<string, string | undefined> = runtimeEnv()): Promise<ConnectorStatus> {
  // Filming mode: scripted stand-in (lib/demo-mode.ts)
  if (isFilming()) return demoConnector('slack')!;
  const slack = client(env);
  if (!slack) {
    return {
      id: 'slack',
      name: 'Slack',
      kind: 'slack',
      state: 'not_configured',
      detail: 'Set SLACK_BOT_TOKEN (xoxb-…) in .env.local. Needs channels:read, channels:history, users:read scopes.',
    };
  }
  try {
    const auth = await slack.auth.test();
    return {
      id: 'slack',
      name: 'Slack',
      kind: 'slack',
      state: 'connected',
      detail: `Connected to ${auth.team} as ${auth.user}`,
      meta: { team: String(auth.team ?? ''), user: String(auth.user ?? '') },
    };
  } catch (err) {
    return {
      id: 'slack',
      name: 'Slack',
      kind: 'slack',
      state: 'error',
      detail: `Token set but auth failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type SlackSendResult = { ok: boolean; detail: string };

/** Post a reply into a channel by name. Fails honestly without a token. */
export async function sendSlackMessage(
  channelName: string,
  text: string,
  env: Record<string, string | undefined> = runtimeEnv(),
): Promise<SlackSendResult> {
  const slack = client(env);
  if (!slack) return { ok: false, detail: 'SLACK_BOT_TOKEN not set — add it under Connections → API keys' };
  try {
    const list = await slack.conversations.list({ types: 'public_channel,private_channel', limit: 200 });
    const channel = list.channels?.find((c) => c.name === channelName.replace(/^#/, ''));
    if (!channel?.id) return { ok: false, detail: `channel #${channelName} not found or bot not invited` };
    await slack.chat.postMessage({ channel: channel.id, text });
    return { ok: true, detail: `sent to #${channelName}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function recentMessages(
  limit = 10,
  env: Record<string, string | undefined> = runtimeEnv(),
): Promise<SlackMessage[]> {
  const slack = client(env);
  if (!slack) throw new Error('SLACK_BOT_TOKEN is not set');
  // One list call plus one history call per channel, in sequence, was the slow part of the comms
  // feed: on the comms window (lib/swr.ts) a real pull at most 30s old is reused, an older one (up
  // to 5 min) while one refresh runs. The pull is at most 10 channels x 5 messages, cached whole.
  const all = await swr(`slack:recent:${keyTag(env.SLACK_BOT_TOKEN ?? '')}`, TTL.comms, () => pullRecent(slack));
  return all.slice(0, limit);
}

async function pullRecent(slack: WebClient): Promise<SlackMessage[]> {
  const channels = await slack.conversations.list({ limit: 10, exclude_archived: true, types: 'public_channel' });
  const member = (channels.channels ?? []).filter((c) => c.id && c.is_member);
  const histories = await Promise.all(member.map((c) => slack.conversations.history({ channel: c.id!, limit: 5 })));
  const messages: SlackMessage[] = [];
  member.forEach((channel, i) => {
    for (const msg of histories[i].messages ?? []) {
      messages.push({
        channel: channel.name ?? channel.id!,
        user: msg.user ?? 'unknown',
        text: msg.text ?? '',
        ts: msg.ts ?? '',
      });
    }
  });
  return messages.sort((a, b) => Number(b.ts) - Number(a.ts));
}
