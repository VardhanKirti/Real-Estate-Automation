'use client';

/**
 * The Instagram DM inbox under the GladOS style (glados-ui SPEC S03 F3 H2,
 * F6): a GSheet with the thread list and the conversation. Same state as
 * Classic (useDmInbox); replies go out through ManyChat, ⌘ or Ctrl + Enter
 * sends, a failed send shows inline and appends nothing.
 */

import { Send } from 'lucide-react';
import { GButton, GEmpty, GErrorLine, GList, GRow, GSheet, GTag, GTextarea } from '@/components/g';
import type { DmThread } from '@/lib/social';
import { initials, relativeTime, useDmInbox } from './use-dm-inbox';

export function DmInboxSheetG({ open, threads, nowMs, onClose }: { open: boolean; threads: DmThread[]; nowMs: number; onClose: () => void }) {
  return (
    <GSheet open={open} onClose={onClose} title="Instagram DMs" caption="Reply here. Replies send through ManyChat." width={1040}>
      <DmInboxG threads={threads} nowMs={nowMs} />
    </GSheet>
  );
}

function DmInboxG({ threads: initial, nowMs }: { threads: DmThread[]; nowMs: number }) {
  const { threads, active, setSelected, draft, setDraft, sending, error, isLive, send } = useDmInbox(initial);
  return (
    <div className="soc-g-inbox">
      <div className="soc-g-inbox-status">
        <GTag tone={isLive ? 'ok' : 'neutral'} dot>{isLive ? 'Live · ManyChat' : 'Seeded · goes live via the ManyChat webhook'}</GTag>
        <span className="soc-g-cap">{threads.length} conversations</span>
      </div>
      {threads.length === 0 ? (
        <GEmpty title="No DMs yet" body="They appear here as ManyChat posts them to the webhook." />
      ) : (
        <div className="soc-g-inbox-grid">
          <div className="soc-g-threads">
            <GList label="Conversations">
              {threads.map((t) => (
                <GRow
                  key={t.subscriberId}
                  selected={t.subscriberId === active?.subscriberId}
                  onClick={() => setSelected(t.subscriberId)}
                  leading={<span className="soc-g-avatar" aria-hidden>{initials(t.name)}</span>}
                  title={t.name}
                  meta={`${t.last.direction === 'out' ? 'You: ' : ''}${t.last.text}`}
                  trailing={
                    <span className="soc-g-thread-trail">
                      <span className="soc-g-cap">{relativeTime(t.last.ts, nowMs)}</span>
                      {t.unreplied && <GTag tone="warn" size="xs" title="The last message is inbound">Reply</GTag>}
                    </span>
                  }
                />
              ))}
            </GList>
          </div>
          {active && (
            <div className="soc-g-convo">
              <div className="soc-g-convo-head">
                <span className="soc-g-convo-name">{active.name}</span>
                {active.handle && <span className="soc-g-cap">@{active.handle.replace(/^@/, "")}</span>}
                {active.unreplied && <GTag tone="warn" dot>Needs reply</GTag>}
              </div>
              <div className="soc-g-msgs">
                {active.messages.map((m) => (
                  <div key={m.id} className="soc-g-msg" data-dir={m.direction}>
                    <div className="soc-g-bubble">{m.text}</div>
                    <span className="soc-g-cap">{m.tag ? `${m.tag} · ` : ''}{relativeTime(m.ts, nowMs)}</span>
                  </div>
                ))}
              </div>
              <div className="soc-g-reply">
                {error && <GErrorLine align="left">{error}</GErrorLine>}
                <div className="soc-g-reply-row">
                  <GTextarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    rows={1}
                    maxLines={5}
                    aria-label={`Reply to ${active.name}`}
                    placeholder={`Reply to ${active.name} (⌘ Enter sends)`}
                  />
                  <GButton variant="ink" onClick={() => void send()} busy={sending} disabled={!draft.trim()} disabledReason="Write a reply first">
                    <Send size={14} strokeWidth={1.75} aria-hidden /> Send
                  </GButton>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
