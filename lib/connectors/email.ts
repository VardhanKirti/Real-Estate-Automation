import { ImapFlow } from 'imapflow';
import type { ConnectorStatus } from '@/lib/connectors/types';
import type { CommsItem } from '@/lib/comms';
import { isFilming, demoConnector } from '@/lib/demo-mode';
import { TTL, keyTag, swr } from '@/lib/swr';
import { runtimeEnv } from '@/lib/creds';

export type InboxConfig = {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  pass: string;
  smtpHost: string; // for sending replies
  smtpPort: number;
};

const MAX_INBOXES = 4;

export function parseInboxConfigs(env: Record<string, string | undefined>): InboxConfig[] {
  const inboxes: InboxConfig[] = [];
  for (let slot = 1; slot <= MAX_INBOXES; slot++) {
    const host = env[`INBOX_${slot}_HOST`];
    const user = env[`INBOX_${slot}_USER`];
    const pass = env[`INBOX_${slot}_PASS`];
    if (!host || !user || !pass) continue;
    inboxes.push({
      id: `inbox-${slot}`,
      name: env[`INBOX_${slot}_NAME`] ?? user,
      host,
      port: Number(env[`INBOX_${slot}_PORT`] ?? 993),
      user,
      pass,
      smtpHost: env[`INBOX_${slot}_SMTP_HOST`] ?? host.replace(/^imap\./, 'smtp.'),
      smtpPort: Number(env[`INBOX_${slot}_SMTP_PORT`] ?? 465),
    });
  }
  return inboxes;
}

/**
 * GladOS verified-sender rule : the app NEVER sends email
 * directly. A reply becomes a Gmail DRAFT on the verified sender via the `gsend`
 * tool (whose OAuth token IS the sender identity), and a human approves it
 * with the QUEUE label before gsend's daemon actually sends. SMTP send is
 * deliberately gone — gsend is the only path out.
 *
 * Honest: returns `{ ok: false, error }` instead of throwing when no inbox is
 * configured, the recipient is empty, or drafting fails — the UI falls back
 * to a mailto: draft on a non-ok result.
 */
