import { PageHeader } from '@/components/PageHeader';
import { SectionHead } from '@/components/terminal';
import { ConnectFlow } from '@/components/ConnectFlow';
import { whatsappStatus, sendConfigured } from '@/lib/connectors/whatsapp';
import { WhatsAppG } from '@/components/integrations/WhatsAppG';
import { getAppearance } from '@/lib/appearance-server';
import { treeFor } from '@/lib/appearance';

export const dynamic = 'force-dynamic';

/**
 * WhatsApp configuration — the deeper surface behind the tile.
 *
 * It exists because one green "connected" dot was misleading: GladOS reads
 * WhatsApp from the desktop app on this Mac and cannot send a single message
 * that way. Reading and sending are separate connections with separate
 * limits, so each is stated on its own here, with what it does and does not
 * make possible.
 */

type Row = { label: string; value: string };

function Facts({ rows }: { rows: Row[] }) {
  return (
    <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[150px_1fr]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-os-dim">{r.label}</dt>
          <dd className="text-[12.5px] leading-relaxed text-os-text">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Pill({ state }: { state: 'connected' | 'not_configured' | 'error' }) {
  const label = state === 'connected' ? 'Live' : state === 'error' ? 'Error' : 'Not configured';
  const tone =
    state === 'connected'
      ? 'text-os-accent'
      : state === 'error'
        ? 'text-[var(--err)]'
        : 'text-os-dim';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-[3px] font-mono text-[10.5px] uppercase tracking-[0.1em] ${tone}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <span
        className="h-[6px] w-[6px] rounded-full"
        style={{ background: state === 'connected' ? 'var(--accent)' : state === 'error' ? 'var(--err)' : 'var(--text-3)' }}
      />
      {label}
    </span>
  );
}

export default async function WhatsAppConfigPage() {
  const status = await whatsappStatus();
  const capabilities = status.capabilities ?? [];
  const read = capabilities.find((c) => c.id === 'read');
  const send = capabilities.find((c) => c.id === 'send');
  const canSend = sendConfigured();

  // Two trees, one fetch (glados-ui SPEC X5, S05 F05.80).
  if (treeFor(getAppearance(), '/integrations/whatsapp') === 'glados') {
    return <WhatsAppG readState={read?.state ?? status.state} readDetail={read?.detail ?? status.detail} sendState={send?.state ?? 'not_configured'} canSend={canSend} />;
  }

  return (
    <div>
      <PageHeader eyebrow="Connection settings" title="WhatsApp" back={{ href: '/integrations', label: 'Connections' }} />

      <p className="mb-8 max-w-[58ch] text-[13px] leading-relaxed text-os-dim">
        WhatsApp is two connections, not one. Reading works off the desktop app already installed on
        this Mac. Sending cannot use that route at all, so it needs a WhatsApp Business number of its
        own. Each is configured separately below.
      </p>

      <section className="mb-8">
        <SectionHead label="Reading" count={1} />
        <div className="rounded-lg-t border border-os-border bg-os-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[14.5px] font-medium text-os-text">Local desktop app</div>
              <div className="mt-1 text-[12.5px] text-os-dim">Reads the WhatsApp database on this Mac, read-only</div>
            </div>
            <Pill state={read?.state ?? status.state} />
          </div>
          <Facts
            rows={[
              { label: 'Status', value: read?.detail ?? status.detail },
              { label: 'Setup', value: 'Nothing to paste. Requires the desktop app signed in, and Full Disk Access for the process running this console.' },
              { label: 'Gives you', value: 'Every chat, real message history, profile pictures, and downloaded media — voice notes, images, video, documents.' },
              { label: 'Cannot do', value: 'Send anything. The app owns the encryption session, so writing to its store transmits nothing.' },
            ]}
          />
        </div>
      </section>

      <section className="mb-8">
        <SectionHead label="Sending" count={1} />
        <div className="rounded-lg-t border border-os-border bg-os-surface p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[14.5px] font-medium text-os-text">WhatsApp Business Cloud API</div>
              <div className="mt-1 text-[12.5px] text-os-dim">Meta&apos;s official API, on a business number</div>
            </div>
            <Pill state={send?.state ?? 'not_configured'} />
          </div>
          <Facts
            rows={[
              { label: 'Setup', value: 'Paste the phone number id and access token from developers.facebook.com → your app → WhatsApp → API Setup.' },
              { label: 'Gives you', value: 'Replies sent from here to anyone who messaged your business number, within 24 hours of their last message.' },
              {
                label: 'Cannot do',
                value:
                  'Reach the personal chats above. It runs on a separate business number, cannot message groups or linked ids, and outside the 24-hour window only pre-approved templates go through.',
              },
            ]}
          />
          <div className="mt-5 border-t border-os-hairline pt-4">
            <ConnectFlow
              slug="whatsapp"
              connected={canSend}
              keySaved={canSend}
              keys={['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN']}
            />
          </div>
        </div>
      </section>

      <section className="mb-8">
        <SectionHead label="Other ways to send" count={1} />
        <div className="rounded-lg-t border border-os-border bg-os-surface p-6">
          <div className="text-[14.5px] font-medium text-os-text">Linked device</div>
          <div className="mt-1 text-[12.5px] text-os-dim">Not built</div>
          <Facts
            rows={[
              {
                label: 'What it is',
                value:
                  'Pairing this console to your personal account by QR, the way WhatsApp Web does. It is the only route that can reply to the personal chats and groups above.',
              },
              {
                label: 'Why it is not here',
                value:
                  'It relies on an unofficial library. Meta does not sanction it and accounts get banned for automated use, so it is a deliberate decision rather than a default.',
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
}
