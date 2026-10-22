'use client';

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { orderedEvents, placeEvents, type PlacedEvent } from '@/lib/timeline-place';
import { GButton } from './Controls';
import { GChartTooltip } from './GChartTooltip';
import { colorVar, useWidth, VizStateBody, type VizColor, type VizStateProps } from './viz-shared';

export type TimelineEvent = {
  id: string;
  /** ISO string or epoch ms */
  at: string | number;
  /** status key; its colour comes from `statusColor` */
  status: string;
  /** 0 to 2 (default 1, the middle lane) */
  lane?: 0 | 1 | 2;
  /** tip line 1: "Sol Vantage" */
  title: string;
  /** tip line 2: "Sent · 23 Aug, 22:12" */
  detail?: string;
  /** tip line 3: "3 msgs in thread" */
  meta?: string;
};

export type GTimelineStripProps = VizStateProps & {
  events: readonly TimelineEvent[];
  /** window length in ms (24 h, 7 d, 30 d) */
  spanMs: number;
  /** left gutter label: "7 d ago" */
  agoLabel: string;
  /** right gutter label (default "now"); a forward-looking strip passes `now` as its end, e.g. "in 24 h" */
  endLabel?: string;
  now?: number;
  /** read-only: no docked thumb (GP3). The thumb mode stays in the Creative Engine's RunScrubber until GP1. */
  readOnly?: true;
  /** status → colour; default sent accent, announced ink, skipped dim */
  statusColor?: Readonly<Record<string, VizColor>>;
  /** dot click or Enter: open that event */
  onDot?: (id: string) => void;
  /** cluster click: the page zooms one range narrower or opens the list */
  onCluster?: (ids: string[]) => void;
  /** PageUp / PageDown and "+N earlier" */
  onRangeStep?: (dir: 'wider' | 'narrower') => void;
  selectedId?: string | null;
  /** the head row's right side: the range GSegmented */
  rangeControl?: ReactNode;
  label: string;
  className?: string;
};

const LANE_Y = [0.3, 0.52, 0.74] as const;
const DEFAULT_COLOURS: Record<string, VizColor> = { sent: 'accent', announced: 'ink', skipped: 'dim' };

/**
 * GTimelineStrip (S00 §5.3, S02 §5.6.1, GP3 `readOnly`): a 64px pill track in
 * the engine's timeline language: texture dots, "N ago" and "now" gutters
 * (dropped under 300px), 7px event dots by status, overlapping dots merged
 * into ink cluster pills. Placement is lib/timeline-place.ts, shared with
 * the Creative Engine. Keyboard: the track is one slider (Left/Right step
 * events, Enter opens, PageUp/PageDown change the range).
 */
