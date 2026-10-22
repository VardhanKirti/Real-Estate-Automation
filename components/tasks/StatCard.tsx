'use client';

import type { ReactNode } from 'react';
import { useCountUp } from '@/components/tasks/useCountUp';

/**
 * The Syncro stat card, cloned (docs/TASKS-REDESIGN.md §5.1): stroke icon +
 * label top-left, big tabular number, delta chip beside it, caption below.
 *
 * `value` is a string so a card can read "142h 40m" or an honest "—". The
 * delta chip is omitted rather than shown as 0% when there is nothing to
 * compare against.
 */
export function StatCard({
  icon,
  label,
  value,
  delta,
  caption,
  countTo,
  tone = 'default',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  delta?: number | null;
  caption: string;
  /** when the value is a plain number, animate up to it on mount */
  countTo?: number;
  tone?: 'default' | 'warn';
}) {
  const counted = useCountUp(countTo);
  const shown = countTo != null ? String(counted) : value;
  const up = (delta ?? 0) >= 0;

  return (
    <div className="tasks-stat glass-panel flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12.5px] text-os-dim">
          <span className="text-os-muted">{icon}</span>
          {label}
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span
          className={`text-[32px] font-normal leading-none tabular-nums ${
            tone === 'warn' ? 'text-[var(--warn)]' : 'text-os-text'
          }`}
        >
          {shown}
        </span>
        {delta != null && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
              up
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'bg-[color-mix(in_srgb,var(--err)_12%,transparent)] text-[var(--err)]'
            }`}
          >
            {up ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
        )}
      </div>

      <div className="text-[11.5px] leading-snug text-os-dim">{caption}</div>
    </div>
  );
}
