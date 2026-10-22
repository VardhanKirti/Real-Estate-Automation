'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEventHandler, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { formatCompact } from '@/lib/format-number';
import { deltaIfMeaningful, formatDelta, type Delta } from '@/lib/delta';
import { cx } from './cx';
import { DOT_GLYPHS, DOT_MAX, dotGap, dotHeight, dotText, dotWidth, fitDotSize, prefersDots } from './logic';
import { GBadge, GTag } from './Controls';

/**
 * Numbers (SPEC S00 §5.3, GP3, C6, C7): dot numerals, the plain big
 * numeral, the delta and the stat. A number is never decoration: each one
 * names its value in aria-label and its source in title.
 */

export type DotSize = 3 | 4 | 5 | 6 | 7;
export type DotTone = 'ink' | 'on-hero' | 'muted';

function toText(value: string | number | null | undefined): string {
  if (value == null) return '—';
  if (typeof value === 'number') return formatCompact(value);
  return value;
}

/** The SVG for a glyph string already validated by dotText. */
function DotSvg({ text, size, fluid = false }: { text: string; size: number; fluid?: boolean }) {
  const g = dotGap(size);
  const w = dotWidth(text.length, size);
  const h = dotHeight(size);
  const step = size + g;
  const glyphW = 5 * size + 4 * g + 2 * g;
  const r = size / 2;
  const dots: ReactNode[] = [];
  Array.from(text).forEach((c, i) => {
    const rows = DOT_GLYPHS[c];
    rows.forEach((row, y) => {
      for (let x = 0; x < 5; x++) {
        if (row[x] === '1') dots.push(<circle key={`${i}-${y}-${x}`} cx={i * glyphW + x * step + r} cy={y * step + r} r={r} />);
      }
    });
  });
  return (
    <svg
      width={fluid ? undefined : w}
      height={fluid ? undefined : h}
      viewBox={`0 0 ${w} ${h}`}
      fill="currentColor"
      aria-hidden
      focusable="false"
      style={fluid ? { width: '100%', maxWidth: w, height: 'auto' } : undefined}
    >
      {dots}
    </svg>
  );
}

export type GDotNumberProps = {
  /** Formatted text (`$631K`, `2.29x`, `+7%`) or a number (formatted compact). null = `—`. */
  value: string | number | null;
  /** Dot size 3 to 7, or `auto` to fit the box (falls back to 32px text below 3). */
  size?: DotSize | 'auto';
  /** Largest size `auto` may pick. */
  max?: DotSize;
  tone?: DotTone;
  /** Spoken value; defaults to the text. */
  label?: string;
  title?: string;
  className?: string;
};

/**
 * 5×7 dot numerals (DotNumeral, generalised). Any character without a glyph
 * renders the whole value as tabular text instead, never a dropped digit.
 */
