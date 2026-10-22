'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowRight, Archive, Clock, ExternalLink, MapPin, Video } from 'lucide-react';
import { clock, messagesFor, relativeTime, whatsappNumber, type InboxThread, type ThreadMessage } from '@/lib/inbox';
import { Avatar, Mono, SourcePill, TriagePill, sourceLabel } from './bits';
import { MediaBlock } from './Media';
import { SetupLink } from '@/components/SetupLink';
import { setupHrefFor } from '@/lib/integrations-catalog';

export type ReaderHandle = { focusReply: () => void };

/**
 * Real history for the open chat, fetched on demand. The page renders every
 * thread at once, so loading history for all of them would read the whole
 * message table on each request — only the thread being read is pulled, and
 * the feed's one-line preview stands in until it arrives.
 */
export function useHistory(jid: string | undefined): { messages: ThreadMessage[] | null; loading: boolean } {
  const [messages, setMessages] = useState<ThreadMessage[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!jid) {
      setMessages(null);
      return;
    }
    let dead = false;
    setLoading(true);
    setMessages(null);
    fetch(`/api/whatsapp/thread?jid=${encodeURIComponent(jid)}&limit=80`)
      .then((r) => r.json())
      .then((b) => {
        if (!dead && b?.ok && Array.isArray(b.messages)) setMessages(b.messages as ThreadMessage[]);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!dead) setLoading(false);
      });
    return () => {
      dead = true;
    };
  }, [jid]);
  return { messages, loading };
}

const QUICK: { label: string; text: string }[] = [
  { label: '/draft reply', text: 'Thanks for this. ' },
  { label: '/confirm time', text: 'Confirmed on my end. ' },
  { label: '/ask for details', text: 'Can you send over the details so I can review? ' },
  { label: '/next steps', text: 'Next step on our side: ' },
];

/** Right column: the whole exchange and the reply bar. The derived-triage
    explainer that used to sit above the messages was removed — the queue a
    thread is in is not worth a panel of its own. */
export const InboxReader = forwardRef<
  ReaderHandle,
  {
    thread: InboxThread | null;
    /** A WhatsApp Business number is connected, so sending is possible at all. */
    whatsappSendReady: boolean;
    bodies: Record<string, ThreadMessage[]>;
    nowISO: string;
    done: boolean;
    onDone: () => void;
    onSnooze: () => void;
  }
