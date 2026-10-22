import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './format';

type Tone = 'primary' | 'secondary' | 'ghost' | 'row' | 'pill';

const TONE: Record<Tone, string> = {
  primary: 'is-primary l-btn',
  secondary: 'is-dark l-btn',
  ghost: 'is-dark l-btn-icon',
  row: 'is-row l-btn-row',
  pill: 'is-dark l-pill',
};

type PressableProps = {
  tone?: Tone;
  /** Lens strength: "c" control or "r" row/card. Rows default to r. */
  kind?: 'c' | 'r';
  href?: string;
  className?: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

/**
 * The one clickable primitive (FO v1 Pressable): hover lens, press sink, focus
 * ring, themed per tone. A link when given an href. `pill` is the slab header
 * pill ("monitor-only · refreshes 60s").
 */
export function Pressable({ tone = 'secondary', kind, href, className, children, type = 'button', ...rest }: PressableProps) {
  const lens = kind ?? (tone === 'row' ? 'r' : 'c');
  const cls = cx('l-pressable', TONE[tone], className);
  if (href) {
    return (
      <Link href={href} data-l="Pressable" data-lens={lens} data-tone={tone} className={cls} aria-label={rest['aria-label']} title={rest.title}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} data-l="Pressable" data-lens={lens} data-tone={tone} className={cls} {...rest}>
      {children}
    </button>
  );
}

/** A 24px toggle pill (FO v1 Pressable Chip): solid when on, the dark lens when off. */
export function ToggleChip({
  on = false,
  className,
  children,
  ...rest
}: { on?: boolean; className?: string; children?: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>) {
  return (
    <button
      type="button"
      data-l="ToggleChip"
      data-lens="c"
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      className={cx('l-pressable l-toggle-chip', !on && 'is-dark', className)}
      {...rest}
    >
      {children}
    </button>
  );
}