export function GDotNumber({ value, size = 5, max = DOT_MAX, tone = 'ink', label, title, className }: GDotNumberProps) {
  const raw = toText(value);
  const text = dotText(raw);
  const aria = label ?? (value == null || raw === '—' ? 'Not applicable' : raw);
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<{ size: number | null } | null>(null);
  const auto = size === 'auto';
  const chars = text?.length ?? 0;

  useEffect(() => {
    if (!auto || !text) return;
    const el = ref.current;
    if (!el) return;
    const measure = () => setFit({ size: fitDotSize(chars, el.clientWidth, max) });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [auto, text, chars, max]);

  const common = { 'data-g': 'GDotNumber', 'data-tone': tone, role: 'img', 'aria-label': aria, title } as const;

  if (!text) {
    return (
      <span {...common} className={cx('g-dotnum', 'g-dotnum-text', className)} data-size={String(size)}>
        <span aria-hidden>{raw}</span>
      </span>
    );
  }
  if (!auto) {
    return (
      <span {...common} className={cx('g-dotnum', className)} data-size={String(size)}>
        <DotSvg text={text} size={size} />
      </span>
    );
  }
  // auto: until measured, the max size scales down with the box (never overflows);
  // then snap to the largest whole dot size that fits, or text below size 3.
  return (
    <span {...common} ref={ref} className={cx('g-dotnum', 'g-dotnum-fit', className)} data-size="auto">
      {fit === null ? (
        <DotSvg text={text} size={max} fluid />
      ) : fit.size === null ? (
        <span className="g-dotnum-fallback" aria-hidden style={{ '--gk-chars': chars } as CSSProperties}>
          {text}
        </span>
      ) : (
        <DotSvg text={text} size={fit.size} />
      )}
    </span>
  );
}

export type GBigNumberProps = {
  value: string | number | null;
  /** 12px muted unit after the numeral ("elapsed", "days"). */
  unit?: ReactNode;
  title?: string;
  className?: string;
};

/** Plain 34/300 tabular numeral for values too wide for dots (C6). */
export function GBigNumber({ value, unit, title, className }: GBigNumberProps) {
  return (
    <span data-g="GBigNumber" className={cx('g-bignum', className)} title={title}>
      <span className="g-bignum-value">{toText(value)}</span>
      {unit != null && <span className="g-bignum-unit">{unit}</span>}
    </span>
  );
}

export type GDeltaProps = {
  /** A delta from lib/delta.ts; null hides the component. */
  delta?: Delta | null;
  /** Or compute it here with the same rules (X4, C41). */
  cur?: number | null;
  prev?: number | null;
  money?: boolean;
  /** Small-base rule: hide when the previous window holds fewer than `min`. */
  min?: number;
  /** The window, appended to the title ("vs the previous 30 days"). */
  window?: string;
  className?: string;
};

/** Compute the delta GDelta would show, so callers can test and reuse it. */
export function deltaFor({ delta, cur, prev, money, min }: GDeltaProps): Delta | null {
  if (delta !== undefined) return delta;
  return min != null ? deltaIfMeaningful(cur, prev, min, { money }) : formatDelta(cur, prev, { money });
}

/** `↗ +1.4%` in ok, err or muted; sans tabular, never mono, never a bordered pill. */
export function GDelta(props: GDeltaProps) {
  const d = deltaFor(props);
  if (!d) return null;
  const Icon = d.direction === 'up' ? ArrowUpRight : d.direction === 'down' ? ArrowDownRight : ArrowRight;
  const title = props.window ? `${d.title} · ${props.window}` : d.title;
  return (
    <span data-g="GDelta" className={cx('g-delta', props.className)} data-tone={d.tone} title={title}>
      <Icon size={12} strokeWidth={1.75} aria-hidden />
      <span>{d.text}</span>
    </span>
  );
}

export type GStatState = 'ready' | 'loading' | 'error' | 'unconfigured';

export type GStatProps = {
  /** null renders `—` (unknown), never 0. */
  value: string | number | null;
  label: ReactNode;
  /** What the number is and where it comes from (FR-18); shown as the title. */
  source: string;
  /** Where the number lives. A stat without one is display-only. */
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Label as the group's one GBadge instead of a GTag. */
  badge?: boolean;
  state?: GStatState;
  /** Unconfigured: which key or connector is missing (goes in the title). */
  missing?: string;
  /** Secondary readout under the label (usually a GDelta). */
  extra?: ReactNode;
  className?: string;
};

/**
 * Number + label, clickable to where it lives. Dots when the formatted value
 * is at most six characters, plain text otherwise (C6).
 */
export function GStat({ value, label, source, href, onClick, badge = false, state = 'ready', missing, extra, className }: GStatProps) {
  const text = toText(state === 'unconfigured' ? null : value);
  const dots = prefersDots(text);
  const isZero = value === 0 || value === '0';
  const title = state === 'unconfigured' ? `${source} · not configured${missing ? `: ${missing}` : ''}` : state === 'error' ? `${source} · could not load` : source;
  const body = (
    <>
      <span className="g-stat-num" data-dim={state === 'loading' ? 'loading' : isZero ? 'zero' : undefined}>
        {dots ? <GDotNumber value={text} size={4} label={state === 'loading' ? 'Loading' : state === 'unconfigured' ? 'Not configured' : undefined} /> : <span className="g-stat-text">{text}</span>}
      </span>
      <span className="g-stat-label">{badge ? <GBadge>{label}</GBadge> : <GTag>{label}</GTag>}</span>
      {extra != null && <span className="g-stat-extra">{extra}</span>}
      {state === 'error' && <span className="g-stat-err" aria-label="Could not load" />}
    </>
  );
  const shared = { 'data-g': 'GStat', 'data-state': state, title, className: cx('g-stat', className) } as const;
  if (href) {
    return (
      <Link href={href} {...shared} data-action="">
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} {...shared} data-action="">
        {body}
      </button>
    );
  }
  return <div {...shared}>{body}</div>;
}
