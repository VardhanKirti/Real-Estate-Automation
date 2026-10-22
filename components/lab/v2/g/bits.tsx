'use client';
/**
 * Small GladOS-tree pieces every page uses: a section's honest state line (01 5.2 SectionState: the view
 * decides the kind and copy, this only draws it, with a SetupLink when the action is Setup), section
 * headers on glass panels, and a chip.
 */
import Link from 'next/link';
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { Glass, type GlassPriority } from '@/components/lab/v2/shared';
import type { SectionState } from '@/lib/lab/view/shared';

/**
 * The house SetupLink (CLAUDE.md: an unconfigured integration shows Set up) inside the GladOS Lab. Its
 * Classic utility classes are the house component's own, so the GP4 guard is told why it is allowed.
 */
export function LabSetupLink({ href, label, className = 'lab2-setup' }: { href: string; label: string; className?: string }) {
  return (
    <span className="lab2g-setupwrap" data-g-exempt="SetupLink: the house set-up affordance every unconfigured surface must show">
      <SetupLink href={href} label={label} className={className} />
    </span>
  );
}

export function SectionNote({ state, className }: { state: SectionState; className?: string }) {
  if (!state.message && !state.action) return null;
  const setup = state.action && (state.action.href.includes('setup=') || state.kind === 'needs_key' || state.kind === 'off');
  return (
    <div className={['lab2g-note', className].filter(Boolean).join(' ')} data-state={state.kind}>
      {state.message && <p className="lab2g-note-text" data-lab-ink="">{state.message}</p>}
      {state.action &&
        (setup ? (
          <LabSetupLink href={state.action.href} label={state.action.label} />
        ) : (
          <Link data-g="LabLink" href={state.action.href} className="lab2-pill lab2-seeall" data-lab-ink="">{state.action.label}</Link>
        ))}
    </div>
  );
}

/** A titled glass panel: the common container of every page body section below the frame. */
export function Panel({
  title,
  desc,
  tools,
  children,
  className,
  id,
  priority = 3,
  as = 'section',
}: {
  title?: ReactNode;
  desc?: ReactNode;
  tools?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
  priority?: GlassPriority;
  as?: 'section' | 'div';
}) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <Glass as={as} tone="strong" radius="tile" priority={priority} className={['lab2g-panel', className].filter(Boolean).join(' ')} aria-labelledby={title ? hid : undefined} id={id}>
      {(title || tools) && (
        <header className="lab2g-panel-head">
          <span className="lab2g-panel-titles">
            {title && <h2 id={hid} className="lab2g-panel-title" data-lab-ink="">{title}</h2>}
            {desc && <span className="lab2g-panel-desc" data-lab-ink="">{desc}</span>}
          </span>
          {tools && <span className="lab2g-panel-tools">{tools}</span>}
        </header>
      )}
      {children}
    </Glass>
  );
}

/** A page title row under the frame, for the five pages whose tab is not already the page heading. */
export function PageBar({ children, tools }: { children?: ReactNode; tools?: ReactNode }) {
  return (
    <div className="lab2g-pagebar">
      {children && <div className="lab2g-pagebar-main">{children}</div>}
      {tools && <div className="lab2g-pagebar-tools">{tools}</div>}
    </div>
  );
}

export function Chip({ children, tone, title }: { children: ReactNode; tone?: 'up' | 'down' | 'warn' | 'neutral' | 'strong'; title?: string }) {
  // The ink sits on an inner span so contrast is measured on the text, not the pill's rounded corners.
  return (
    <span className="lab2-chip lab2g-chip" data-tone={tone} title={title}>
      <span data-lab-ink="">{children}</span>
    </span>
  );
}

/** A filter chip that is a link (replace navigation, scroll kept). */
export function FilterChip({ href, active, children, count }: { href: string; active: boolean; children: ReactNode; count?: number }) {
  return (
    <Link data-g="LabLink" href={href} replace scroll={false} className="lab2g-fchip" aria-current={active ? 'true' : undefined} data-lab-no-sheet="">
      <span data-lab-ink="">{children}</span>
      {typeof count === 'number' && <span className="lab2g-fchip-n">{count}</span>}
    </Link>
  );
}

/**
 * One tab stop for a group of links or buttons (01 22.2: Playbook format chips, Studio's idea list): arrow
 * keys, Home and End move real focus; the current item (aria-current) or the first is the tab stop.
 */
export function useRoving<T extends HTMLElement>(selector: string) {
  const ref = useRef<T>(null);
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>(selector) ?? [])];
  useEffect(() => {
    const all = items();
    if (!all.length) return;
    let cur = all.findIndex((t) => t.getAttribute('tabindex') === '0');
    if (cur < 0) cur = Math.max(0, all.findIndex((t) => t.getAttribute('aria-current') === 'true'));
    all.forEach((t, i) => t.setAttribute('tabindex', i === cur ? '0' : '-1'));
  });
  const onKeyDown = (e: KeyboardEvent<T>) => {
    const all = items();
    const i = all.findIndex((t) => t === document.activeElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(all.length - 1, next));
    all.forEach((t, k) => t.setAttribute('tabindex', k === j ? '0' : '-1'));
    all[j].focus();
  };
  return { ref, onKeyDown };
}
