'use client';
/**
 * Radar (`/lab/radar`), Classic tree (01 8). The launch timeline (one lane per 05 EventRow, pings by
 * source family, the coverage ribbon), Watching, the topic tide with rising topics, and the lead-time
 * ledger. Reads RadarPageView; 05's labels are rendered as given.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { WaveViz } from '@/components/lab/v2/shared';
import type { RadarPageView } from '@/lib/lab/view/radar';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { ClassicCapHost } from './dialogs';
import { Frame } from './Frame';
import { store } from './hooks';
import { FilterChip, PageBar, Panel, StateLine, Tag, shows } from './parts';
import { LaneTrack, Tide } from './viz';

function useHref() {
  const params = useSearchParams();
  return (set: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(set)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
}

function Lanes({ v }: { v: RadarPageView }) {
  const lanes = v.timeline.lanes;
  const [cur, setCur] = useState(0);
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(lanes.length - 1, i + d));
    setCur(j);
    refs.current[j]?.focus();
  };
  const from = v.radar?.timeline.from ?? '';
  const to = v.radar?.timeline.to ?? '';
  /** One creator axis for every lane, so lanes compare at a glance (small multiples). */
  const scale = Math.max(1, ...lanes.flatMap((l) => [...(l.lane?.ribbon ?? []).map((r) => r.creators), ...l.row.waveSeries.map((p) => p.creators)]));
  return (
    <div className="lab2c-lanes" role="list">
      <div className="lab2c-lanes-axis" aria-hidden="true">
        <span />
        <span className="lab2c-lanes-axis-track">
          <span data-lab-ink="">{C.radar.days}</span>
          <span data-lab-ink="">{C.radar.now}</span>
        </span>
        <span />
      </div>
      {lanes.map((l, i) => (
        <Link
          key={l.row.id}
          ref={(el) => { refs.current[i] = el; }}
          href={l.href}
          scroll={false}
          role="listitem"
          tabIndex={i === cur ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)}
          onFocus={() => setCur(i)}
          className="lab2c-lane"
          data-state={l.row.window?.state ?? 'none'}
          data-lab-shared={`lane-${l.row.id}`}
          aria-label={`${l.row.name}, ${l.stateLabel}, ${l.row.ageLabel}, ${l.row.coverage.label}`}
        >
          <span className="lab2c-lane-name">
            <span className="lab2c-lane-title" data-lab-ink="">{l.row.name}</span>
            <span className="lab2c-lane-meta">
              <Tag tone={l.row.window?.state === 'open' ? 'strong' : l.row.window?.state === 'closing' ? undefined : 'quiet'}>{l.stateLabel}</Tag>
              <span data-lab-ink="">{l.row.ageLabel}</span>
            </span>
          </span>
          <LaneTrack lane={l.lane} from={from} to={to} scaleMax={scale} />
          <span className="lab2c-lane-cov">
            <span className="lab2c-lane-covtext" data-lab-ink="">{l.row.coverage.label}</span>
            <span className="lab2c-lane-class" data-lab-ink="">{l.row.classLabel}</span>
          </span>
          <span className="lab2c-lane-mini" aria-hidden="true">
            {l.row.waveSeries.length >= 2 && <WaveViz buckets={l.row.waveSeries.map((p) => p.creators)} nowIndex={l.row.waveSeries.length - 1} window={l.row.window?.state ?? 'open'} max={scale} w={88} h={28} />}
          </span>
        </Link>
      ))}
    </div>
  );
}

