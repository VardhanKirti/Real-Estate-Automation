'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { cx } from './cx';
import { rovingIndex } from './logic';

/**
 * Controls (SPEC S00 §5.3, §3.2 "this is buttons too", C3, GP3). The one
 * control per role: GButton for actions and button-styled links, GChip for
 * filters and toggles, GSegmented for ranges and views, GTabs for big-title
 * tabs, GToggle and GCheck, GPill / GPillNav for nav lists only, GBadge for
 * the one headline per group, GTag for status and counts.
 *
 * Disabled controls say why in `title` (`disabledReason`).
 */

/* ── GButton ──────────────────────────────────────────────────────────── */

export type GButtonVariant = 'default' | 'ink' | 'danger' | 'icon' | 'sm';
export type GButtonSize = 'md' | 'sm' | 'compact';

type ButtonOwn = {
  /** `ink` is the one primary per view; `icon` is a round icon button (needs aria-label); `sm` is shorthand for size="sm". */
  variant?: GButtonVariant;
  size?: GButtonSize;
  /** Shows the orbit spinner, keeps the width, blocks clicks. */
  busy?: boolean;
  /** Why the control is disabled; becomes the title. */
  disabledReason?: string;
  className?: string;
  children?: ReactNode;
};

export type GButtonProps = ButtonOwn &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    /** A button-styled link: renders next/link (or a plain anchor for external / download links). */
    href?: string;
    /** Open an absolute URL in a new tab. */
    external?: boolean;
    download?: string | boolean;
  };

export const GButton = forwardRef<HTMLButtonElement & HTMLAnchorElement, GButtonProps>(function GButton(
  { variant = 'default', size, busy = false, disabledReason, className, children, href, external, download, disabled, title, type, onClick, ...rest },
  ref,
) {
  const v = variant === 'sm' ? 'default' : variant;
  const s = variant === 'sm' ? 'sm' : (size ?? 'md');
  const off = Boolean(disabled) || busy;
  if (process.env.NODE_ENV !== 'production' && v === 'icon' && !rest['aria-label'] && !title) {
    console.warn('GButton variant="icon" needs an aria-label.');
  }
  const cls = cx('g-btn', className);
  const attrs = {
    'data-g': 'GButton',
    'data-variant': v,
    'data-size': s,
    'data-busy': busy ? 'true' : undefined,
    'aria-busy': busy || undefined,
    title: disabled && disabledReason ? disabledReason : title,
  } as const;
  const inner = (
    <>
      {busy && <span className="g-btn-spin" aria-hidden />}
      <span className="g-btn-label">{children}</span>
    </>
  );
  if (href && !off) {
    const anchorProps = {
      ...attrs,
      className: cls,
      'aria-label': rest['aria-label'],
      onClick: onClick as unknown as MouseEventHandler<HTMLAnchorElement> | undefined,
    };
    if (external || download !== undefined || /^(https?:|mailto:|tel:)/.test(href)) {
      return (
        <a
          ref={ref}
          href={href}
          download={download === true ? '' : download || undefined}
          target={external ? '_blank' : undefined}
          rel={external ? 'noreferrer noopener' : undefined}
          {...anchorProps}
        >
          {inner}
        </a>
      );
    }
    return (
      <Link ref={ref} href={href} {...anchorProps}>
        {inner}
      </Link>
    );
  }
  return (
    <button ref={ref} type={type ?? 'button'} disabled={off} onClick={onClick} className={cls} {...attrs} {...rest}>
      {inner}
    </button>
  );
});

/* ── GBadge / GTag ────────────────────────────────────────────────────── */

/** The one headline badge per group: 11/500 on --g-badge. */
export function GBadge({ children, title, className }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span data-g="GBadge" className={cx('g-badge', className)} title={title}>
      {children}
    </span>
  );
}

export type GTagTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'err' | 'outline';

export type GTagProps = {
  children: ReactNode;
  tone?: GTagTone;
  /** Leading 6px dot in the tone colour. */
  dot?: boolean;
  /** `xs` 10px for edge labels. */
  size?: 'xs' | 'sm';
  title?: string;
  className?: string;
};