export function GTimelineStrip({
  events, spanMs, agoLabel, endLabel = 'now', now: nowProp, statusColor = DEFAULT_COLOURS, onDot, onCluster, onRangeStep, selectedId = null, rangeControl, label, className = '', ...stateProps
}: GTimelineStripProps) {
  const [ref, W] = useWidth<HTMLDivElement>(560);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const now = nowProp ?? Date.now();
  const compact = W < 300;
  const placement = useMemo(
    () => placeEvents(events.map((e) => ({ id: e.id, at: e.at, lane: e.lane ?? 1, status: e.status })), spanMs, W, now, compact ? { padLeft: 14, padRight: 14 } : { padLeft: 84, padRight: 52 }),
    [events, spanMs, W, now, compact],
  );
  const order = useMemo(() => orderedEvents(events, spanMs, now), [events, spanMs, now]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const body = stateProps.state && stateProps.state !== 'ready' ? VizStateBody({ ...stateProps, height: 64 }) : null;
  if (body) return <div data-g="GTimelineStrip" className={`g-tl ${className}`}>{body}</div>;

  const cursorId = cursor !== null ? order[cursor]?.id ?? null : null;
  const itemOf = (id: string | null): PlacedEvent | null => (id ? placement.items.find((it) => it.runIds.includes(id)) ?? null : null);
  const tipItem = itemOf(hover) ?? itemOf(cursorId);
  const tip = tipItem ? tipFor(tipItem, byId) : null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = order.length;
    if (e.key === 'PageUp' && onRangeStep) { e.preventDefault(); onRangeStep('wider'); return; }
    if (e.key === 'PageDown' && onRangeStep) { e.preventDefault(); onRangeStep('narrower'); return; }
    if (n === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (c === null ? n - 1 : Math.max(0, c - 1))); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (c === null ? n - 1 : Math.min(n - 1, c + 1))); }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); setCursor(n - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && cursorId && onDot) { e.preventDefault(); onDot(cursorId); }
  };

  const valueText = cursorId ? [byId.get(cursorId)?.title, byId.get(cursorId)?.detail].filter(Boolean).join(', ') : order.length ? `${order.length} events` : `Nothing in this range`;

  return (
    <div data-g="GTimelineStrip" className={`g-tl ${className}`}>
      {(rangeControl || (placement.earlier > 0 && onRangeStep)) && (
        <div className="g-tl-head">
          {placement.earlier > 0 && onRangeStep ? (
            <GButton variant="sm" className="g-viz-act" onClick={() => onRangeStep('wider')} title="Show a wider range">+{placement.earlier} earlier</GButton>
          ) : <span />}
          {rangeControl}
        </div>
      )}
      <div
        ref={ref}
        className="g-tl-track"
        role="slider"
        tabIndex={0}
        aria-label={`${label}. Arrow keys step through events${onDot ? ', Enter opens one' : ''}${onRangeStep ? ', Page Up and Page Down change the range' : ''}.`}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, order.length - 1)}
        aria-valuenow={cursor ?? Math.max(0, order.length - 1)}
        aria-valuetext={valueText}
        onKeyDown={onKey}
        onBlur={() => setCursor(null)}
      >
        <div aria-hidden="true" className="g-tl-texture">
          {Array.from({ length: 28 }, (_, i) => (<span key={i} style={{ left: `${3 + i * 3.4}%`, top: `${i % 3 === 0 ? 70 : i % 3 === 1 ? 58 : 46}%` }} />))}
        </div>
        {!compact && <span className="g-tl-gutter" style={{ left: 16 }} aria-hidden="true">{agoLabel}</span>}
        {!compact && <span className="g-tl-gutter" style={{ right: 16 }} aria-hidden="true">{endLabel}</span>}
        {order.length === 0 && <span className="g-tl-none">{stateProps.emptyText ?? 'Nothing in this range'}</span>}
        {placement.items.map((it) => {
          const sel = (selectedId !== null && it.runIds.includes(selectedId)) || (cursorId !== null && it.runIds.includes(cursorId));
          const ev = it.kind === 'dot' ? byId.get(it.id) : null;
          const aria = it.kind === 'cluster' ? `${it.runIds.length} events` : [ev?.title, ev?.detail].filter(Boolean).join(', ');
          const style = { left: it.x, top: `${LANE_Y[Math.max(0, Math.min(2, it.lane))] * 100}%`, ...(it.kind === 'dot' ? { background: colorVar(statusColor[it.status] ?? 'dim') } : {}) };
          const hov = { onPointerEnter: () => setHover(it.runIds[0]), onPointerLeave: () => setHover((h) => (it.runIds.includes(h ?? '') ? null : h)) };
          const click = it.kind === 'cluster' ? (onCluster ? () => onCluster(it.runIds) : undefined) : onDot ? () => onDot(it.id) : undefined;
          return click ? (
            <button key={it.id} type="button" tabIndex={-1} aria-label={aria} className={it.kind === 'cluster' ? 'g-tl-cluster' : 'g-tl-dot'} data-status={it.kind === 'dot' ? it.status : undefined} data-selected={sel || undefined} style={style} onClick={click} {...hov}>
              {it.kind === 'cluster' ? it.runIds.length : null}
            </button>
          ) : (
            <span key={it.id} aria-hidden="true" className={it.kind === 'cluster' ? 'g-tl-cluster' : 'g-tl-dot'} data-status={it.kind === 'dot' ? it.status : undefined} data-selected={sel || undefined} style={style} {...hov}>
              {it.kind === 'cluster' ? it.runIds.length : null}
            </span>
          );
        })}
        {tip && tipItem && <GChartTooltip x={tipItem.x} y={8} containerWidth={W} title={tip.title} lines={tip.lines} />}
      </div>
    </div>
  );
}

function tipFor(it: PlacedEvent, byId: Map<string, TimelineEvent>): { title: string; lines: string[] } {
  if (it.kind === 'cluster') {
    const names = it.runIds.map((id) => byId.get(id)?.title).filter((t): t is string => !!t);
    return { title: `${it.runIds.length} events`, lines: [names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : ''), 'Click to zoom in'] };
  }
  const e = byId.get(it.id);
  return { title: e?.title ?? it.id, lines: [e?.detail, e?.meta].filter((x): x is string => !!x) };
}
