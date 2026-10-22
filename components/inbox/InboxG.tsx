'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ArrowDownWideNarrow, CalendarDays, Hash, Mail, MessageSquare, SlidersHorizontal, Video, type LucideIcon } from 'lucide-react';
import {
  GAsk,
  GBarChart,
  GButton,
  GCard,
  GChip,
  GDelta,
  GDrawer,
  GEmpty,
  GHeroCard,
  GKeyValue,
  GList,
  GMenu,
  GPage,
  GPopover,
  GRow,
  GSearch,
  GSectionHeader,
  GSegmented,
  GStat,
  GTabs,
  GTag,
} from '@/components/g';
import type { CommsExtras } from '@/lib/comms-extras';
import { ClientsBoardG, DigestBannerG, RecordingsG, WeekG } from '@/components/comms-fo/CommsFoG';
import {
  BUCKET_LABEL,
  RANGES,
  SORTS,
  SOURCES,
  TRIAGE,
  clock,
  dateBucket,
  initials,
  messagesFor,
  relativeTime,
  whatsappNumber,
  type InboxSource,
  type InboxThread,
  type Range,
  type ThreadMessage,
  type Triage,
} from '@/lib/inbox';
import { replyByChannel, type StatCard, type WeeklyInput } from '@/lib/inbox-stats';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { useHistory, type ReaderHandle } from './InboxReader';
import { useInboxWorkspace } from './useInboxWorkspace';

/**
 * /inbox under the GladOS style (glados-ui SPEC S04 §4.9, X5). Same state and
 * keys as the Classic workspace (useInboxWorkspace); kit presentation with
 * the duplicates removed: the reply count once (a hero), no "Channels live"
 * card and no "n/n connected" in the header (F-I2, AC04.34), the channel
 * list as status rows that do not filter (F-I3, AC04.35), Done and Snooze on
 * this browser with the toast saying so (F-I6), and at narrow widths the list
 * alone with the reader as a full-screen sheet (AC04.37).
 */
type CommsTab = 'threads' | 'recordings' | 'clients' | 'week';
const COMMS_TABS: { value: CommsTab; label: string }[] = [
  { value: 'threads', label: 'Threads' },
  { value: 'recordings', label: 'Recordings' },
  { value: 'clients', label: 'Clients' },
  { value: 'week', label: 'Week' },
];
function readTab(): CommsTab {
  if (typeof window === 'undefined') return 'threads';
  const t = new URL(window.location.href).searchParams.get('tab');
  return COMMS_TABS.some((x) => x.value === t) ? (t as CommsTab) : 'threads';
}

const ICON: Record<InboxSource, LucideIcon> = { email: Mail, slack: Hash, whatsapp: MessageSquare, calendar: CalendarDays };
const label = (s: InboxSource) => SOURCES.find((x) => x.id === s)?.label ?? s;
const triageLabel = (t: Triage) => TRIAGE.find((x) => x.id === t)?.label ?? t;
const TRIAGE_TONE: Record<Triage, 'err' | 'warn' | 'neutral' | 'ok'> = { reply: 'err', waiting: 'warn', fyi: 'neutral', done: 'ok' };

function useNarrow(px = 900): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [px]);
  return narrow;
}

function Face({ name, source, src, size = 34 }: { name: string; source: InboxSource; src?: string; size?: number }) {
  const Icon = ICON[source];
  return (
    <span className="wg-ib-face" style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }} aria-hidden>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" />
      ) : source === 'calendar' ? (
        <Icon size={Math.round(size * 0.46)} strokeWidth={1.6} />
      ) : (
        initials(name)
      )}
    </span>
  );
}

function SourceTag({ source }: { source: InboxSource }) {
  const Icon = ICON[source];
  return (
    <GTag>
      <Icon size={11} strokeWidth={1.75} aria-hidden /> {label(source)}
    </GTag>
  );
}