/** Small status or count label on a soft tone fill. Not a control. */
export function GTag({ children, tone = 'neutral', dot = false, size = 'sm', title, className }: GTagProps) {
  return (
    <span data-g="GTag" className={cx('g-tag', className)} data-tone={tone} data-size={size} title={title}>
      {dot && <span className="g-tag-dot" aria-hidden />}
      {children}
    </span>
  );
}

/* ── GChip ────────────────────────────────────────────────────────────── */

export type GChipProps = {
  children: ReactNode;
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  size?: 'md' | 'compact';
  /** Optional count after the label. */
  count?: number;
  disabled?: boolean;
  disabledReason?: string;
  title?: string;
  className?: string;
};

/** Filter or toggle chip; active = ink fill; `aria-pressed`. */
export function GChip({ children, pressed, onPressedChange, size = 'md', count, disabled, disabledReason, title, className }: GChipProps) {
  return (
    <button
      type="button"
      data-g="GChip"
      data-size={size}
      className={cx('g-chip', className)}
      aria-pressed={pressed}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : title}
      onClick={() => onPressedChange(!pressed)}
    >
      {children}
      {count != null && <span className="g-chip-count">{count}</span>}
    </button>
  );
}

/* ── GSegmented ───────────────────────────────────────────────────────── */

export type GOption<T extends string> = { value: T; label: ReactNode; disabled?: boolean; title?: string };

export type GSegmentedProps<T extends string> = {
  options: readonly GOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group for assistive tech ("Range", "View"). */
  label: string;
  /** `sm` chart ranges (11px), `md` Settings (12.5px), `compact` 28px tools. */
  size?: 'sm' | 'md' | 'compact';
  className?: string;
};

/**
 * Track-pill radiogroup. Arrows move and select, Home/End jump; overflowing
 * options scroll with an edge fade on the side that has more.
 */