export async function sendEmailReply(
  reply: { accountId?: string; to: string; subject: string; text: string },
  env: Record<string, string | undefined> = runtimeEnv(),
): Promise<{ ok: boolean; error?: string; drafted?: boolean }> {
  const inboxes = parseInboxConfigs(env);
  if (inboxes.length === 0) return { ok: false, error: 'no inbox configured (set INBOX_n_* in .env.local)' };
  if (!reply.to || reply.to.trim() === '') return { ok: false, error: 'no recipient address' };
  try {
    const { execFile } = await import('node:child_process');
    const os = await import('node:os');
    const gsend = env.GSEND_BIN ?? `${os.homedir()}/bin/gsend`;
    const draftId = await new Promise<string>((resolve, reject) => {
      const child = execFile(gsend, ['draft', reply.to, reply.subject], { timeout: 20000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      });
      child.stdin?.write(reply.text);
      child.stdin?.end();
    });
    return draftId ? { ok: true, drafted: true } : { ok: false, error: 'gsend returned no draft id' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type InboxUnread = { inbox: string; unread: number; error?: string };

/** Shared IMAP client options with fail-fast timeouts: a throttled Gmail
 * connect must degrade the dashboard (error entry, zero counts), never stall
 * the render. */
export function imapClientOptions(config: InboxConfig) {
  return {
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    logger: false as const,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  };
}

async function unreadCount(config: InboxConfig): Promise<InboxUnread> {
  const client = new ImapFlow(imapClientOptions(config));
  try {
    await client.connect();
    const status = await client.status('INBOX', { unseen: true });
    return { inbox: config.name, unread: status.unseen ?? 0 };
  } catch (err) {
    return { inbox: config.name, unread: 0, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function unreadCounts(env: Record<string, string | undefined> = runtimeEnv()): Promise<InboxUnread[]> {
  const inboxes = parseInboxConfigs(env);
  if (inboxes.length === 0) return [];
  // One IMAP login per inbox (Analytics, the Email Worker): same comms window as the feed.
  return swr(`email:unread:${keyTag(JSON.stringify(inboxes))}`, TTL.comms, () => Promise.all(inboxes.map(unreadCount)));
}

/** Latest message envelopes across every configured inbox, for the Comms feed. */
export async function latestEmails(
  limitPerInbox = 5,
  env: Record<string, string | undefined> = runtimeEnv(),
): Promise<CommsItem[]> {
  const inboxes = parseInboxConfigs(env);
  if (inboxes.length === 0) return [];
  // One IMAP login per inbox per render was the slow part of Home and Comms: a real fetch at most
  // 30s old renders at once, an older one (up to 5 min) while a new fetch runs (lib/swr.ts).
  const tag = keyTag(JSON.stringify(inboxes));
  return swr(`email:latest:${tag}:${limitPerInbox}`, TTL.comms, () => latestEmailsLive(inboxes, limitPerInbox));
}

async function latestEmailsLive(inboxes: InboxConfig[], limitPerInbox: number): Promise<CommsItem[]> {
  const items: CommsItem[] = [];
  await Promise.all(
    inboxes.map(async (config) => {
      const client = new ImapFlow(imapClientOptions(config));
      try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
          const mailbox = client.mailbox;
          const exists = typeof mailbox === 'object' && mailbox ? mailbox.exists : 0;
          if (!exists) return;
          const start = Math.max(1, exists - limitPerInbox + 1);
          for await (const msg of client.fetch(`${start}:*`, { envelope: true, flags: true })) {
            const from = msg.envelope?.from?.[0];
            items.push({
              source: 'email',
              title: `${config.name} — ${from?.name || from?.address || 'unknown sender'}`,
              sender: from?.name || from?.address || 'unknown sender',
              replyTo: from?.address,
              account: config.id,
              preview: msg.envelope?.subject ?? '(no subject)',
              ts: (msg.envelope?.date ?? new Date(0)).toISOString(),
              unread: msg.flags?.has('\\Seen') ? 0 : 1,
            });
          }
        } finally {
          lock.release();
        }
      } catch {
        // inbox-level failures already surface via emailStatus; skip in feed
      } finally {
        await client.logout().catch(() => {});
      }
    }),
  );
  return items;
}

export async function emailStatus(env: Record<string, string | undefined> = runtimeEnv()): Promise<ConnectorStatus> {
  // Filming mode: scripted stand-in (lib/demo-mode.ts)
  if (isFilming()) return demoConnector('email')!;
  const inboxes = parseInboxConfigs(env);
  if (inboxes.length === 0) {
    return {
      id: 'email',
      name: 'Email Inboxes',
      kind: 'email',
      state: 'not_configured',
      detail: 'No inboxes configured. Set INBOX_1_HOST / _USER / _PASS (up to 4 slots) in .env.local.',
      meta: { configured: 0, slots: MAX_INBOXES },
    };
  }
  const counts = await unreadCounts(env);
  const errors = counts.filter((c) => c.error);
  const totalUnread = counts.reduce((sum, c) => sum + c.unread, 0);
  if (errors.length === counts.length) {
    return {
      id: 'email',
      name: 'Email Inboxes',
      kind: 'email',
      state: 'error',
      detail: `All ${counts.length} inbox connections failed: ${errors[0].error}`,
      meta: { configured: inboxes.length },
    };
  }
  return {
    id: 'email',
    name: 'Email Inboxes',
    kind: 'email',
    state: 'connected',
    detail: `${inboxes.length} inbox${inboxes.length > 1 ? 'es' : ''} · ${totalUnread} unread${
      errors.length ? ` · ${errors.length} failing` : ''
    }`,
    meta: { configured: inboxes.length, unread: totalUnread },
  };
}