export function InboxG({
  threads,
  bodies,
  connected,
  nowISO,
  weekly,
  whatsappSendReady,
  extras,
}: {
  threads: InboxThread[];
  bodies: Record<string, ThreadMessage[]>;
  connected: Record<InboxSource, boolean>;
  nowISO: string;
  weekly: WeeklyInput | null;
  whatsappSendReady: boolean;
  /** F3 to F5 (lib/comms-extras.ts); absent in callers that predate them. */
  extras?: CommsExtras;
}) {
  const ws = useInboxWorkspace({ threads, connected, nowISO, weekly });
  const [tab, setTab] = useState<CommsTab>('threads');
  useEffect(() => setTab(readTab()), []);
  const narrow = useNarrow();
  const [filters, setFilters] = useState(false);
  const allDown = SOURCES.every((s) => !connected[s.id]);
  const unread = ws.cards.find((c) => c.id === 'unread');
  const week = ws.cards.find((c) => c.id === 'messages');
  const byChannel = replyByChannel(ws.effective);

  const counts = (id: InboxSource) => ws.effective.filter((t) => t.source === id).length;
  const sourceOptions = [
    { value: 'all' as const, label: `All ${ws.effective.length}` },
    ...SOURCES.map((s) => ({ value: s.id, label: `${s.label} ${counts(s.id)}` })),
  ];

  const side = (
    <>
      <GCard className="wg-ib-side">
        <GSectionHeader size={22} title="Channels" caption="Connection and thread count" />
        <ul className="wg-ib-chans">
          {SOURCES.map((s) => {
            const Icon = ICON[s.id];
            return (
              <li key={s.id}>
                <Icon size={15} strokeWidth={1.6} aria-hidden />
                <span className="wg-ib-chan-name">{s.label}</span>
                <span className="wg-ib-chan-n">{counts(s.id)}</span>
                {connected[s.id] ? (
                  <GTag tone="ok" dot size="xs">
                    Connected
                  </GTag>
                ) : (
                  <GButton variant="sm" href={setupHrefFor(s.id)} title={`${s.label} is not connected`}>
                    Set up
                  </GButton>
                )}
              </li>
            );
          })}
        </ul>
      </GCard>
      <GCard className="wg-ib-side">
        <GSectionHeader size={22} title="Range" />
        <GSegmented<Range> label="Range" size="compact" value={ws.range} onChange={ws.setRange} options={RANGES.map((r) => ({ value: r.id, label: r.id === 'week' ? '7 d' : r.label }))} />
      </GCard>
    </>
  );

  const reader = (
    <ReaderG
      ref={ws.readerRef}
      thread={ws.current}
      bodies={bodies}
      nowISO={nowISO}
      whatsappSendReady={whatsappSendReady}
      done={!!ws.current && ws.done.has(ws.current.key)}
      onDone={ws.toggleDone}
      onSnooze={ws.snooze}
      bare={narrow}
    />
  );

  return (
    <GPage className="wg-page">
      <GSectionHeader
        size="page"
        title="Inbox"
        caption="Every channel in one list"
        action={
          <div className="wg-head-actions">
            <GSearch ref={ws.searchRef} size="md" value={ws.query} onValueChange={ws.setQuery} placeholder="Search people, subjects, channels" aria-label="Search the inbox (/)" />
            <GPopover
              open={filters}
              onOpenChange={setFilters}
              label="Channels and range"
              align="end"
              className="wg-ib-filters-btn"
              trigger={(p) => (
                <GButton {...p}>
                  <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden /> Filters
                </GButton>
              )}
            >
              <div className="wg-ib-filters">{side}</div>
            </GPopover>
          </div>
        }
      />
      {extras && (
        <GTabs className="wg-cf-tabs" label="Comms view" param="tab" value={tab} onChange={(v) => setTab(v as CommsTab)} tabs={COMMS_TABS.map((t) => ({ ...t, controls: 'wg-cf-panel' }))} />
      )}
      {extras && tab !== 'threads' ? (
        <div id="wg-cf-panel" role="tabpanel" className="wg-cf-panel">
          {tab === 'recordings' && <RecordingsG initial={extras.recordings} active />}
          {tab === 'clients' && <ClientsBoardG data={extras.clients} nowISO={nowISO} />}
          {tab === 'week' && <WeekG data={extras.week} />}
        </div>
      ) : (
      <>
      <GSegmented<InboxSource | 'all'> className="wg-fit" label="Source" value={ws.source} onChange={ws.setSource} options={sourceOptions} />

      <div className="wg-ib-report">
        {allDown ? (
          <GHeroCard variant="a" size="sm" caption="Connect a channel" setupHref="/integrations" setupHint="No inbox channel is connected yet" />
        ) : (
          <GHeroCard
            variant="a"
            size="sm"
            caption="Waiting on you"
            value={ws.replyCount}
            status={ws.replyCount === 0 ? 'you are caught up' : byChannel.filter((b) => b.value > 0).map((b) => `${b.label.split(':')[0]} ${b.value}`).join(' · ')}
            title="Threads that need a reply: questions asked of you and unread conversations. Opens them, most urgent first."
            onClick={() => {
              ws.setTriage('reply');
              ws.setSort('urgency');
            }}
          />
        )}
        {unread && <ReportCard card={unread} source="Unread messages across every thread on this page" />}
        {week && <ReportCard card={week} source="Messages this week" />}
      </div>

      <div className="wg-ib-cols">
        <div className="wg-ib-left">{side}</div>
        <div className="wg-cf-listcol">
        {extras && <DigestBannerG data={extras.digest} />}
        <ListG
          threads={ws.visible}
          selected={ws.selected}
          nowISO={nowISO}
          sort={ws.sort}
          triage={ws.triage}
          onSelect={ws.setSelected}
          onSort={ws.setSort}
          onTriage={ws.setTriage}
          empty={allDown ? <GEmpty kind="unconfigured" title="No channel is connected" body="Connect email, Slack, WhatsApp or a calendar to fill the inbox." setupHref="/integrations" /> : undefined}
        />
        </div>
        {!narrow && reader}
      </div>
      </>
      )}
      {narrow && (
        <GDrawer open={!!ws.current} onClose={() => ws.setSelected(null)} title={ws.current?.sender ?? 'Thread'} width={4000} className="wg-ib-sheet">
          {reader}
        </GDrawer>
      )}
    </GPage>
  );
}

