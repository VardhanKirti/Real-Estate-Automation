'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { ResolvedRun } from '@/lib/creative-engine/runs';
import {
  BRIEF_STATUSES, LANE_Y, RANGE_STORAGE_KEY, TIMELINE_RANGES, agoText, briefStatusLabel, briefStopLabel, defaultRunId, elapsedAt, fmtElapsed,
  kindNoun, narrowerRange, nearestRunId, orderedRuns, parseRange, placeRuns, rangeFor, rangeSpec, runAriaLabel, runHeadline,
  runSubline, widerRange, type BriefStatus, type Placed, type RangeKey,
} from '@/lib/creative-engine/timeline';
import { fmtCredits } from '@/lib/creative-engine/format';
import { pushEscape } from '@/lib/escape-stack';

/**
 * The Classic tree's run scrubber and brief status control (glados-ui GP1,
 * X5): the engine's "brief ready" strip made a run scrubber (SPEC S07 F8 to
 * F18): dots are runs on a time axis, the floating pill is the thumb that
 * selects one, and clicking the pill opens that run's result; and the brief
 * status control (F23 to F26). Moved here unchanged so the shared surfaces
 * hold no Classic control; EngineTimeline.tsx picks this or the kit. All
 * maths lives in lib/creative-engine/timeline.ts.
 */

const STATUS_COLOUR: Record<string, string> = { delivered: 'var(--p-green)', failed: 'var(--p-red)', stale: 'var(--p-red)', running: 'var(--p-orange)', queued: 'var(--p-dim)', abandoned: 'var(--p-dim)' };
/** Side gutters: the "N ago" label on the left, "now" on the right. Dots never enter them (F9). */
const PAD_LEFT = 84;
const PAD_RIGHT = 52;
const FOLLOW_AFTER_MS = 30_000;


export type ScrubberProps = {
  runs: ResolvedRun[];
  now: number;
  /** pill click on a run: open its result (F15) */
  onOpen: (run: ResolvedRun) => void;
  /** pill click with no runs at all: start a concept */
  onEmpty: () => void;
  /** a cluster that cannot zoom further, or "+N earlier" at 30 d: the Runs drawer on those runs */
  onRunsDrawer: (ids: string[]) => void;
};

