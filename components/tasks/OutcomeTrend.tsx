'use client';

import { useState } from 'react';
import type { OutcomeTrend as Trend } from '@/lib/tasks-metrics';
import type { AgentRun } from '@/lib/schemas';
import { outcomeTrend } from '@/lib/tasks-metrics';
import { RunsEmpty } from '@/components/tasks/RunsEmpty';

/**
 * The dark reference's "Since last month…" panel (docs/TASKS-REDESIGN.md
 * §5.7), retargeted from meetings to run outcomes: a headline sentence with
 * the delta inline, a window tab row, Succeeded/Failed chips, and an area
 * chart. Everything from `agent_runs.ok`.
 *
 * Each tab is a trailing window ending now, so it is labelled "Last N days"
 * (it said "First N days" while computing the last N: H27).
 */
const WINDOWS = [4, 8, 16, 21];

export function OutcomeTrend({
  runs,
  now,
  lastRunAt,
}: {
  runs: AgentRun[];
  now: number;
  lastRunAt: string | null;
}) {
  // open on the shortest window that has runs in it: landing on an empty tab
  // when a longer one has data reads as broken rather than honest
  const [days, setDays] = useState(
    () => WINDOWS.find((w) => outcomeTrend(runs, w, now) != null) ?? 8,
  );
  const trend: Trend | null = outcomeTrend(runs, days, now);

  if (!trend) {
    return (
      <div className="glass-panel flex min-h-[220px] flex-col items-center justify-center gap-1.5 px-5 py-6 text-center">
        <div className="glass-label self-start">Run outcomes</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
          {/* minDays above the page ranges: these tabs are this card's own
              windows, so widening the page range would not change them */}
          <RunsEmpty windowLabel={`the last ${days} days`} lastRunAt={lastRunAt} now={now} minDays={Infinity} />
        </div>
      </div>
    );
  }

  const peak = Math.max(1, ...trend.points.map((p) => p.succeeded + p.failed));
  const W = 100;
  const H = 90;
  const pt = (i: number, v: number) => `${(i / Math.max(1, trend.points.length - 1)) * W},${H - (v / peak) * H}`;
  const line = trend.points.map((p, i) => pt(i, p.succeeded + p.failed)).join(' ');
  const up = (trend.delta ?? 0) >= 0;

  return (
    <div className="glass-panel flex flex-col overflow-hidden px-5 py-4">
      <div className="text-[13.5px] font-medium">
        Over the last {days} days, agent runs succeeded{' '}
        {trend.delta == null ? (
          <span className="text-os-dim">at {Math.round((trend.succeeded / (trend.succeeded + trend.failed)) * 100)}%</span>
        ) : (
          <span className={up ? 'text-[var(--accent)]' : 'text-[var(--err)]'}>
            {up ? '+' : ''}{trend.delta}%
          </span>
        )}{' '}
        {trend.delta != null && <span className="text-os-dim">against the window before</span>}
      </div>

      <div className="mt-3 flex items-center gap-4 border-b border-os-border text-[12px]">
        {WINDOWS.map((w) => (
          <button
            key={w}
            onClick={() => setDays(w)}
            className={`-mb-px border-b-2 pb-2 transition-colors ${
              days === w ? 'border-[var(--accent)] text-os-text' : 'border-transparent text-os-dim hover:text-os-muted'
            }`}
          >
            Last {w} days
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11.5px]">
        <span className="flex items-center gap-1.5 rounded-full border border-os-border px-2 py-0.5 text-os-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          {trend.succeeded} succeeded
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-os-border px-2 py-0.5 text-os-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--err)' }} />
          {trend.failed} failed
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-3 h-[90px] w-full">
        <defs>
          <linearGradient id="tasks-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#tasks-trend-fill)" />
        <polyline
          points={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          className="tasks-draw"
        />
      </svg>
    </div>
  );
}