>(function InboxReader({ thread, bodies, nowISO, whatsappSendReady, done, onDone, onSnooze }, ref) {
  const now = new Date(nowISO);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ focusReply: () => inputRef.current?.focus() }), []);
  // A draft belongs to one thread — never carry it into the next one.
  const threadKey = thread?.key ?? null;
  useEffect(() => {
    setDraft('');
    setStatus(null);
  }, [threadKey]);
  // Called before the empty-state return so the hook order never changes.
  const { messages: history, loading: historyLoading } = useHistory(thread?.jid);

  if (!thread) {
    return (
      <section className="ib-col ib-reader ib-reader-empty">
        <div>
          <p className="ib-empty-title">Pick a thread</p>
          <p className="ib-empty-sub">
            <kbd>j</kbd> <kbd>k</kbd> move · <kbd>r</kbd> reply · <kbd>e</kbd> done · <kbd>/</kbd> search
          </p>
        </div>
      </section>
    );
  }

  const t = thread;
  const messages = messagesFor(t, bodies);
  // Real history wins the moment it lands; the preview holds the space until then.
  const shown = history && history.length ? history : messages;

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setStatus(null);
    if (t.source === 'slack' && t.context) {
      const res = await fetch('/api/comms/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'slack', channel: t.context.replace(/^#/, ''), text }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      setStatus(body.detail ?? (res?.ok ? 'sent' : 'failed'));
      if (res?.ok) setDraft('');
      return;
    }
    if (t.source === 'email') {
      if (!t.replyTo) return setStatus('no reply address on this message');
      const res = await fetch('/api/comms/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'email', account: t.account, to: t.replyTo, subject: `Re: ${t.preview}`, text }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok && body.ok) {
        setStatus('sent');
        setDraft('');
        return;
      }
      window.location.href = `mailto:${t.replyTo}?subject=${encodeURIComponent(`Re: ${t.preview}`)}&body=${encodeURIComponent(text)}`;
      setStatus(body.error ? 'SMTP unavailable, opened a draft in Mail' : 'opened a draft in Mail');
      return;
    }
    if (t.source === 'whatsapp') {
      const res = await fetch('/api/comms/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'whatsapp', jid: t.jid, text }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok && body.ok) {
        setStatus('sent');
        setDraft('');
        return;
      }
      setStatus(body.error ? String(body.error) : 'could not send');
      return;
    }
  }

  // Why WhatsApp cannot be replied to, if it cannot. Reading comes from the
  // read-only desktop store, so sending is a separate connection entirely —
  // an unconfigured install is pointed at setup rather than told to go and
  // paste the message into WhatsApp itself.
  const waBlock =
    t.source !== 'whatsapp'
      ? null
      : !whatsappSendReady
        ? {
            title: 'Sending is not set up yet',
            body: 'This console reads WhatsApp from the desktop app on this Mac, which cannot send. Connect a WhatsApp Business number to reply from here.',
          }
        : !whatsappNumber(t.jid)
          ? {
              title: 'This chat cannot be replied to from here',
              body: 'The Business API can only message a phone number. This is a group or a linked id, so it has none.',
            }
          : null;
  const canReply = t.source !== 'calendar' && !waBlock;

  return (
    <section className="ib-col ib-reader">
      <header className="ib-reader-h">
        <Avatar name={t.sender} source={t.source} size={40} src={t.avatarUrl} />
        <div className="ib-reader-who">
          <div className="ib-reader-name">
            {t.sender}
            <SourcePill source={t.source} />
            <TriagePill triage={done ? 'done' : t.triage} />
          </div>
          <div className="ib-reader-sub">
            {t.context}
            {t.replyTo && (
              <>
                {' · '}
                <Mono>{t.replyTo}</Mono>
              </>
            )}
            {t.account && (
              <>
                {' · via '}
                <Mono>{t.account}</Mono>
              </>
            )}
          </div>
        </div>
        <div className="ib-reader-actions">
          {canReply && (
            <button className="ib-btn" onClick={onSnooze} title="Hide for 24 hours (saved on this browser)">
              <Clock strokeWidth={1.8} /> Snooze
            </button>
          )}
          <button className={`ib-btn ${done ? 'is-on' : ''}`} onClick={onDone} title="Mark done (e)">
            <Archive strokeWidth={1.8} /> {done ? 'Done' : 'Mark done'}
          </button>
          {t.event?.joinUrl && (
            <a className="ib-btn ib-btn-dark" href={t.event.joinUrl} target="_blank" rel="noreferrer">
              <Video strokeWidth={1.8} /> Join
            </a>
          )}
        </div>
      </header>

      <div className="ib-reader-body">
        {t.source === 'calendar' && t.event ? (
          <div className="ib-event">
            <div className="ib-event-row">
              <Mono className="ib-label">When</Mono>
              <span>
                {new Date(t.ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                {' · '}
                <Mono>
                  {t.event.allDay ? 'All day' : `${clock(t.ts)}${t.event.end ? ` – ${clock(t.event.end)}` : ''}`}
                </Mono>
              </span>
            </div>
            <div className="ib-event-row">
              <Mono className="ib-label">Calendar</Mono>
              <span>
                <span className="ib-cal-swatch" style={{ background: t.event.color }} />
                {t.context}
              </span>
            </div>
            {t.event.location && (
              <div className="ib-event-row">
                <Mono className="ib-label">Where</Mono>
                <span>
                  <MapPin strokeWidth={1.8} className="ib-inline-ic" />
                  {t.event.location}
                </span>
              </div>
            )}
            {t.event.joinUrl && (
              <div className="ib-event-row">
                <Mono className="ib-label">Link</Mono>
                <a href={t.event.joinUrl} target="_blank" rel="noreferrer" className="ib-link">
                  {t.event.joinUrl} <ExternalLink strokeWidth={1.8} className="ib-inline-ic" />
                </a>
              </div>
            )}
          </div>
        ) : (
          <div className="ib-thread">
            {historyLoading && <p className="ib-thread-note">Loading this conversation…</p>}
            {shown.map((m, i) => (
              <div key={i} className={`ib-msg ${m.from === 'me' ? 'is-me' : ''}`}>
                {m.from === 'them' && <Avatar name={t.sender} source={t.source} size={28} src={t.avatarUrl} />}
                <div className="ib-msg-body">
                  <Mono className="ib-msg-meta">
                    {m.from === 'me' ? 'You' : m.author || t.sender} · {clock(m.ts)} · {relativeTime(m.ts, now)}
                  </Mono>
                  {m.media && <MediaBlock media={m.media} />}
                  {m.text && <div className="ib-bubble">{m.text}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {waBlock && (
        <footer className="ib-reply ib-reply-blocked">
          <div className="ib-setup-note">
            <p className="ib-setup-title">{waBlock.title}</p>
            <p className="ib-setup-body">{waBlock.body}</p>
          </div>
          <SetupLink href={setupHrefFor('whatsapp')} label="Set up WhatsApp" />
        </footer>
      )}

      {canReply && (
        <footer className="ib-reply">
          <div className="ib-quick">
            {QUICK.map((q) => (
              <button
                key={q.label}
                className="ib-quick-chip"
                onClick={() => {
                  setDraft((d) => (d ? d : q.text));
                  inputRef.current?.focus();
                }}
              >
                <Mono>{q.label}</Mono>
              </button>
            ))}
          </div>
          <div className="ib-ask">
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              placeholder={`Reply to ${t.sender} on ${sourceLabel(t.source)}`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="ib-send" onClick={() => void send()} title="Send (⌘↵)" aria-label="Send">
              <ArrowRight strokeWidth={2} />
            </button>
          </div>
          <div className="ib-reply-foot">
            <Mono>⌘↵ to send</Mono>
            {status && <Mono className="ib-status">{status}</Mono>}
          </div>
        </footer>
      )}
    </section>
  );
});