export function GSegmented<T extends string>({ options, value, onChange, label, size = 'sm', className }: GSegmentedProps<T>) {
  const track = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });
  const updateFade = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setFade({ start: el.scrollLeft > 1, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    updateFade();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFade, options.length]);

  const selected = Math.max(0, options.findIndex((o) => o.value === value));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(e.key, selected, options.map((o) => Boolean(o.disabled)));
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    const btn = track.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next];
    btn?.focus();
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <div
      ref={track}
      data-g="GSegmented"
      data-size={size}
      data-fade-start={fade.start || undefined}
      data-fade-end={fade.end || undefined}
      className={cx('g-seg', className)}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      onScroll={updateFade}
    >
      {options.map((o, i) => {
        const on = i === selected;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            title={o.title}
            className="g-seg-opt"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── GTabs ────────────────────────────────────────────────────────────── */

export type GTab = { value: string; label: ReactNode; disabled?: boolean; /** id of the panel this tab shows. */ controls?: string };

export type GTabsProps = {
  tabs: readonly GTab[];
  /** Big-title tabs (default) or `anchor` tabs that scroll to sections with these ids. */
  variant?: 'title' | 'anchor';
  /** Selected tab. Anchor tabs track the section in view when omitted. */
  value?: string;
  onChange?: (value: string) => void;
  /** Mirror the selection in the URL (`?tab=`) with replaceState. Title tabs only. */
  param?: string;
  label: string;
  className?: string;
};

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Big-title tabs 28/300, inactive --g-dim; tablist with arrows and
 * Home/End. `anchor` scrolls to sections and follows the one in view.
 */
export function GTabs({ tabs, variant = 'title', value, onChange, param, label, className }: GTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<string | null>(null);
  const anchor = variant === 'anchor';
  const current = value ?? (anchor ? (inView ?? tabs[0]?.value) : tabs[0]?.value);

  useEffect(() => {
    if (!anchor || value !== undefined || typeof IntersectionObserver === 'undefined') return;
    const els = tabs.map((t) => document.getElementById(t.value)).filter((el): el is HTMLElement => Boolean(el));
    if (els.length === 0) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        const top = tabs.find((t) => (visible.get(t.value) ?? 0) > 0);
        if (top) setInView(top.value);
      },
      { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.01, 0.5] },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [anchor, value, tabs]);

  const select = (v: string) => {
    onChange?.(v);
    if (anchor) {
      setInView(v);
      document.getElementById(v)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    } else if (param && typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set(param, v);
      window.history.replaceState(window.history.state, '', url);
    }
  };

  const idx = Math.max(0, tabs.findIndex((t) => t.value === current));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingIndex(e.key, idx, tabs.map((t) => Boolean(t.disabled)));
    if (next === null) return;
    e.preventDefault();
    select(tabs[next].value);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div ref={list} data-g="GTabs" data-variant={variant} className={cx('g-tabs', className)} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => {
        const on = i === idx;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={t.controls ?? (anchor ? t.value : undefined)}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            className="g-tab"
            onClick={() => select(t.value)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── GToggle / GCheck ─────────────────────────────────────────────────── */

export type GToggleProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Visible label after the switch; or pass aria-label. */
  children?: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
};

/** 36×20 switch, on = --g-accent. */
export function GToggle({ checked, onCheckedChange, children, disabled, disabledReason, className, ...aria }: GToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      data-g="GToggle"
      className={cx('g-toggle', className)}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="g-toggle-track" aria-hidden>
        <span className="g-toggle-knob" />
      </span>
      {children != null && <span className="g-toggle-label">{children}</span>}
    </button>
  );
}

export type GCheckProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  children?: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
};

/** 24px round check, on = --g-badge. */
export function GCheck({ checked, onCheckedChange, children, disabled, disabledReason, className, ...aria }: GCheckProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={aria['aria-label']}
      data-g="GCheck"
      className={cx('g-check', className)}
      disabled={disabled}
      title={disabled ? disabledReason : undefined}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="g-check-box" aria-hidden>
        {checked && <Check size={14} strokeWidth={2} />}
      </span>
      {children != null && <span className="g-check-label">{children}</span>}
    </button>
  );
}

/* ── GPill / GPillNav ─────────────────────────────────────────────────── */

export type GPillProps = {
  label: ReactNode;
  /** A 16px stroke icon (lucide), rendered at stroke 1.6. */
  icon?: ReactNode;
  /** Right badge: a count or short status. */
  badge?: ReactNode;
  active?: boolean;
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
  className?: string;
  /** A pill that opens a popover it anchors (the Creative Engine's campaign switcher, GP1). */
  'aria-haspopup'?: 'true' | 'dialog' | 'menu';
  'aria-expanded'?: boolean;
};

/** Full-width nav-list pill. Nav lists only (C3); actions are GButton. */
export const GPill = forwardRef<HTMLButtonElement & HTMLAnchorElement, GPillProps>(function GPill(
  { label, icon, badge, active = false, href, onClick, title, className, 'aria-haspopup': hasPopup, 'aria-expanded': expanded },
  ref,
) {
  const body = (
    <>
      {icon != null && (
        <span className="g-pill-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="g-pill-label">{label}</span>
      {badge != null && <span className="g-pill-badge">{badge}</span>}
    </>
  );
  const attrs = { 'data-g': 'GPill', 'data-active': active || undefined, title, className: cx('g-pill', className) } as const;
  if (href) {
    return (
      <Link ref={ref} href={href} aria-current={active ? 'page' : undefined} {...attrs}>
        {body}
      </Link>
    );
  }
  return (
    <button ref={ref} type="button" aria-pressed={hasPopup ? undefined : active} aria-haspopup={hasPopup} aria-expanded={expanded} onClick={onClick} {...attrs}>
      {body}
    </button>
  );
});

export type GPillNavProps = {
  items: readonly (GPillProps & { id: string })[];
  label: string;
  className?: string;
};

/** Stacked nav pills with a 12px gap; wraps as chips under a 760px container. */
export function GPillNav({ items, label, className }: GPillNavProps) {
  return (
    <nav data-g="GPillNav" aria-label={label} className={cx('g-pillnav', className)}>
      <ul className="g-pillnav-list">
        {items.map(({ id, ...p }) => (
          <li key={id}>
            <GPill {...p} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
