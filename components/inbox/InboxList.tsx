'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, Video, X } from 'lucide-react';
import { BUCKET_LABEL, SORTS, TRIAGE, clock, dateBucket, relativeTime, type InboxThread, type Sort, type Triage } from '@/lib/inbox';
import { Avatar, Mono, SourceBadge } from './bits';

/**
 * Middle column: the list. Each row leads with who, and the channel is its own
 * app mark rather than a word — resting, ringed when unread, lit when open.
 * The sort control is real: newest, oldest, or most urgent.
 */
export function InboxList({
  threads,
  selected,
  nowISO,
  sort,
  triage,
  onSelect,
  onSort,
  onTriage,
}: {
  threads: InboxThread[];
  selected: string | null;
  nowISO: string;
  sort: Sort;
  triage: Triage | 'all';
  onSelect: (key: string) => void;
  onSort: (s: Sort) => void;
  onTriage: (t: Triage | 'all') => void;
}) {
  const now = new Date(nowISO);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!sortRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const active = SORTS.find((s) => s.id === sort) ?? SORTS[0];
  // Day headings only make sense while the list is in time order.
  const grouped = sort !== 'urgency';
  let lastBucket: string | null = null;

  return (
    <section className="ib-col ib-list">
      <header className="ib-list-h">
        <span className="ib-list-title">
          Inbox <Mono className="ib-list-n">{threads.length}</Mono>
        </span>
        {triage !== 'all' && (
          <button className="ib-filter-chip" onClick={() => onTriage('all')} title="Clear this filter">
            {TRIAGE.find((x) => x.id === triage)?.label ?? triage}
            <X strokeWidth={2.4} />
          </button>
        )}
        <div className="ib-sort" ref={sortRef}>
          <button className={`ib-sort-btn ${menu ? 'is-on' : ''}`} onClick={() => setMenu((v) => !v)} aria-haspopup="listbox" aria-expanded={menu}>
            <ArrowDownWideNarrow strokeWidth={1.8} />
            Sort by: <b>{active.label}</b>
          </button>
          {menu && (
            <ul className="ib-sort-menu" role="listbox">
              {SORTS.map((s) => (
                <li key={s.id}>
                  <button
                    role="option"
                    aria-selected={s.id === sort}
                    className={`ib-sort-opt ${s.id === sort ? 'is-on' : ''}`}
                    onClick={() => {
                      onSort(s.id);
                      setMenu(false);
                    }}
                  >
                    <span className="ib-sort-tick">{s.id === sort && <Check strokeWidth={3} />}</span>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>
      <div className="ib-rows" ref={listRef}>
        {threads.length === 0 && <p className="ib-empty">Nothing matches these filters.</p>}
        {threads.map((t) => {
          const bucket = dateBucket(t.ts, now);
          const showBucket = grouped && bucket !== lastBucket;
          lastBucket = bucket;
          const isSel = t.key === selected;
          return (
            <Fragment key={t.key}>
              {showBucket && <Mono className="ib-bucket">{BUCKET_LABEL[bucket]}</Mono>}
              <button className={`ib-row ${isSel ? 'is-sel' : ''} ${t.unread ? 'is-unread' : ''}`} data-key={t.key} onClick={() => onSelect(t.key)}>
                <Avatar name={t.sender} source={t.source} src={t.avatarUrl} />
                <span className="ib-row-main">
                  <span className="ib-row-top">
                    <span className="ib-row-who">{t.sender}</span>
                    <span className="ib-row-ctx">{t.context}</span>
                    <Mono className="ib-row-time">{t.source === 'calendar' ? new Date(t.ts).toLocaleDateString('en-US', { weekday: 'short' }) : relativeTime(t.ts, now)}</Mono>
                  </span>
                  <span className="ib-row-mid">
                    <SourceBadge source={t.source} unread={t.unread > 0} selected={isSel} />
                    <span className="ib-row-prev">{t.preview}</span>
                  </span>
                  <span className="ib-row-bot">
                    {t.source === 'calendar' && t.event ? (
                      <Mono className="ib-row-when">
                        {t.event.allDay ? 'All day' : `${clock(t.ts)}${t.event.end ? ` – ${clock(t.event.end)}` : ''}`}
                      </Mono>
                    ) : null}
                    {t.unread > 0 && <Mono className="ib-row-unread">{t.unread} unread</Mono>}
                    {t.event?.joinUrl && (
                      <span className="ib-row-join">
                        <Video strokeWidth={1.8} /> video
                      </span>
                    )}
                    {t.priority && <Mono className="ib-row-pri">P{t.priority}</Mono>}
                  </span>
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