export function ClassicRunScrubber({ runs, now, onOpen, onEmpty, onRunsDrawer }: ScrubberProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pillW, setPillW] = useState(0);
  const [storedRange, setStoredRange] = useState<RangeKey | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<Placed | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const lastMove = useRef(0);
  const drag = useRef<{ x: number; from: number; moved: boolean; id: number } | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // Range: the viewer's last choice, else the smallest range that holds a run (F8).
  useEffect(() => {
    try { setStoredRange(parseRange(window.localStorage.getItem(RANGE_STORAGE_KEY))); } catch { /* storage blocked: default each load */ }
  }, []);
  const range: RangeKey = storedRange ?? rangeFor(runs, now);
  const chooseRange = useCallback((k: RangeKey) => {
    setStoredRange(k);
    try { window.localStorage.setItem(RANGE_STORAGE_KEY, k); } catch { /* session only */ }
  }, []);

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A strip too narrow for the side labels drops them and uses the whole width (the range chips still say the span).
  const compact = width > 0 && width < 300;
  const pads = useMemo(() => (compact ? { padLeft: 14, padRight: 14 } : { padLeft: PAD_LEFT, padRight: PAD_RIGHT }), [compact]);
  const placement = useMemo(() => placeRuns(runs, range, width || 600, now, pads), [runs, range, width, now, pads]);
  const order = useMemo(() => orderedRuns(runs, range, now), [runs, range, now]);

  // The thumb follows the default (newest running, else newest delivered) until the viewer moves it.
  const fallback = defaultRunId(order, now) ?? defaultRunId(runs, now);
  const current = (selectedId && runs.find((r) => r.id === selectedId)) || runs.find((r) => r.id === fallback) || null;
  const index = current ? order.findIndex((r) => r.id === current.id) : -1;
  const thumbX = current && placement.xOf[current.id] !== undefined ? placement.xOf[current.id] : null;

  // F16: a new run joins. If the viewer has not touched the thumb for 30 s it follows; else the new dot pulses once.
  useEffect(() => {
    const ids = new Set(runs.map((r) => r.id));
    const before = seen.current;
    seen.current = ids;
    if (!before) return;
    const fresh = runs.filter((r) => !before.has(r.id));
    if (fresh.length === 0) return;
    if (Date.now() - lastMove.current > FOLLOW_AFTER_MS) setSelectedId(null);
    else setPulseId(fresh[0].id);
  }, [runs]);
  useEffect(() => {
    if (!pulseId) return;
    const t = setTimeout(() => setPulseId(null), 1400);
    return () => clearTimeout(t);
  }, [pulseId]);

  useLayoutEffect(() => {
    if (pillRef.current) setPillW(pillRef.current.offsetWidth);
  });

  const select = (id: string | null) => {
    lastMove.current = Date.now();
    setSelectedId(id);
  };

  const step = (delta: number) => {
    if (order.length === 0) return;
    const i = index < 0 ? order.length - 1 : Math.max(0, Math.min(order.length - 1, index + delta));
    select(order[i].id);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowDown') { e.preventDefault(); step(-1); }
    else if (k === 'ArrowRight' || k === 'ArrowUp') { e.preventDefault(); step(1); }
    else if (k === 'Home') { e.preventDefault(); if (order[0]) select(order[0].id); }
    else if (k === 'End') { e.preventDefault(); if (order.length) select(order[order.length - 1].id); }
    else if (k === 'PageUp') { e.preventDefault(); const w = widerRange(range); if (w) chooseRange(w); }
    else if (k === 'PageDown') { e.preventDefault(); const n = narrowerRange(range); if (n) chooseRange(n); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); activate(); }
  };

  const activate = () => {
    if (current) onOpen(current);
    else if (runs.length === 0) onEmpty();
  };

  const xFromEvent = (clientX: number) => clientX - (stripRef.current?.getBoundingClientRect().left ?? 0);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, from: thumbX ?? xFromEvent(e.clientX), moved: false, id: e.pointerId };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.x) <= 4) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    const id = nearestRunId(placement.xOf, d.from + (e.clientX - d.x), order); // the thumb moves by the pointer's travel, so an edge-clamped pill does not jump
    if (id && id !== current?.id) select(id);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) activate(); // under 4 px of travel is a click (§6)
  };

  const onCluster = (c: Placed) => {
    const narrower = narrowerRange(range);
    if (narrower) {
      const members = runs.filter((r) => c.runIds.includes(r.id));
      const p = placeRuns(members, narrower, width || 600, now, pads);
      if (p.earlier === 0 && p.items.length > 1) { chooseRange(narrower); return; }
    }
    onRunsDrawer(c.runIds);
  };

  const onEarlier = () => {
    const w = widerRange(range);
    if (w) chooseRange(w);
    else onRunsDrawer(runs.filter((r) => !order.includes(r)).map((r) => r.id));
  };

  // Pill text (F12, F13).
  const line1 = current ? runHeadline(current) : runs.length ? `Nothing in the last ${rangeSpec(range).label}` : 'Nothing has run yet';
  const line2 = current ? runSubline(current, now) : runs.length ? `${placement.earlier} earlier` : 'type a concept to begin';
  const half = pillW / 2;
  const W = width || 600;
  const pillLeft = thumbX === null ? W / 2 : Math.max(half + 4, Math.min(W - half - 4, thumbX));
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);

  return (
    // The thumb docks under the strip once there are runs, so it never covers the dots it selects.
    <div className="ae-tl mt-6" data-docked={runs.length > 0 || undefined}>
      <div className="ae-tl-head">
        {placement.earlier > 0 ? (
          <button type="button" className="ae-tl-earlier" onClick={onEarlier} title={widerRange(range) ? `Show the last ${rangeSpec(widerRange(range)!).label}` : 'Open these runs in the Runs drawer'}>+{placement.earlier} earlier</button>
        ) : <span />}
        <RangeToggle value={range} onChange={chooseRange} />
      </div>
      <div ref={stripRef} className="ae-timeline" data-dragging={dragging || undefined}>
        <div aria-hidden="true" className="ae-tl-texture">
          {Array.from({ length: 28 }, (_, i) => (<span key={i} className="ae-dot" style={{ left: `${3 + i * 3.4}%`, top: `${i % 3 === 0 ? 70 : i % 3 === 1 ? 58 : 46}%`, width: 3, height: 3, background: 'var(--p-dim)', opacity: 0.6 }} />))}
        </div>
        {!compact && <span className="ae-tl-label" style={{ left: 16 }}>{rangeSpec(range).ago}</span>}
        {!compact && <span className="ae-tl-label" style={{ right: 16 }}>now</span>}
        {placement.items.map((it) => {
          const run = it.kind === 'dot' ? runsById.get(it.id) : null;
          const sel = current ? it.runIds.includes(current.id) : false;
          const label = it.kind === 'dot' && run ? runAriaLabel(run, now) : `${it.runIds.length} runs`;
          return (
            <button
              key={it.id}
              type="button"
              tabIndex={-1}
              aria-label={label}
              className={it.kind === 'cluster' ? 'ae-tl-cluster' : 'ae-tl-dot'}
              data-status={it.kind === 'dot' ? it.status : undefined}
              data-selected={sel || undefined}
              data-pulse={it.runIds.includes(pulseId ?? '') || undefined}
              style={{ left: it.x, top: `${LANE_Y[it.lane] * 100}%`, ...(it.kind === 'dot' ? { background: STATUS_COLOUR[it.status] ?? 'var(--p-dim)' } : {}) }}
              onMouseEnter={() => setHover(it)}
              onMouseLeave={() => setHover((h) => (h?.id === it.id ? null : h))}
              onFocus={() => setHover(it)}
              onBlur={() => setHover(null)}
              onClick={() => (it.kind === 'cluster' ? onCluster(it) : select(it.id))}
            >
              {it.kind === 'cluster' ? it.runIds.length : null}
            </button>
          );
        })}
        {thumbX !== null && <span aria-hidden="true" className="ae-tl-caret" data-dragging={dragging || undefined} style={{ left: thumbX }} />}
        {hover && <DotTip item={hover} runs={runsById} now={now} width={W} />}
        {runs.length === 0 ? (
          <button type="button" ref={pillRef as unknown as React.Ref<HTMLButtonElement>} className="ae-float ae-tl-thumb" style={{ left: pillLeft }} onClick={onEmpty} title="Open the Creative generator">
            <PillText line1={line1} line2={line2} />
          </button>
        ) : (
          <div
            ref={pillRef}
            role="slider"
            tabIndex={0}
            aria-label="Run on the timeline"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, order.length - 1)}
            aria-valuenow={Math.max(0, index)}
            aria-valuetext={`${line1}, ${line2}`}
            title={current ? 'Drag to pick a run, click to open it. Arrow keys step, Page Up and Page Down change the range.' : undefined}
            className="ae-float ae-tl-thumb"
            data-docked=""
            data-dragging={dragging || undefined}
            style={{ left: pillLeft }}
            onKeyDown={onKey}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { drag.current = null; setDragging(false); }}
          >
            <PillText line1={line1} line2={line2} />
          </div>
        )}
      </div>
    </div>
  );
}

