'use client';

import type { ReactNode } from 'react';

/**
 * Creative Engine primitives on the paper system (docs/projects/creative-engine/DESIGN.md).
 * Dot-matrix numerals, rulers, driver bars, pills, chips, inputs. Every
 * colour is a token on the page scope.
 */

const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  // S07 F7: "not applicable" is a full-width bar, so it never reads as a loading ellipsis.
  '—': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ',': ['00000', '00000', '00000', '00000', '00000', '00100', '01000'],
};

export function DotNumeral({ value, size = 5, className = '', color = 'var(--accent)' }: { value: string; size?: number; className?: string; color?: string }) {
  const chars = value.split('').filter((c) => GLYPHS[c]);
  const gap = Math.max(2, Math.round(size * 0.55));
  return (
    <span className={`inline-flex items-end ${className}`} style={{ gap: gap * 2 }} aria-label={value} role="img">
      {chars.map((c, i) => (
        <span key={i} className="grid" style={{ gridTemplateColumns: `repeat(5, ${size}px)`, gap }}>
          {GLYPHS[c].flatMap((row, r) => row.split('').map((bit, k) => <span key={`${r}-${k}`} className="rounded-full" style={{ width: size, height: size, background: bit === '1' ? color : 'transparent' }} />))}
        </span>
      ))}
    </span>
  );
}

export function TickGauge({ value, max = 90, ticks = 30, label }: { value: number | null; max?: number; ticks?: number; label?: string }) {
  const pct = value === null ? null : Math.max(0, Math.min(1, value / max));
  const mark = pct === null ? -1 : Math.round(pct * (ticks - 1));
  return (
    <div className="w-full" title={label}>
      <div className="ae-ruler dark">
        {Array.from({ length: ticks }, (_, i) => (<i key={i} className={i === mark ? 'mark' : i % 5 === 0 ? 'tall' : ''} style={{ height: i === mark ? 22 : i % 5 === 0 ? 14 : 8 }} />))}
      </div>
      {label && <div className="ae-faint mt-1">{label}</div>}
    </div>
  );
}

export function DriverBars({ drivers, top = 3, max = 10 }: { drivers: Record<string, number>; top?: number; max?: number }) {
  const entries = Object.entries(drivers).sort((a, b) => b[1] - a[1]).slice(0, Math.max(top, 5));
  if (entries.length === 0) return <div className="ae-faint">no driver data</div>;
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={k} className="flex items-center gap-2.5 text-[11.5px]">
          <span className="w-[72px] truncate text-[var(--p-muted)]">{k}</span>
          <span className="ae-bar flex-1"><i className={i < top ? '' : 'soft'} style={{ width: `${Math.min(100, (v / max) * 100)}%` }} /></span>
          <span className="w-[26px] text-right tabular-nums text-[var(--p-ink)]">{v}</span>
        </div>
      ))}
    </div>
  );
}

export function Chip({ active = false, onClick, children, title, disabled = false }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active} className="ae-chip" data-on={active}>
      {children}
    </button>
  );
}


/** Control row (console): caret label · bound/composed tag · readout. */



export function Select<T extends string>({ value, options, onChange }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)} className="ae-input ae-select">
      {options.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="ae-field"><span>{label}</span>{children}</label>
  );
}

/** An empty state; `action` is the one button that opens the step it names (S04 B34). */
export function Empty({ line1, line2, action }: { line1: string; line2: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex h-full min-h-[180px] flex-col items-center justify-center text-center">
      <p className="text-[15px] font-light text-[var(--p-ink)]">{line1}</p>
      <p className="ae-cap mt-1 max-w-md">{line2}</p>
      {action && <button type="button" onClick={action.onClick} className="ae-btn ae-btn-ink mt-4">{action.label}</button>}
    </div>
  );
}

export function Progress({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-8">
      <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--p-ink)]" />
      <p className="text-[13px] text-[var(--p-muted)]">{text}</p>
    </div>
  );
}

export function ErrorLine({ text }: { text: string }) {
  return <p className="py-3 text-center text-[12.5px] text-[var(--p-red)]">{text}</p>;
}

export function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

export function fmtMs(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
