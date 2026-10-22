'use client';

import { useEffect, useState } from 'react';
import { ringFraction } from '@/lib/wizard/helpers';

/**
 * Circular progress — drawn ONLY when a project carries real done/total
 * task structure (never an invented percent). Animates from 0 to its real
 * fraction on mount and on data change; nothing loops.
 */
export function ProgressRing({ done, total, size = 44 }: { done: number; total: number; size?: number }) {
  const fraction = ringFraction(done, total);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - (drawn ? fraction : 0));
  const pct = Math.round(fraction * 100);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${done} of ${total} tasks done`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 700ms var(--ease)', filter: 'drop-shadow(0 0 6px color-mix(in oklab, var(--accent) 60%, transparent))' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[11px] tabular-nums text-os-text">{pct}%</span>
    </div>
  );
}