function PillText({ line1, line2 }: { line1: string; line2: string }) {
  return (
    <>
      <div className="ae-tl-l1"><ArrowUpRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} /><span className="truncate">{line1}</span></div>
      <div className="ae-tl-l2">{line2}</div>
    </>
  );
}

function RangeToggle({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = TIMELINE_RANGES.findIndex((r) => r.key === value);
    const next = TIMELINE_RANGES[(i + (e.key === 'ArrowRight' ? 1 : -1) + TIMELINE_RANGES.length) % TIMELINE_RANGES.length].key;
    onChange(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-range='${next}']`)?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" aria-label="Timeline range" className="ae-tl-range" onKeyDown={onKey}>
      {TIMELINE_RANGES.map((r) => (
        <button key={r.key} type="button" role="radio" aria-checked={value === r.key} tabIndex={value === r.key ? 0 : -1} data-range={r.key} data-on={value === r.key} className="ae-tl-range-opt" onClick={() => onChange(r.key)}>{r.label}</button>
      ))}
    </div>
  );
}

function DotTip({ item, runs, now, width }: { item: Placed; runs: Map<string, ResolvedRun>; now: number; width: number }) {
  const left = Math.max(120, Math.min(width - 120, item.x));
  const members = item.runIds.map((id) => runs.get(id)).filter((r): r is ResolvedRun => !!r);
  return (
    <div className="ae-card-2 ae-tl-tip" role="tooltip" style={{ left }}>
      {item.kind === 'cluster' ? (
        <>
          <div className="text-[var(--p-ink)]">{members.length} runs here</div>
          <ul className="mt-1 space-y-0.5">
            {members.slice(-5).reverse().map((r) => (<li key={r.id} className="truncate text-[var(--p-muted)]">{runHeadline(r)} · {agoText(r.startedAt, now)}</li>))}
          </ul>
          <div className="ae-faint mt-1">Click to zoom in or list them.</div>
        </>
      ) : members[0] ? (
        <TipRun run={members[0]} now={now} />
      ) : null}
    </div>
  );
}

function TipRun({ run, now }: { run: ResolvedRun; now: number }) {
  const credits = run.arcads?.creditsCharged;
  return (
    <>
      <div className="truncate text-[var(--p-ink)]">{run.title}</div>
      <div className="text-[var(--p-muted)]">{kindNoun(run.kind)} · {run.status}</div>
      <div className="text-[var(--p-muted)]">Started {agoText(run.startedAt, now)} · {fmtElapsed(elapsedAt(run, now))}{credits != null ? ` · ${fmtCredits(credits)} credits` : ''}</div>
    </>
  );
}


/**
 * The Ready-for-you badge, which is also the brief's status control. At rest
 * it reads the stored status ("Brief ready"); hover, focus or a tap reveals
 * the three stops. Left/Right on the focused control changes the status,
 * Escape folds it back. Disabled (with its reason) in the sample.
 */
export function ClassicBriefStatusControl({ status, disabled = false, disabledReason, onChange, wide = false }: { status: BriefStatus; disabled?: boolean; disabledReason?: string; onChange: (s: BriefStatus) => void; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    return pushEscape(() => setOpen(false), { id: 'ae-brief-status' });
  }, [open]);
  const set = (s: BriefStatus) => {
    if (disabled || s === status) return;
    onChange(s);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setOpen(true);
    const i = BRIEF_STATUSES.indexOf(status);
    const next = BRIEF_STATUSES[Math.max(0, Math.min(BRIEF_STATUSES.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
    set(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-stop='${next}']`)?.focus());
  };
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label="Brief status"
      aria-disabled={disabled || undefined}
      title={disabled ? disabledReason : 'Brief status: draft, ready, or sent to a creator'}
      className="ae-bstat"
      data-open={open || undefined}
      data-wide={wide || undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!ref.current?.contains(document.activeElement)) setOpen(false); }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
      onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
    >
      {BRIEF_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={s === status}
          tabIndex={s === status ? 0 : -1}
          disabled={disabled && s !== status}
          data-stop={s}
          className={s === status ? 'ae-badge-lime ae-bstat-stop' : 'ae-tag ae-bstat-stop'}
          onClick={() => (s === status ? setOpen((o) => !o) : set(s))}
        >
          {s === status && !open ? briefStatusLabel(s) : briefStopLabel(s)}
        </button>
      ))}
    </div>
  );
}
