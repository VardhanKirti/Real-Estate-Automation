'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { SOURCES, type InboxSource, type InboxThread, type ThreadMessage } from '@/lib/inbox';
import type { WeeklyInput } from '@/lib/inbox-stats';
import { InboxTriage } from './InboxTriage';
import { InboxList } from './InboxList';
import { InboxReader } from './InboxReader';
import { useInboxWorkspace } from './useInboxWorkspace';
import { InboxWidgets } from './InboxWidgets';
import { Mono, SOURCE_ICON } from './bits';
import { BRAND } from '@/lib/brand';
import type { CommsExtras } from '@/lib/comms-extras';
import { ClientLanesClassic, DigestPanelClassic, RecordingsClassic, WeekClassic } from '@/components/comms-fo/CommsFoClassic';
import { DIGEST_READ_EVENT } from '@/components/comms-fo/hooks';

/** The view strip (F3 to F5): the thread columns, then the FounderOS lanes. */
const VIEWS = [
  { id: 'threads', label: 'Threads' },
  { id: 'digest', label: 'Digest' },
  { id: 'recordings', label: 'Recordings' },
  { id: 'clients', label: 'Clients' },
  { id: 'week', label: 'Week' },
] as const;
type View = (typeof VIEWS)[number]['id'];

/**
 * The /inbox surface: a fixed three-column app (triage · list · reader) under
 * the icon rail. All filtering is local. Done and Snooze persist on this
 * browser (localStorage `inbox-triage:v1`, lib/inbox-triage.ts) until a
 * triage engine stores them server side, and the toast says so (H32). Where
 * storage is blocked they last for the session and the toast says that.
 */
export function InboxWorkspace({
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
  /** Real week-over-week message volume, or null when it cannot be read. */
  weekly: WeeklyInput | null;
  /** Whether a WhatsApp Business number is connected for sending. */
  whatsappSendReady: boolean;
  /** F3 to F5 (lib/comms-extras.ts); absent in callers that predate them. */
  extras?: CommsExtras;
}) {
  const [view, setViewState] = useState<View>('threads');
  // `?tab=` mirrors the view (the GladOS tabs use the same param), so a link opens it.
  useEffect(() => {
    const t = new URL(window.location.href).searchParams.get('tab');
    if (VIEWS.some((v) => v.id === t)) setViewState(t as View);
  }, []);
  const setView = (v: View) => {
    setViewState(v);
    const url = new URL(window.location.href);
    if (v === 'threads') url.searchParams.delete('tab');
    else url.searchParams.set('tab', v);
    window.history.replaceState(window.history.state, '', url);
  };
  const [digestUnread, setDigestUnread] = useState(Boolean(extras?.digest.digest) && !extras?.digest.read);
  useEffect(() => {
    const off = () => setDigestUnread(false);
    window.addEventListener(DIGEST_READ_EVENT, off);
    return () => window.removeEventListener(DIGEST_READ_EVENT, off);
  }, []);
  const {
    source, setSource, triage, setTriage, range, setRange, sort, setSort, query, setQuery, selected, setSelected,
    done, effective, visible, current, connectedCount, cards, replyCount, toggleDone, snooze, readerRef, searchRef,
  } = useInboxWorkspace({ threads, connected, nowISO, weekly });

  return (
    <div className="ib-page">
      <header className="ib-top">
        <nav className="ib-crumb">
          <Mono>{BRAND.name.toLowerCase()}</Mono>
          <span className="ib-crumb-sep">/</span>
          <span className="ib-crumb-here">inbox</span>
          {current && (
            <>
              <span className="ib-crumb-sep">/</span>
              <span className="ib-crumb-here">{current.sender}</span>
            </>
          )}
        </nav>
        <div className="ib-seg" role="tablist" aria-label="Source">
          <button role="tab" aria-selected={source === 'all'} className={`ib-seg-btn ${source === 'all' ? 'is-on' : ''}`} onClick={() => setSource('all')}>
            All <Mono className="ib-seg-n">{effective.length}</Mono>
          </button>
          {SOURCES.map((s) => {
            const Icon = SOURCE_ICON[s.id];
            const on = source === s.id;
            return (
              <button key={s.id} role="tab" aria-selected={on} className={`ib-seg-btn ${on ? 'is-on' : ''}`} onClick={() => setSource(on ? 'all' : s.id)}>
                <span className="ib-src-ic" data-source={s.id}>
                  <Icon strokeWidth={1.8} />
                </span>
                {s.label}
              </button>
            );
          })}
        </div>
        <label className="ib-search">
          <Search strokeWidth={1.8} />
          <input ref={searchRef} value={query} placeholder="Search people, subjects, channels" onChange={(e) => setQuery(e.target.value)} />
          <kbd>/</kbd>
        </label>
        <span className="ib-conn">
          <span className={`ib-dot ${connectedCount === SOURCES.length ? 'is-on' : ''}`} />
          <Mono>
            {connectedCount}/{SOURCES.length}
          </Mono>{' '}
          connected
        </span>
      </header>

      <InboxWidgets
        cards={cards}
        replyCount={replyCount}
        onOpenTriage={() => {
          setTriage('reply');
          setSort('urgency');
        }}
      />

      {extras && (
        <nav className="ib-views" role="tablist" aria-label="Comms view">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={`ib-seg-btn ${view === v.id ? 'is-on' : ''}`} onClick={() => setView(v.id)}>
              {v.label}
              {v.id === 'digest' && digestUnread && <span className="ib-views-dot" aria-label="Unread" />}
            </button>
          ))}
        </nav>
      )}

      {extras && view !== 'threads' ? (
        <div className="cf-view" role="tabpanel" aria-label={VIEWS.find((v) => v.id === view)?.label}>
          {view === 'digest' && <DigestPanelClassic data={extras.digest} />}
          {view === 'recordings' && <RecordingsClassic initial={extras.recordings} active />}
          {view === 'clients' && <ClientLanesClassic data={extras.clients} nowISO={nowISO} />}
          {view === 'week' && <WeekClassic data={extras.week} />}
        </div>
      ) : (
      <div className="ib-cols">
        <InboxTriage
          threads={effective}
          source={source}
          range={range}
          connected={connected}
          onSource={setSource}
          onRange={setRange}
        />
        <InboxList threads={visible} selected={selected} nowISO={nowISO} sort={sort} triage={triage} onSelect={setSelected} onSort={setSort} onTriage={setTriage} />
        <InboxReader
          ref={readerRef}
          thread={current}
          bodies={bodies}
          nowISO={nowISO}
          whatsappSendReady={whatsappSendReady}
          done={!!current && done.has(current.key)}
          onDone={toggleDone}
          onSnooze={snooze}
        />
      </div>
      )}
    </div>
  );
}
