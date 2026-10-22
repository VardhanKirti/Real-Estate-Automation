'use client';
/**
 * Radar (`/lab/radar`) under Bennett Legacy (founderos-ui pages/lab.md section 1): the launch timeline as
 * a monochrome scatter (square markers, one lane per 05 EventRow), waves as StepLines, open windows as a
 * MeterStack, the topic tide as a StepLine with the rising topics, and the lead-time ledger. Reads
 * RadarPageView; 05's labels are rendered as given.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MeterStack, StepLine, type Meter } from '@/components/legacy';
import type { RadarPageView } from '@/lib/lab/view/radar';
import { fmtClock, fmtDayMonth } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { waveBuckets } from '../classic/adapt';
import { store } from '../classic/hooks';
import { LEGACY_LAB as L } from './copy';
import { LegacyCapHost } from './dialogs';
import { Frame } from './Frame';
import { Btn, Card, FilterChip, LState, Tag, shows } from './parts';
import { LaneScatter } from './viz';

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

const famLabel = (v: RadarPageView, family: string) => v.timeline.legend.find((g) => g.family === family)?.label ?? family;

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
  const scale = Math.max(1, ...lanes.flatMap((l) => [...(l.lane?.ribbon ?? []).map((r) => r.creators), ...l.row.waveSeries.map((p) => p.creators)]));
  return (
    <div data-l="LabScatter" className="l-lab-lanes" role="list">
      <div className="l-lab-lanes-axis" aria-hidden="true">
        <span />
        <span className="l-axis">
          <span>{C.radar.days}</span>
          <span>{C.radar.now}</span>
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
          className="l-lab-lane"
          data-state={l.row.window?.state ?? 'none'}
          data-lab-shared={`lane-${l.row.id}`}
          aria-label={`${l.row.name}, ${l.stateLabel}, ${l.row.ageLabel}, ${l.row.coverage.label}`}
        >
          <span className="l-lab-lane-name">
            <span className="l-lab-lane-title">{l.row.name}</span>
            <span className="l-lab-lane-meta">
              <Tag tone={l.row.window?.state === 'open' ? 'ok' : l.row.window?.state === 'closing' ? 'warn' : 'quiet'}>{l.stateLabel}</Tag>
              <span className="l-muted">{l.row.ageLabel}</span>
            </span>
          </span>
          <LaneScatter lane={l.lane} from={from} to={to} scaleMax={scale} />
          <span className="l-lab-lane-cov">
            <span>{l.row.coverage.label}</span>
            <span className="l-muted">{l.row.classLabel}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function Waves({ v }: { v: RadarPageView }) {
  const rows = v.timeline.lanes.filter((l) => l.row.waveSeries.length >= 2).slice(0, 4);
  return (
    <Card id="waves" title={L.waves} sub={L.wavesSub} i={2}>
      <LState state={v.timeline.state} compact />
      {shows(v.timeline.state) && (rows.length ? (
        <div className="l-lab-waves">
          {rows.map((l) => {
            const b = waveBuckets(l.row.waveSeries);
            const last = l.row.waveSeries[l.row.waveSeries.length - 1];
            const step = b.length > 2 ? Math.max(1, Math.round(last.h / (b.length - 2))) : 1;
            return (
              <Link key={l.row.id} href={l.href} scroll={false} className="l-lab-wave-item" data-lab-shared={`wave-${l.row.id}`}>
                <span className="l-lab-wave-head">
                  <span className="l-lab-lane-title">{l.row.name}</span>
                  <span className="l-muted">{l.row.coverage.label}</span>
                </span>
                <StepLine series={b.map((c, k) => ({ label: k === 0 ? '0h' : `${Math.min(last.h, k * step)}h`, count: c }))} height={80} empty={l.row.coverage.label} />
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="l-lab-state-text">{C.sheet.noCoverage}</p>
      ))}
    </Card>
  );
}

function Windows({ v }: { v: RadarPageView }) {
  const open = v.timeline.lanes.filter((l) => l.row.window && (l.row.window.state === 'open' || l.row.window.state === 'closing'));
  const meters: Meter[] = open.slice(0, 6).map((l) => ({
    label: l.row.name,
    frac: Math.max(0, 1 - (l.row.window?.progress ?? 1)),
    display: `${l.stateLabel} · ${fmtClock(l.row.window!.closesAt)}`,
    hue: l.row.window?.state === 'closing' ? 'var(--l-warn)' : 'var(--l-text)',
  }));
  return (
    <Card id="windows" title={L.windows} sub={L.windowsSub} i={3}>
      <LState state={v.timeline.state} compact />
      {shows(v.timeline.state) && <MeterStack meters={meters} empty={L.windowsNone} dense />}
    </Card>
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
    <Card id="lead" title={C.radar.leadTime} sub={C.radar.leadDesc} i={6} tools={<Btn aria-expanded={open} aria-controls="lead-body" onClick={toggle}>{open ? C.schedule.hide : C.schedule.show}</Btn>}>
      {open && (
        <div id="lead-body" className="l-stack">
          <LState state={lt.state} />
          {shows(lt.state) && (
            <>
              {lt.waveLiftText && <p className="l-lab-lead">{lt.waveLiftText}</p>}
              {lt.priorText && <p className="l-body-text">{lt.priorText}</p>}
              <div className="l-lab-table-wrap">
                <table className="l-lab-table">
                  <thead>
                    <tr>
                      <th scope="col">{C.radar.leadCols.class}</th>
                      <th scope="col">{C.radar.leadCols.source}</th>
                      <th scope="col">{C.radar.leadCols.lead}</th>
                      <th scope="col" className="is-num">{C.radar.leadCols.n}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lt.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{C.radar.classes[r.class] ?? r.class}</td>
                        <td>{famLabel(v, r.family)}</td>
                        <td>{r.label}</td>
                        <td className="is-num">{r.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}

export function RadarPage({ view }: { view: RadarPageView }) {
  return (
    <LegacyCapHost>
      <RadarBody view={view} />
    </LegacyCapHost>
  );
}

function RadarBody({ view }: { view: RadarPageView }) {
  const href = useHref();
  const f = view.filters;
  const radarLive = view.frame.layers.radar === 'live';
  const [watchOpen, setWatchOpen] = useState(false);
  const tideTotals = view.tide.weeks.map((w, i) => ({ label: Number.isNaN(Date.parse(w)) ? w : fmtDayMonth(w), count: view.tide.series.reduce((s, x) => s + (x.values[i] ?? 0), 0) }));
  const maxPosts = Math.max(1, ...view.tide.rows.map((r) => r.posts));
  const bar = radarLive ? (
    <>
      <span className="l-chip-row" role="group" aria-label={C.radar.classLabel}>
        <FilterChip href={href({ class: null })} active={f.eventClass === null}>{C.radar.classAll}</FilterChip>
        {(['spike', 'adopted', 'unknown'] as const).map((c) => (
          <FilterChip key={c} href={href({ class: c })} active={f.eventClass === c}>{C.radar.classes[c]}</FilterChip>
        ))}
      </span>
      <span className="l-chip-row" role="group" aria-label={C.radar.stateLabel}>
        <FilterChip href={href({ state: null })} active={f.windowState === null}>{C.radar.stateAll}</FilterChip>
        {(['open', 'closing', 'closed'] as const).map((s) => (
          <FilterChip key={s} href={href({ state: s })} active={f.windowState === s}>{C.radar.states[s]}</FilterChip>
        ))}
      </span>
      {f.clearHref && <Link href={f.clearHref} replace scroll={false} className="l-link">{C.clearFilters}</Link>}
    </>
  ) : undefined;
  return (
    <Frame frame={view.frame} sheet={view.sheet} bar={bar}>
      <div className="l-stack">
        <Card
          id="timeline"
          title={C.radar.timeline}
          sub={L.scatterSub}
          i={1}
          tools={view.timeline.legend.length ? (
            <span className="l-chip-row" aria-label={C.radar.sources}>
              {view.timeline.legend.map((g) => <span key={g.family} className="l-lab-legend">{g.label}</span>)}
            </span>
          ) : undefined}
        >
          <LState state={view.timeline.state} />
          {shows(view.timeline.state) && view.timeline.lanes.length > 0 && <Lanes v={view} />}
          {view.radar?.state === 'never_run' && <span className="l-lab-actrow"><Btn primary onClick={() => window.dispatchEvent(new CustomEvent('lab:run'))}>{C.runNow}</Btn></span>}
          {view.watching.text && view.watching.rows.length > 0 && (
            <div className="l-lab-watch">
              <button type="button" className="l-lab-disclose" aria-expanded={watchOpen} aria-controls="watching" onClick={() => setWatchOpen((o) => !o)}>
                <span aria-hidden className="l-lab-disclose-mark" />
                {view.watching.text}
              </button>
              {watchOpen && (
                <ul id="watching" className="l-lab-rows">
                  {view.watching.rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`?event=${r.id}`} scroll={false} data-l="Pressable" data-lens="r" className="l-pressable is-row l-btn-row l-lab-watch-row" data-lab-shared={`watch-${r.id}`}>
                        <span>{r.name}</span>
                        <span className="l-muted">{r.sources.map((s) => famLabel(view, s.family)).join(', ')}</span>
                        <span className="l-muted">{r.ageLabel}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        <div className="l-lab-grid2">
          <Waves v={view} />
          <Windows v={view} />
        </div>

        <div className="l-lab-grid2 is-top">
          <Card id="tide" title={C.radar.tide} sub={C.radar.tideDesc} i={4} flush>
            <LState state={view.tide.state} />
            {shows(view.tide.state) && <StepLine series={tideTotals} height={170} empty={view.tide.state.message ?? ''} />}
          </Card>
          <Card id="topics" title={C.radar.topics} sub={C.radar.topicsDesc} i={5}>
            <LState state={view.tide.state} compact />
            {shows(view.tide.state) && (
              <ul className="l-lab-rows l-lab-topics">
                {view.tide.rows.slice(0, 7).map((r) => {
                  const inner = (
                    <>
                      <span className="l-lab-topic-name">{r.label}</span>
                      <span className="l-chip-row">
                        {r.timing && <Tag tone={r.timing === 'open' ? 'ok' : r.timing === 'closing' ? 'warn' : 'quiet'}>{C.radar.timing[r.timing]}</Tag>}
                        {r.momentumText && <span className="l-num">{r.momentumText}</span>}
                        <span className="l-muted">{`${r.posts} ${C.radar.posts}`}</span>
                        {r.coverage.covered && <span className="l-muted">{C.radar.covered}</span>}
                      </span>
                      <span className="l-lab-topic-bar" aria-hidden><span style={{ width: `${Math.round((r.posts / maxPosts) * 100)}%` }} /></span>
                    </>
                  );
                  return (
                    <li key={r.clusterId}>
                      {view.frame.layers.ask === 'live' ? (
                        <Link href={`?ask=${encodeURIComponent(r.label)}`} scroll={false} data-l="Pressable" data-lens="r" className="l-pressable is-row l-btn-row l-lab-topic" data-lab-shared={`topic-${r.clusterId}`}>{inner}</Link>
                      ) : (
                        <span className="l-lab-topic">{inner}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <LeadTime v={view} />
      </div>
    </Frame>
  );
}
