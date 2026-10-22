import type { ReactNode } from 'react';
import { cx, dotState, type BadgeTone, type Tone } from './format';

/** Rounded outline pill, mono, with an optional status LED (FO kit Chip). */
export function Chip({ tone, children, className }: { tone?: Tone; children?: ReactNode; className?: string }) {
  return (
    <span data-l="Chip" className={cx('l-chip', className)}>
      {tone && <span aria-hidden className="l-chip-dot" data-tone={tone} />}
      {children}
    </span>
  );
}

/** Uppercase mono badge with a tone border (FO kit Badge). `ghost` draws a dashed outline. */
export function Badge({ tone = 'default', ghost = false, children }: { tone?: BadgeTone; ghost?: boolean; children?: ReactNode }) {
  return (
    <span data-l="Badge" data-tone={tone} className={cx('l-badge', ghost && 'is-ghost')}>
      {children}
    </span>
  );
}

/** Round 6px LED (FO v1 terminal.tsx Dot). Only an ok dot blinks, and only when asked. */
export function Dot({ state, pulse = false, label }: { state: string; pulse?: boolean; label?: string }) {
  const s = dotState(state);
  return (
    <span
      data-l="Dot"
      data-state={s}
      className={cx('l-dot', s, pulse && s === 'ok' && 'pulse')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Keycap; `sm` is the palette's compact 16px key. */
export function Kbd({ size = 'md', children }: { size?: 'md' | 'sm'; children?: ReactNode }) {
  return (
    <kbd data-l="Kbd" className={cx('l-kbd', size === 'sm' && 'l-kbd-sm')}>
      {children}
    </kbd>
  );
}