function ReportCard({ card, source }: { card: StatCard; source: string }) {
  const bars = card.chart.kind === 'bars' ? card.chart.bars : [];
  return (
    <GCard className="wg-ib-rcard">
      <GStat
        value={card.value}
        label={card.label}
        source={`${source}${card.sub ? ` · ${card.sub}` : ''}`}
        extra={card.delta ? <span className="wg-cap" data-dir={card.delta.dir}>{card.delta.text} {card.delta.note}</span> : card.sub ? <span className="wg-cap">{card.sub}</span> : undefined}
      />
      <GBarChart
        variant="series"
        height={64}
        label={`${card.label}: ${card.chart.caption}`}
        bars={bars.map((b, i) => {
          const head = b.label.split(':')[0];
          return { id: String(i), label: card.id === 'unread' ? initials(head) : head, value: b.value, tip: { title: b.label } };
        })}
        state={bars.length === 0 ? 'empty' : 'ready'}
        emptyText={card.chart.caption}
        highlight={null}
      />
    </GCard>
  );
}

function ListG({
  threads,
  selected,
  nowISO,
  sort,
  triage,
  onSelect,
  onSort,
  onTriage,
  empty,
}: {
  threads: InboxThread[];
  selected: string | null;
  nowISO: string;
  sort: (typeof SORTS)[number]['id'];
  triage: Triage | 'all';
  onSelect: (key: string) => void;
  onSort: (s: (typeof SORTS)[number]['id']) => void;
  onTriage: (t: Triage | 'all') => void;
  empty?: ReactNode;
}) {
  const now = new Date(nowISO);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected) return;
    list.current?.querySelector<HTMLElement>('[data-g="GRow"][data-selected]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);
  const grouped = sort !== 'urgency';
  let last: string | null = null;
  const rows: ReactNode[] = [];
  for (const t of threads) {
    const bucket = dateBucket(t.ts, now);
    if (grouped && bucket !== last) rows.push(<li key={`b-${bucket}`} className="wg-ib-bucket">{BUCKET_LABEL[bucket]}</li>);
    last = bucket;
    rows.push(
        <GRow
          key={t.key}
          selected={t.key === selected}
          onClick={() => onSelect(t.key)}
          leading={<Face name={t.sender} source={t.source} src={t.avatarUrl} />}
          title={
            <span className="wg-ib-rowtop">
              <span className="wg-ib-who">{t.sender}</span>
              <span className="wg-ib-ctx">{t.context}</span>
            </span>
          }
          meta={
            <span className="wg-ib-rowmeta">
              <span className="wg-ib-prev">{t.preview}</span>
              {t.unread > 0 && <GTag size="xs" tone="accent">{t.unread} unread</GTag>}
              {t.priority && <GTag size="xs" tone="warn">P{t.priority}</GTag>}
              {t.event?.joinUrl && <Video size={12} strokeWidth={1.6} aria-label="Has a video link" />}
            </span>
          }
          trailing={<span className="wg-ib-time">{t.source === 'calendar' ? new Date(t.ts).toLocaleDateString('en-US', { weekday: 'short' }) : relativeTime(t.ts, now)}</span>}
        />,
    );
  }
  const active = SORTS.find((s) => s.id === sort) ?? SORTS[0];
  return (
    <GCard className="wg-ib-list">
      <GSectionHeader
        size={22}
        title={`Inbox · ${threads.length}`}
        action={
          <div className="wg-head-actions">
            {triage !== 'all' && (
              <GChip pressed onPressedChange={() => onTriage('all')} title="Clear this filter">
                {triageLabel(triage)}
              </GChip>
            )}
            <GMenu
              label="Sort"
              items={SORTS.map((s) => ({ id: s.id, label: s.id === sort ? `${s.label} (current)` : s.label, onSelect: () => onSort(s.id) }))}
              trigger={(p) => (
                <GButton {...p} size="sm">
                  <ArrowDownWideNarrow size={13} strokeWidth={1.75} aria-hidden /> {active.label}
                </GButton>
              )}
            />
          </div>
        }
      />
      <div ref={list} className="wg-ib-rows">
        {threads.length === 0 ? empty ?? <GEmpty inline title="Nothing matches these filters" /> : <GList label="Threads">{rows}</GList>}
      </div>
    </GCard>
  );
}

