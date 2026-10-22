'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import {
  BRIEF_STATUSES, RANGE_STORAGE_KEY, TIMELINE_RANGES, TYPICAL_AT, briefStopLabel, defaultRunId, kindNoun, laneFor, narrowerRange, orderedRuns, parseRange,
  placeRuns, progressFor, progressTitle, rangeFor, rangeSpec, runHeadline, runSubline, fmtElapsed, widerRange, type BriefStatus, type RangeKey,
} from '@/lib/creative-engine/timeline';
import { GButton, GSegmented, GTimelineStrip, type TimelineEvent } from '@/components/g';
import { useG } from '@/components/creative-engine/skin';
import { ClassicBriefStatusControl, ClassicRunScrubber, type ScrubberProps } from '@/components/creative-engine/timeline-classic';

/**
 * The Creative Engine's run strip, rendering track and brief status control
 * (SPEC S07 F8 to F26). Under Classic the strip is the paper run scrubber
 * (timeline-classic.tsx, unchanged); under the GladOS style it is the kit's
 * GTimelineStrip with the range as a GSegmented and the selected run's pill as
 * a GButton docked under the strip (glados-ui GP1 FR-GP1.2). All maths lives in
 * lib/creative-engine/timeline.ts and lib/timeline-place.ts.
 */

/** One clock for the page: ticks every second while something runs (F17), else stays put. */
/**
 * `initial` is the server's render time, so the first client render matches the
 * server HTML (no hydration mismatch on dot positions or elapsed times); the
 * effect then moves to the real clock.
 */
export function useNow(active: boolean, initial?: number): number {
  const [now, setNow] = useState(() => initial ?? Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function RunScrubber(props: ScrubberProps) {
  const g = useG();
  return g ? <KitRunStrip {...props} /> : <ClassicRunScrubber {...props} />;
}

/** Run status → kit colour (the timeline legend: delivered ok, failed err, running warn). */
const STATUS_TONE = { delivered: 'ok', failed: 'err', stale: 'err', running: 'warn', queued: 'dim', abandoned: 'dim' } as const;

/**
 * The strip on the kit. A dot (or the slider's Enter) selects a run; the pill
 * under the strip names the selected run and opens it. The range is the
 * viewer's last choice, else the smallest range that holds a run (F8). A
 * cluster zooms one range narrower when that separates it, else lists its
 * runs in the Runs drawer; "+N earlier" widens, or at 30 d lists them (F11).
 */
function KitRunStrip({ runs, now, onOpen, onEmpty, onRunsDrawer }: ScrubberProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [storedRange, setStoredRange] = useState<RangeKey | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    try { setStoredRange(parseRange(window.localStorage.getItem(RANGE_STORAGE_KEY))); } catch { /* storage blocked: default each load */ }
  }, []);
  const range: RangeKey = storedRange ?? rangeFor(runs, now);
  const chooseRange = useCallback((k: RangeKey) => {
    setStoredRange(k);
    try { window.localStorage.setItem(RANGE_STORAGE_KEY, k); } catch { /* session only */ }
  }, []);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = width > 0 && width < 300;
  const pads = useMemo(() => (compact ? { padLeft: 14, padRight: 14 } : { padLeft: 84, padRight: 52 }), [compact]);
  const W = width || 600;
  const placement = useMemo(() => placeRuns(runs, range, W, now, pads), [runs, range, W, now, pads]);
  const order = useMemo(() => orderedRuns(runs, range, now), [runs, range, now]);
  const fallback = defaultRunId(order, now) ?? defaultRunId(runs, now);
  const current = (selectedId && runs.find((r) => r.id === selectedId)) || runs.find((r) => r.id === fallback) || null;
  const thumbX = current ? placement.xOf[current.id] ?? null : null;

  const events: TimelineEvent[] = useMemo(
    () => runs.map((r) => ({ id: r.id, at: r.startedAt, status: r.status, lane: laneFor(r.kind), title: r.title, detail: `${kindNoun(r.kind)} · ${r.status}`, meta: runSubline(r, now) })),
    [runs, now],
  );

  const onCluster = (ids: string[]) => {
    const narrower = narrowerRange(range);
    if (narrower) {
      const p = placeRuns(runs.filter((r) => ids.includes(r.id)), narrower, W, now, pads);
      if (p.earlier === 0 && p.items.length > 1) { chooseRange(narrower); return; }
    }
    onRunsDrawer(ids);
  };
  const onRangeStep = (dir: 'wider' | 'narrower') => {
    const next = dir === 'wider' ? widerRange(range) : narrowerRange(range);
    if (next) chooseRange(next);
    else if (dir === 'wider') onRunsDrawer(runs.filter((r) => !order.includes(r)).map((r) => r.id));
  };

  const line1 = current ? runHeadline(current) : runs.length ? `Nothing in the last ${rangeSpec(range).label}` : 'Nothing has run yet';
  const line2 = current ? runSubline(current, now) : runs.length ? `${placement.earlier} earlier` : 'type a concept to begin';
  const pillLeft = thumbX === null ? '50%' : `${Math.max(0, Math.min(100, (thumbX / W) * 100))}%`;
  // Keep the centred pill inside the strip: a run near either edge would push half of it off
  // the page (390px: scrollWidth 463). Measured after layout, since the pill's width follows its text.
  const thumb = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const t = thumb.current;
    const el = wrap.current;
    if (!t || !el) return;
    const full = el.clientWidth;
    const half = t.offsetWidth / 2;
    const centre = (parseFloat(pillLeft) / 100) * full;
    t.style.left = `${Math.max(half, Math.min(full - half, centre))}px`;
  });

  return (
    <div ref={wrap} className="ce-g-tl mt-6">
      <GTimelineStrip
        events={events}
        spanMs={rangeSpec(range).ms}
        agoLabel={rangeSpec(range).ago}
        now={now}
        readOnly
        statusColor={STATUS_TONE}
        selectedId={current?.id ?? null}
        onDot={(id) => setSelectedId(id)}
        onCluster={onCluster}
        onRangeStep={onRangeStep}
        rangeControl={<GSegmented label="Timeline range" size="sm" value={range} onChange={chooseRange} options={TIMELINE_RANGES.map((r) => ({ value: r.key, label: r.label }))} />}
        emptyText={runs.length ? `Nothing in the last ${rangeSpec(range).label}` : 'Nothing has run yet'}
        label="Runs on the timeline"
      />
      <div ref={thumb} className="ce-g-tl-thumb" style={{ left: pillLeft }}>
        <GButton
          size="sm"
          onClick={() => (current ? onOpen(current) : runs.length === 0 ? onEmpty() : undefined)}
          disabled={!current && runs.length > 0}
          disabledReason={`Nothing in the last ${rangeSpec(range).label}`}
          title={current ? `Open: ${line1}` : 'Open the Creative generator'}
          className="ce-g-tl-pill"
        >
          <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
          <span className="ce-g-tl-l1">{line1}</span>
          <span className="ce-g-tl-l2">{line2}</span>
        </GButton>
      </div>
    </div>
  );
}

