'use client';

import { RANGES, SOURCES, type InboxSource, type Range } from '@/lib/inbox';
import { SetupLink } from '@/components/SetupLink';
import { setupHrefFor } from '@/lib/integrations-catalog';
import { Mono } from './bits';
import { SourceBadge } from './bits';

/**
 * Left column: only the filters the report row above does not already answer.
 * The queue counts and the needs-reply / meetings figures used to live here
 * too and were removed — they are the widgets at the top of the page now, and
 * saying the same number twice on one screen is just noise.
 */
export function InboxTriage({
  threads,
  source,
  range,
  connected,
  onSource,
  onRange,
}: {
  threads: { source: InboxSource }[];
  source: InboxSource | 'all';
  range: Range;
  connected: Record<InboxSource, boolean>;
  onSource: (s: InboxSource | 'all') => void;
  onRange: (r: Range) => void;
}) {
  const bySource = (id: InboxSource) => threads.filter((t) => t.source === id).length;

  return (
    <aside className="ib-col ib-triage">
      <section className="ib-card">
        <header className="ib-card-h">
          <Mono className="ib-label">Channels</Mono>
          {source !== 'all' && (
            <button className="ib-reset" onClick={() => onSource('all')}>
              Reset
            </button>
          )}
        </header>
        <ul className="ib-check">
          {SOURCES.map((s) => {
            const on = source === s.id;
            return (
              <li key={s.id}>
                <button className={`ib-check-row ${on ? 'is-on' : ''}`} onClick={() => onSource(on ? 'all' : s.id)}>
                  <SourceBadge source={s.id} selected={on} />
                  <span className="ib-check-label">{s.label}</span>
                  <span className={`ib-dot ${connected[s.id] ? 'is-on' : ''}`} title={connected[s.id] ? 'Connected' : 'Not connected'} />
                  <Mono className="ib-check-n">{bySource(s.id)}</Mono>
                </button>
                {!connected[s.id] && (
                  <div className="ib-check-setup">
                    <SetupLink href={setupHrefFor(s.id)} label="Set up" />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ib-card">
        <header className="ib-card-h">
          <Mono className="ib-label">Range</Mono>
          {range !== 'all' && (
            <button className="ib-reset" onClick={() => onRange('all')}>
              Reset
            </button>
          )}
        </header>
        <div className="ib-chips">
          {RANGES.map((r) => (
            <button key={r.id} className={`ib-chip ${range === r.id ? 'is-on' : ''}`} onClick={() => onRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
