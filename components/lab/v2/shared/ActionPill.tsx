'use client';
/** ActionPill, PlusButton (menu button), RoundButton and ArrowButton (02 section 11). */
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconArrowUpRight, IconClose, IconMenu, IconPlay, IconPlus, IconPlusCircle } from './icons';
import { usePresence } from './motion/usePresence';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type ActionPillProps = {
  label: string;
  icon?: 'plus' | 'play';
  href?: string;
  onClick?: () => void;
  busy?: boolean;
  progress?: number | null;
  disabled?: boolean;
  disabledReason?: string;
  sharedId?: string;
  /** Determinate run ring (03.8): finished of total runs, exposed as a progressbar. */
  progressValue?: { now: number; max: number } | null;
};

/** 14px progress ring: determinate when progress is a number, else a rotating 25% arc. */
export function ProgressRing({ progress, size = 14 }: { progress: number | null | undefined; size?: number }) {
  const r = (size - 2) / 2;
  const c = 2 * Math.PI * r;
  const det = typeof progress === 'number' && Number.isFinite(progress);
  const frac = det ? Math.min(1, Math.max(0, progress as number)) : 0.25;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={det ? 'lab2-ring' : 'lab2-ring lab2-ring-spin'} data-lab-mark="">
      <circle className="lab2-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={1.5} />
      <circle
        className="lab2-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={`${c} ${c}`}
        strokeDashoffset={c * (1 - frac)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

export function ActionPill({ label, icon = 'plus', href, onClick, busy, progress, disabled, disabledReason, sharedId, progressValue }: ActionPillProps) {
  const ring = (
    <span role="progressbar" aria-label={label} aria-valuemin={progressValue ? 0 : undefined} aria-valuenow={progressValue?.now} aria-valuemax={progressValue?.max} className="lab2-action-ring">
      <ProgressRing progress={progress} />
    </span>
  );
  const lead = busy ? ring : icon === 'play' ? <IconPlay size={14} /> : <IconPlusCircle size={14} />;
  const km = useKitMark();
  const common = {
    className: 'lab2-pill lab2-action',
    'data-lab': 'ActionPill',
    ...km('LabActionPill'),
    'data-lab-shared': sharedId,
    'aria-busy': busy ? true : undefined,
    title: disabled ? disabledReason : undefined,
  } as const;
  const body = (
    <>
      <span className="lab2-action-icon" data-lab-mark="">{lead}</span>
      <span data-lab-ink="">{label}</span>
    </>
  );
  if (href && !disabled) {
    return <Link href={href} scroll={false} {...common}>{body}</Link>;
  }
  return (
    <button type="button" {...common} onClick={disabled ? undefined : onClick} aria-disabled={disabled ? true : undefined}>
      {body}
    </button>
  );
}

export type PlusMenuItem = { id: string; label: string; href?: string; onSelect?: () => void; disabled?: boolean; disabledReason?: string };
export type PlusButtonProps = { label: string; items: PlusMenuItem[] };

/** The white round "+" that opens the create menu (WAI-ARIA menu button). */
export function PlusButton({ label, items }: PlusButtonProps) {
  const km = useKitMark();
  const [open, setOpen] = useState(false);
  const { mounted, closing } = usePresence(open);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const focusItem = (i: number) => {
    const els = menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!els || !els.length) return;
    els[(i + els.length) % els.length].focus();
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusItem(0));
    const onDoc = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(els.length - 1); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <span className="lab2-plus-wrap" data-lab="PlusButton" {...km('LabPlusButton')}>
      <button
        ref={btn}
        type="button"
        className="lab2-round lab2-round-solid"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onBtnKey}
      >
        <IconPlus size={18} />
      </button>
      {mounted && (
        <div ref={menu} id={id} role="menu" aria-label={label} className="lab2-menu lab2-glass" data-tone="strong" data-radius="chip" data-blur="on" onKeyDown={onMenuKey} data-lab-closing={closing ? '' : undefined} aria-hidden={closing ? true : undefined}>
          {items.map((it) =>
            it.href && !it.disabled ? (
              <Link key={it.id} role="menuitem" tabIndex={-1} href={it.href} scroll={false} className="lab2-menu-item" data-lab-ink="" onClick={() => close(false)}>
                {it.label}
              </Link>
            ) : (
              <button
                key={it.id}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="lab2-menu-item"
                data-lab-ink=""
                aria-disabled={it.disabled ? true : undefined}
                title={it.disabled ? it.disabledReason : undefined}
                onClick={() => {
                  if (it.disabled) return;
                  it.onSelect?.();
                  close();
                }}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </span>
  );
}

export type RoundButtonProps = { label: string; icon: 'menu' | 'close'; href?: string; onClick?: () => void; sharedId?: string };

/** The solid round button (menu, close). */
export function RoundButton({ label, icon, href, onClick, sharedId }: RoundButtonProps) {
  const glyph = icon === 'close' ? <IconClose size={18} /> : <IconMenu size={18} />;
  const km = useKitMark();
  const common = { className: 'lab2-round lab2-round-solid', 'aria-label': label, 'data-lab': 'RoundButton', ...km('LabRoundButton'), 'data-lab-shared': sharedId } as const;
  if (href) return <Link href={href} scroll={false} {...common}>{glyph}</Link>;
  return <button type="button" onClick={onClick} {...common}>{glyph}</button>;
}

export type ArrowButtonProps = { label: string; href?: string; onClick?: () => void; size?: 32 | 36; decorative?: boolean };

/** Glass tint circle with the up-right arrow. `decorative` renders a visual affordance inside a link. */
export function ArrowButton({ label, href, onClick, size = 36, decorative }: ArrowButtonProps) {
  const km = useKitMark();
  const common = { className: 'lab2-arrow', 'data-size': String(size), 'data-lab': 'ArrowButton', ...km('LabArrowButton') } as const;
  const glyph = <IconArrowUpRight size={14} />;
  if (decorative) return <span {...common} aria-hidden="true" data-lab-mark="">{glyph}</span>;
  if (href) return <Link href={href} scroll={false} aria-label={label} {...common} data-lab-mark="">{glyph}</Link>;
  return <button type="button" aria-label={label} onClick={onClick} {...common} data-lab-mark="">{glyph}</button>;
}