/* ── rendering card track (F19 to F22) ── */

export function RenderTrack({ runs, now }: { runs: ResolvedRun[]; now: number }) {
  const running = runs.filter((r) => r.status === 'running').sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const recentFail = running.length ? null : runs.find((r) => (r.status === 'failed' || r.status === 'stale') && r.finishedAt && now - Date.parse(r.finishedAt) < 10 * 60_000) ?? null;
  if (running.length === 0) {
    return (
      <div className="ae-rtrack" style={{ '--pct': 0, '--typ': TYPICAL_AT } as React.CSSProperties} data-phase={recentFail ? 'failed' : 'idle'} role="img" aria-label={recentFail ? `${kindNoun(recentFail.kind)} failed` : 'Nothing rendering'} title={recentFail ? recentFail.error ?? 'Failed' : 'Nothing is rendering'}>
        <span className="ae-rt-line" />
        <span className="ae-rt-tick" />
        <span className="ae-rt-ring" />
        <span className="ae-rt-dot" />
        <span className="ae-rt-thumb" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {running.slice(0, 3).map((r, i) => {
        const p = progressFor(r, now);
        return (
          <div key={r.id} className="ae-rtrack" style={{ '--pct': p.pct, '--typ': p.tick } as React.CSSProperties} data-mini={i > 0 || undefined} data-phase={p.phase} role="img" aria-label={`${kindNoun(r.kind)} ${fmtElapsed(p.elapsedMs)} elapsed. ${progressTitle(r)}`} title={progressTitle(r)}>
            <span className="ae-rt-line" />
            <span className="ae-rt-fill" />
            <span className="ae-rt-tick" />
            <span className="ae-rt-ring" />
            <span className="ae-rt-dot" />
            <span className="ae-rt-thumb" />
          </div>
        );
      })}
    </div>
  );
}

/* ── brief status control (F23 to F26) ── */

/**
 * The brief's status (draft, ready, sent to a creator). Classic folds it into
 * the Ready-for-you badge and reveals the stops on hover; the kit draws the
 * three stops as one small GSegmented (arrows move, Home/End jump). Disabled,
 * with its reason, in the sample.
 */
export function BriefStatusControl(props: { status: BriefStatus; disabled?: boolean; disabledReason?: string; onChange: (s: BriefStatus) => void; wide?: boolean }) {
  const g = useG();
  if (!g) return <ClassicBriefStatusControl {...props} />;
  const { status, disabled = false, disabledReason, onChange } = props;
  return (
    <GSegmented
      label="Brief status"
      size="sm"
      value={status}
      onChange={(s) => { if (!disabled && s !== status) onChange(s); }}
      options={BRIEF_STATUSES.map((s) => ({ value: s, label: briefStopLabel(s), disabled: disabled && s !== status, title: disabled ? disabledReason : 'Brief status: draft, ready, or sent to a creator' }))}
      className="ce-g-bstat"
    />
  );
}