function LeadTime({ v }: { v: RadarPageView }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(store.get('lab.radar.lead') === '1'), []);
  const lt = v.leadTime;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    store.set('lab.radar.lead', next ? '1' : null);
  };
  return (
    <Panel
      id="lead"
      title={C.radar.leadTime}
      desc={C.radar.leadDesc}
      tone={open ? 'strong' : 'solid'}
      tools={<button type="button" className="lab2c-btn" aria-expanded={open} aria-controls="lead-body" onClick={toggle}>{open ? C.schedule.hide : C.schedule.show}</button>}
    >
      {open && (
        <div id="lead-body" className="lab2c-lead">
          <StateLine state={lt.state} />
          {shows(lt.state) && (
            <>
              {lt.waveLiftText && <p className="lab2c-lead-lift" data-lab-ink="">{lt.waveLiftText}</p>}
              {lt.priorText && <p className="lab2c-muted" data-lab-ink="">{lt.priorText}</p>}
              <div className="lab2c-table-wrap">
                <table className="lab2c-table">
                  <thead>
                    <tr>
                      <th scope="col">{C.radar.leadCols.class}</th>
                      <th scope="col">{C.radar.leadCols.source}</th>
                      <th scope="col">{C.radar.leadCols.lead}</th>
                      <th scope="col" className="lab2c-num-col">{C.radar.leadCols.n}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lt.rows.map((r, i) => (
                      <tr key={i}>
                        <td data-lab-ink="">{C.radar.classes[r.class] ?? r.class}</td>
                        <td data-lab-ink="">{v.timeline.legend.find((g) => g.family === r.family)?.label ?? r.family}</td>
                        <td data-lab-ink="">{r.label}</td>
                        <td className="lab2c-num-col" data-lab-ink="">{r.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

export function RadarPage({ view }: { view: RadarPageView }) {
  return (
    <ClassicCapHost>
      <RadarPageBody view={view} />
    </ClassicCapHost>
  );
}

function RadarPageBody({ view }: { view: RadarPageView }) {
  const href = useHref();
  const f = view.filters;
  const radarLive = view.frame.layers.radar === 'live';
  const [watchOpen, setWatchOpen] = useState(false);
  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      {radarLive && (
        <PageBar label={C.aria.filters}>
          <span className="lab2c-bar-group" role="group" aria-label={C.radar.classLabel}>
            <FilterChip href={href({ class: null })} active={f.eventClass === null}>{C.radar.classAll}</FilterChip>
            {(['spike', 'adopted', 'unknown'] as const).map((c) => (
              <FilterChip key={c} href={href({ class: c })} active={f.eventClass === c}>{C.radar.classes[c]}</FilterChip>
            ))}
          </span>
          <span className="lab2c-bar-group" role="group" aria-label={C.radar.stateLabel}>
            <FilterChip href={href({ state: null })} active={f.windowState === null}>{C.radar.stateAll}</FilterChip>
            {(['open', 'closing', 'closed'] as const).map((s) => (
              <FilterChip key={s} href={href({ state: s })} active={f.windowState === s}>{C.radar.states[s]}</FilterChip>
            ))}
          </span>
          {f.clearHref && (
            <span className="lab2c-bar-end">
              <Link href={f.clearHref} replace scroll={false} className="lab2-textlink" data-lab-ink="">{C.clearFilters}</Link>
            </span>
          )}
        </PageBar>
      )}

      <Panel id="timeline" title={C.radar.timeline} desc={C.radar.timelineDesc} priority={2} className="lab2c-gap-top"
        tools={view.timeline.legend.length ? (
          <span className="lab2c-legend" aria-label={C.radar.sources}>
            {view.timeline.legend.map((g) => (
              <span key={g.family} className="lab2c-legend-item" data-lab-ink="">
                <span className="lab2c-ping lab2c-ping-static" data-family={g.family} data-lab-mark="" />
                {g.label}
              </span>
            ))}
          </span>
        ) : undefined}
      >
        <StateLine state={view.timeline.state} />
        {shows(view.timeline.state) && view.timeline.lanes.length > 0 && <Lanes v={view} />}
        {view.radar?.state === 'never_run' && (
          <span>
            <button type="button" className="lab2c-btn lab2c-btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('lab:run'))}>{C.runNow}</button>
          </span>
        )}
        {view.watching.text && view.watching.rows.length > 0 && (
          <div className="lab2c-watch">
            <button type="button" className="lab2c-disclose" aria-expanded={watchOpen} aria-controls="watching" onClick={() => setWatchOpen((o) => !o)} data-lab-ink="">
              <span className="lab2c-disclose-mark" aria-hidden="true" />
              {view.watching.text}
            </button>
            {watchOpen && (
              <ul id="watching" className="lab2c-watch-list">
                {view.watching.rows.map((r) => (
                  <li key={r.id}>
                    <Link href={`?event=${r.id}`} scroll={false} className="lab2c-watch-row" data-lab-shared={`watch-${r.id}`}>
                      <span data-lab-ink="">{r.name}</span>
                      <span className="lab2c-muted" data-lab-ink="">{r.sources.map((s) => v_label(view, s.family)).join(', ')}</span>
                      <span className="lab2c-muted" data-lab-ink="">{r.ageLabel}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>

      <div className="lab2c-split">
        <Panel id="tide" title={C.radar.tide} desc={C.radar.tideDesc}>
          <StateLine state={view.tide.state} />
          {shows(view.tide.state) && <Tide trends={{ weeks: view.tide.weeks, series: view.tide.series }} label={C.radar.tide} height={240} />}
          {shows(view.tide.state) && (
            <ul className="lab2c-tide-key">
              {view.tide.series.slice(0, 8).map((s) => (
                <li key={s.clusterId} data-lab-ink="">
                  <span className="lab2c-swatch" data-cat={((s.cat - 1) % 11) + 1} data-lab-mark="" />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="topics" title={C.radar.topics} desc={C.radar.topicsDesc}>
          <StateLine state={view.tide.state} compact />
          {shows(view.tide.state) && (
            <ul className="lab2c-topics">
              {view.tide.rows.slice(0, 7).map((r) => {
                const inner = (
                  <>
                    <span className="lab2c-swatch" data-cat={((r.cat - 1) % 11) + 1} data-lab-mark="" />
                    <span className="lab2c-topic-name" data-lab-ink="">{r.label}</span>
                    <span className="lab2c-topic-meta">
                      {r.timing && <Tag tone={r.timing === 'open' ? 'strong' : 'quiet'}>{C.radar.timing[r.timing]}</Tag>}
                      {r.momentumText && <span data-lab-ink="">{r.momentumText}</span>}
                      <span data-lab-ink="">{`${r.posts} ${C.radar.posts}`}</span>
                      {r.coverage.covered && <span data-lab-ink="">{C.radar.covered}</span>}
                    </span>
                  </>
                );
                return (
                  <li key={r.clusterId}>
                    {view.frame.layers.ask === 'live' ? (
                      <Link href={`?ask=${encodeURIComponent(r.label)}`} scroll={false} className="lab2c-topic" data-lab-shared={`topic-${r.clusterId}`}>{inner}</Link>
                    ) : (
                      <span className="lab2c-topic">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="lab2c-gap-top">
        <LeadTime v={view} />
      </div>
    </Frame>
  );
}

function v_label(v: RadarPageView, family: string): string {
  return v.timeline.legend.find((g) => g.family === family)?.label ?? family;
}
