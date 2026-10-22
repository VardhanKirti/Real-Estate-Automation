'use client';
/**
 * Radar (`/lab/radar`), GladOS tree (01 8): filters, the launch timeline (one lane per event: pings by
 * source family, the window ribbon), Watching, the topic tide and rising topics, and the lead-time
 * ledger. Every label is section 05's. Lanes are one tab stop; Up and Down move between them.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { LAB_COPY } from '@/lib/lab/view/copy';
import { fmtClock } from '@/lib/lab/view/format';
import type { RadarPageView, RadarLaneModel } from '@/lib/lab/view/radar';
import { FilterChip, PageBar, Panel, SectionNote } from './bits';
import { GPageShell } from './PageShell';
import { LAB_UI, fill, fmtLabDay } from '@/lib/lab/view/ui-copy';

const DAY = 86_400_000;

function href(base: Record<string, string | null>, set: Record<string, string | null>, sample: boolean) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...set })) if (v) q.set(k, v);
  if (sample) q.set('sample', '1');
  const s = q.toString();
  return `/lab/radar${s ? `?${s}` : ''}`;
}

function Lane({ m, from, to, tabIndex, onKey }: { m: RadarLaneModel; from: number; to: number; tabIndex: number; onKey: (e: KeyboardEvent<HTMLAnchorElement>) => void }) {
  const span = Math.max(1, to - from);
  const x = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - from) / span) * 100));
  const ribbon = m.lane?.ribbon ?? [];
  const max = Math.max(1, ...ribbon.map((r) => r.creators));
  return (
    <li className="lab2g-lane" data-state={m.row.window?.state ?? 'none'}>
      <a data-g="LabLink" href={m.href} className="lab2g-lane-link" tabIndex={tabIndex} onKeyDown={onKey} data-lab-shared={`lane-${m.row.id}`} data-sheet-title={m.row.name} aria-label={`${m.row.name}, ${m.stateLabel}, ${m.row.ageLabel}, ${m.row.coverage.label}`}>
        <span className="lab2g-lane-name">
          <span className="lab2g-lane-title" data-lab-ink="">{m.row.name}</span>
          <span className="lab2g-lane-sub" data-lab-ink="">{[m.stateLabel, m.row.ageLabel, m.row.coverage.label].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="lab2g-lane-track" aria-hidden="true">
          <svg className="lab2g-lane-svg" viewBox="0 0 100 24" preserveAspectRatio="none" data-lab-mark="">
            {ribbon.map((r, i) => {
              const nx = i + 1 < ribbon.length ? x(ribbon[i + 1].at) : x(r.at) + 1.5;
              const h = 4 + (r.creators / max) * 10;
              return <rect key={i} x={x(r.at)} y={20 - h} width={Math.max(0.4, nx - x(r.at))} height={h} className="lab2g-ribbon" data-state={r.state} />;
            })}
          </svg>
          {(m.lane?.pings ?? []).map((p, i) => (
            <span key={i} className="lab2g-ping" data-lab-overlay="" data-family={p.family} style={{ left: `${x(p.at)}%` }} title={fill(LAB_UI.pingAt, { family: p.family, time: `${fmtLabDay(p.at)} ${fmtClock(p.at)}` })} />
          ))}
        </span>
      </a>
    </li>
  );
}

function Timeline({ view }: { view: RadarPageView }) {
  const lanes = view.timeline.lanes;
  const r = view.radar;
  const to = r ? Date.parse(r.timeline.to) : Date.now();
  const from = r ? Date.parse(r.timeline.from) : to - 14 * DAY;
  const [active, setActive] = useState(0);
  const refs = useRef<HTMLUListElement>(null);
  const onKey = (i: number) => (e: KeyboardEvent<HTMLAnchorElement>) => {
    const j = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? lanes.length - 1 : -1;
    if (j < 0 || j >= lanes.length) return;
    e.preventDefault();
    setActive(j);
    refs.current?.querySelectorAll<HTMLAnchorElement>('.lab2g-lane-link')[j]?.focus();
  };
  const days = Math.round((to - from) / DAY);
  return (
    <Panel id="lab2g-timeline" title={LAB_UI.launchTimeline} priority={2} className="lab2g-timeline">
      {lanes.length === 0 ? (
        <SectionNote state={view.timeline.state} />
      ) : (
        <>
          <div className="lab2g-axis" aria-hidden="true">
            <span className="lab2g-axis-pad" />
            <span className="lab2g-axis-scale">
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                <span key={f} className="lab2g-axis-tick" style={{ left: `${f * 100}%` }} data-lab-ink="">
                  {f === 1 ? LAB_UI.now : fill(LAB_UI.daysAgo, { d: String(Math.round(days * (1 - f))) }).replace(/^/, '−')}
                </span>
              ))}
            </span>
          </div>
          <ul ref={refs} className="lab2g-lanes" aria-label={LAB_UI.launchTimeline}>
            {lanes.map((m, i) => <Lane key={m.row.id} m={m} from={from} to={to} tabIndex={i === active ? 0 : -1} onKey={onKey(i)} />)}
          </ul>
          {view.timeline.legend.length > 0 && (
            <ul className="lab2g-legend" aria-label={LAB_UI.sources}>
              {view.timeline.legend.map((l) => (
                <li key={l.family} className="lab2g-legend-item">
                  <span className="lab2g-ping lab2g-ping-key" data-family={l.family} aria-hidden="true" />
                  <span data-lab-ink="">{l.label}</span>
                </li>
              ))}
              <li className="lab2g-legend-item">
                <span className="lab2g-ribbon-key" data-state="open" aria-hidden="true" />
                <span data-lab-ink="">{LAB_UI.ribbonKey}</span>
              </li>
            </ul>
          )}
        </>
      )}
      {view.watching.rows.length > 0 && (
        <details className="lab2g-watching">
          <summary data-g="LabDisclosure" className="lab2g-summary" data-lab-ink="">{view.watching.text}</summary>
          <ul className="lab2g-rows lab2g-rows-flat">
            {view.watching.rows.map((e) => (
              <li key={e.id}>
                <a data-g="LabLink" href={`?event=${e.id}`} className="lab2g-row" data-lab-shared={`watch-${e.id}`}>
                  <span className="lab2g-row-main" data-lab-ink="">{e.name}</span>
                  <span className="lab2g-row-meta" data-lab-ink="">{[e.ageLabel, e.sources.map((s) => LAB_COPY.radar.familyLabels[s.family] ?? s.family).join(', ')].filter(Boolean).join(' · ')}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 120;
  const h = 28;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 2 - (v / max) * (h - 4)}`).join(' ');
  return (
    <svg className="lab2g-spark" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-lab-mark="">
      <polyline points={pts} fill="none" />
    </svg>
  );
}

function Tide({ view }: { view: RadarPageView }) {
  const t = view.tide;
  const series = [...t.series].sort((a, b) => b.values.reduce((x, y) => x + y, 0) - a.values.reduce((x, y) => x + y, 0)).slice(0, 8);
  const askLive = view.frame.layers.ask === 'live';
  return (
    <div className="lab2g-split">
      <Panel id="lab2g-tide" title={LAB_UI.topicTide} desc={LAB_UI.topicTideDesc}>
        {series.length === 0 ? (
          <SectionNote state={t.state} />
        ) : (
          <ul className="lab2g-rows lab2g-rows-flat">
            {series.map((s) => (
              <li key={s.clusterId} className="lab2g-row lab2g-row-static lab2g-tiderow">
                <span className="lab2g-row-main" data-lab-ink="">{s.label}</span>
                <Spark values={s.values} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel id="lab2g-topics" title={LAB_UI.risingTopics}>
        {t.rows.length === 0 ? (
          <SectionNote state={t.state} />
        ) : (
          <ul className="lab2g-rows lab2g-rows-flat">
            {t.rows.slice(0, 10).map((r) => {
              const inner = (
                <>
                  <span className="lab2g-row-main" data-lab-ink="">{r.label}</span>
                  <span className="lab2g-row-meta" data-lab-ink="">{[r.timing, r.momentumText, `${r.creators} ${LAB_UI.creatorsWord}`].filter(Boolean).join(' · ')}</span>
                </>
              );
              return (
                <li key={r.clusterId}>
                  {askLive ? (
                    <a data-g="LabLink" href={`?ask=${encodeURIComponent(r.label)}`} className="lab2g-row" data-lab-shared={`topic-${r.label}`} data-sheet-title={LAB_UI.kindAsk}>
                      {inner}
                    </a>
                  ) : (
                    <span className="lab2g-row lab2g-row-static">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function LeadTime({ view }: { view: RadarPageView }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem('lab.radar.lead') === '1');
    } catch {
      /* default closed */
    }
  }, []);
  const l = view.leadTime;
  return (
    <details
      className="lab2g-panel lab2g-glassish lab2g-lead"
      open={open}
      onToggle={(e) => {
        const o = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(o);
        try {
          window.localStorage.setItem('lab.radar.lead', o ? '1' : '0');
        } catch {
          /* per-viewer convenience only */
        }
      }}
    >
      <summary data-g="LabDisclosure" className="lab2g-panel-head lab2g-summary">
        <span className="lab2g-panel-titles">
          <span className="lab2g-panel-title" data-lab-ink="">{LAB_UI.leadTime}</span>
          <span className="lab2g-panel-desc" data-lab-ink="">{LAB_UI.leadTimeDesc}</span>
        </span>
        <span className="lab2-pill lab2-seeall lab2g-lead-toggle" aria-hidden="true" data-lab-ink="">{open ? LAB_COPY.labels.hide : LAB_COPY.labels.show}</span>
      </summary>
      {l.rows.length === 0 ? (
        <SectionNote state={l.state} />
      ) : (
        <table className="lab2g-table">
          <thead>
            <tr>
              <th data-lab-ink="">{LAB_UI.colClass}</th>
              <th data-lab-ink="">{LAB_UI.colSource}</th>
              <th data-lab-ink="">{LAB_UI.colLead}</th>
            </tr>
          </thead>
          <tbody>
            {l.rows.map((r, i) => (
              <tr key={i}>
                <td data-lab-ink="">{r.class}</td>
                <td data-lab-ink="">{LAB_COPY.radar.familyLabels[r.family] ?? r.family}</td>
                <td data-lab-ink="">{r.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {l.waveLiftText && <p className="lab2-card-text" data-lab-ink="">{l.waveLiftText}</p>}
      {l.priorText && <p className="lab2g-muted" data-lab-ink="">{l.priorText}</p>}
    </details>
  );
}

export function RadarBody({ view }: { view: RadarPageView }) {
  const sample = view.frame.mode.sample;
  const base = { class: view.filters.eventClass, state: view.filters.windowState };
  if (!view.radar && view.timeline.state.kind === 'not_built') {
    return <Panel title={LAB_UI.radarTitle}><SectionNote state={view.timeline.state} /></Panel>;
  }
  return (
    <div className="lab2g-stack">
      <PageBar
        tools={
          <>
            <span className="lab2g-fgroup" role="group" aria-label={LAB_UI.classLabel}>
              <span className="lab2g-flabel" data-lab-ink="">{LAB_UI.classLabel}</span>
              <FilterChip href={href(base, { class: null }, sample)} active={!view.filters.eventClass}>{LAB_UI.all}</FilterChip>
              <FilterChip href={href(base, { class: 'spike' }, sample)} active={view.filters.eventClass === 'spike'}>{LAB_UI.spike}</FilterChip>
              <FilterChip href={href(base, { class: 'adopted' }, sample)} active={view.filters.eventClass === 'adopted'}>{LAB_UI.adopted}</FilterChip>
              <FilterChip href={href(base, { class: 'unknown' }, sample)} active={view.filters.eventClass === 'unknown'}>{LAB_UI.notClassed}</FilterChip>
            </span>
            <span className="lab2g-fgroup" role="group" aria-label={LAB_UI.stateLabel}>
              <span className="lab2g-flabel" data-lab-ink="">{LAB_UI.stateLabel}</span>
              <FilterChip href={href(base, { state: null }, sample)} active={!view.filters.windowState}>{LAB_UI.all}</FilterChip>
              <FilterChip href={href(base, { state: 'open' }, sample)} active={view.filters.windowState === 'open'}>{LAB_UI.open}</FilterChip>
              <FilterChip href={href(base, { state: 'closing' }, sample)} active={view.filters.windowState === 'closing'}>{LAB_UI.closing}</FilterChip>
              <FilterChip href={href(base, { state: 'closed' }, sample)} active={view.filters.windowState === 'closed'}>{LAB_UI.closed}</FilterChip>
            </span>
          </>
        }
      />
      <Timeline view={view} />
      <Tide view={view} />
      <LeadTime view={view} />
    </div>
  );
}

export function RadarPage({ view }: { view: RadarPageView }) {
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <RadarBody view={view} />
    </GPageShell>
  );
}