const QUICK: { label: string; text: string }[] = [
  { label: 'Draft reply', text: 'Thanks for this. ' },
  { label: 'Confirm time', text: 'Confirmed on my end. ' },
  { label: 'Ask for details', text: 'Can you send over the details so I can review? ' },
  { label: 'Next steps', text: 'Next step on our side: ' },
];

const ReaderG = forwardRef<
  ReaderHandle,
  {
    thread: InboxThread | null;
    whatsappSendReady: boolean;
    bodies: Record<string, ThreadMessage[]>;
    nowISO: string;
    done: boolean;
    onDone: () => void;
    onSnooze: () => void;
    /** inside the narrow-screen sheet: no card, no repeated name */
    bare?: boolean;
  }
>(function ReaderG({ thread, bodies, nowISO, whatsappSendReady, done, onDone, onSnooze, bare = false }, ref) {
  const now = new Date(nowISO);
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useImperativeHandle(ref, () => ({ focusReply: () => box.current?.querySelector<HTMLInputElement>('.wg-ib-reply input')?.focus() }), []);
  const key = thread?.key ?? null;
  useEffect(() => {
    setDraft('');
    setStatus(null);
  }, [key]);
  const { messages: history, loading } = useHistory(thread?.jid);

  if (!thread) {
    return (
      <GCard className="wg-ib-reader">
        <GEmpty title="Pick a thread" body="j and k move, r replies, e marks done, / searches." />
      </GCard>
    );
  }
  const t = thread;
  const shown = history && history.length ? history : messagesFor(t, bodies);

  async function send(text: string) {
    setStatus(null);
    setSending(true);
    try {
      if (t.source === 'slack' && t.context) {
        const res = await fetch('/api/comms/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'slack', channel: t.context.replace(/^#/, ''), text }) }).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : {};
        setStatus(body.detail ?? (res?.ok ? 'Sent' : 'Failed'));
        if (res?.ok) setDraft('');
        return;
      }
      if (t.source === 'email') {
        if (!t.replyTo) return setStatus('No reply address on this message');
        const res = await fetch('/api/comms/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'email', account: t.account, to: t.replyTo, subject: `Re: ${t.preview}`, text }),
        }).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : {};
        if (res?.ok && body.ok) {
          setStatus('Sent');
          setDraft('');
          return;
        }
        window.location.href = `mailto:${t.replyTo}?subject=${encodeURIComponent(`Re: ${t.preview}`)}&body=${encodeURIComponent(text)}`;
        setStatus(body.error ? 'SMTP unavailable, opened a draft in Mail' : 'Opened a draft in Mail');
        return;
      }
      if (t.source === 'whatsapp') {
        const res = await fetch('/api/comms/reply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'whatsapp', jid: t.jid, text }) }).catch(() => null);
        const body = res ? await res.json().catch(() => ({})) : {};
        if (res?.ok && body.ok) {
          setStatus('Sent');
          setDraft('');
          return;
        }
        setStatus(body.error ? String(body.error) : 'Could not send');
      }
    } finally {
      setSending(false);
    }
  }

  const waBlock =
    t.source !== 'whatsapp'
      ? null
      : !whatsappSendReady
        ? { title: 'Sending is not set up yet', body: 'This console reads WhatsApp from the desktop app on this Mac, which cannot send. Connect a WhatsApp Business number to reply from here.' }
        : !whatsappNumber(t.jid)
          ? { title: 'This chat cannot be replied to from here', body: 'The Business API can only message a phone number. This is a group or a linked id, so it has none.' }
          : null;
  const canReply = t.source !== 'calendar' && !waBlock;

  const inner = (
    <div ref={box} className="wg-ib-reader-in">
      <div className="wg-ib-rhead">
        <Face name={t.sender} source={t.source} src={t.avatarUrl} size={40} />
        <div className="wg-ib-rwho">
          {!bare && <h2 className="wg-ib-rname">{t.sender}</h2>}
          <span className="wg-tags">
            <SourceTag source={t.source} />
            <GTag tone={TRIAGE_TONE[done ? 'done' : t.triage]}>{triageLabel(done ? 'done' : t.triage)}</GTag>
          </span>
          <span className="wg-cap">
            {t.context}
            {t.replyTo ? ` · ${t.replyTo}` : ''}
            {t.account ? ` · via ${t.account}` : ''}
          </span>
        </div>
        <div className="wg-ib-ractions">
          {canReply && (
            <GButton size="sm" onClick={onSnooze} title="Hide for 24 hours (saved on this browser)">
              Snooze
            </GButton>
          )}
          <GButton size="sm" variant={done ? 'ink' : 'default'} onClick={onDone} title="Mark done (e). Saved on this browser.">
            {done ? 'Done' : 'Mark done'}
          </GButton>
          {t.event?.joinUrl && (
            <GButton size="sm" variant="ink" href={t.event.joinUrl} external>
              <Video size={13} strokeWidth={1.75} aria-hidden /> Join
            </GButton>
          )}
        </div>
      </div>

      <div className="wg-ib-rbody">
        {t.source === 'calendar' && t.event ? (
          <GKeyValue
            items={[
              { label: 'When', value: `${new Date(t.ts).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })} · ${t.event.allDay ? 'All day' : `${clock(t.ts)}${t.event.end ? ` to ${clock(t.event.end)}` : ''}`}` },
              { label: 'Calendar', value: t.context },
              ...(t.event.location ? [{ label: 'Where', value: t.event.location }] : []),
            ]}
          />
        ) : (
          <div className="wg-ib-thread">
            {loading && <p className="wg-cap">Loading this conversation</p>}
            {shown.map((m, i) => (
              <div key={i} className="wg-ib-msg" data-me={m.from === 'me' || undefined}>
                <span className="wg-ib-msgmeta">
                  {m.from === 'me' ? 'You' : m.author || t.sender} · {clock(m.ts)} · {relativeTime(m.ts, now)}
                </span>
                {m.media && <MediaG media={m.media} />}
                {m.text && <p className="wg-ib-bubble">{m.text}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {waBlock && <GEmpty inline kind="unconfigured" title={waBlock.title} body={waBlock.body} setupHref={setupHrefFor('whatsapp')} />}

      {canReply && (
        <div className="wg-ib-reply">
          <div className="wg-tags">
            {QUICK.map((q) => (
              <GButton
                key={q.label}
                size="compact"
                onClick={() => {
                  setDraft((d) => d || q.text);
                  box.current?.querySelector<HTMLInputElement>('.wg-ib-reply input')?.focus();
                }}
              >
                {q.label}
              </GButton>
            ))}
          </div>
          <GAsk value={draft} onValueChange={setDraft} minChars={1} busy={sending} label={`Reply to ${t.sender} on ${label(t.source)}`} placeholder={`Reply to ${t.sender} on ${label(t.source)}`} onSubmit={(text) => void send(text)} />
          {status && <span className="wg-cap" role="status">{status}</span>}
        </div>
      )}
    </div>
  );
  return bare ? inner : <GCard className="wg-ib-reader">{inner}</GCard>;
});

function MediaG({ media }: { media: NonNullable<ThreadMessage['media']> }) {
  if (media.kind === 'image' || media.kind === 'gif') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="wg-ib-media" src={media.url} alt={media.name} loading="lazy" />;
  }
  if (media.kind === 'video') return <video className="wg-ib-media" src={media.url} controls preload="metadata" playsInline />;
  if (media.kind === 'voice') return <audio className="wg-ib-audio" src={media.url} controls preload="metadata" />;
  return (
    <GButton size="sm" href={media.url} download={media.name}>
      {media.name}
      {media.bytes ? ` · ${Math.round(media.bytes / 1024)} KB` : ''}
    </GButton>
  );
}
