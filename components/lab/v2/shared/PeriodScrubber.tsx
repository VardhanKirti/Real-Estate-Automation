'use client';
/**
 * Period scrubber (02 section 9): "< ||||| This week ||||| >". A slider over the periods; arrows, Home and
 * End step, drag snaps every 24px. Scopes only the sections below it.
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { snapTick } from '@/lib/lab/motion';
import { Glass } from './Glass';
import { IconChevronLeft, IconChevronRight } from './icons';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type Period = { id: string; label: string; from: string; to: string };
export type PeriodScrubberProps = { periods: Period[]; value?: string; onChange?: (id: string) => void; label?: string };

const DRAG_STEP = 24;

function Ticks({ side }: { side: 'l' | 'r' }) {
  return (
    <span className="lab2-ticks" data-side={side} aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => {
        const near = side === 'l' ? i >= 5 : i <= 1;
        return <span key={i} className="lab2-tick" data-tall={i % 2 === 0 ? '' : undefined} data-near={near ? '' : undefined} />;
      })}
    </span>
  );
}

export function PeriodScrubber({ periods, value, onChange, label = 'Period' }: PeriodScrubberProps) {
  const km = useKitMark();
  const [local, setLocal] = useState(value ?? periods[periods.length - 1]?.id);
  const cur = onChange ? value : local;
  const idx = Math.max(0, periods.findIndex((p) => p.id === cur));
  const drag = useRef<{ x: number; start: number } | null>(null);
  const set = (i: number) => {
    const j = Math.min(periods.length - 1, Math.max(0, i));
    const id = periods[j]?.id;
    if (!id || j === idx) return;
    if (onChange) onChange(id);
    else setLocal(id);
  };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: idx - 1, ArrowRight: idx + 1, Home: 0, End: periods.length - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    set(map[e.key]);
  };
  const onDown = (e: PointerEvent<HTMLElement>) => {
    drag.current = { x: e.clientX, start: idx };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    const off = drag.current.start * DRAG_STEP - (e.clientX - drag.current.x);
    set(snapTick(off, DRAG_STEP, periods.length));
  };
  const onUp = () => { drag.current = null; };
  const atStart = idx <= 0;
  const atEnd = idx >= periods.length - 1;
  const p = periods[idx];
  return (
    <Glass tone="base" radius="pill" priority={0} className="lab2-scrub" data-lab="PeriodScrubber" {...km('LabPeriodScrubber')}>
      <button type="button" className="lab2-scrub-btn" aria-label="Previous period" aria-disabled={atStart ? true : undefined} onClick={() => !atStart && set(idx - 1)} data-lab-mark="">
        <IconChevronLeft size={14} />
      </button>
      <span
        className="lab2-scrub-mid"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, periods.length - 1)}
        aria-valuenow={idx}
        aria-valuetext={p?.label}
        onKeyDown={onKey}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Ticks side="l" />
        <span className="lab2-scrub-label" data-lab-ink="">{p?.label}</span>
        <Ticks side="r" />
      </span>
      <button type="button" className="lab2-scrub-btn" aria-label="Next period" aria-disabled={atEnd ? true : undefined} onClick={() => !atEnd && set(idx + 1)} data-lab-mark="">
        <IconChevronRight size={14} />
      </button>
    </Glass>
  );
}
