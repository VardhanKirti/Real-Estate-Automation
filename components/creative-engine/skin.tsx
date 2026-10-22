'use client';

import { createContext, forwardRef, useContext, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { GButton, GChip, GCheck, GInput, GMenu, GPill, GSelect, GTabs, GTextarea } from '@/components/g';
import { cx } from '@/components/g/cx';
import { SetupLink as ClassicSetupLink } from '@/components/SetupLink';
import { Chip as ClassicChip } from '@/components/creative-engine/primitives';
import {
  ClassicActionsMenu, ClassicBareInput, ClassicBareSelect, ClassicBareTextarea, ClassicBtn, ClassicCheckMark, ClassicDownload, ClassicInput, ClassicOctaneLink, ClassicPickPill, ClassicPill, ClassicPopAnchor, ClassicSelect, ClassicTextarea, ClassicTextButton, ClassicTitleTabs, type ClassicMenuItem,
} from '@/components/creative-engine/classic';

/**
 * One Creative Engine, two skins (glados-ui SPEC GP1, X5, §3.2).
 *
 * The engine keeps one implementation of every surface: state, data and
 * layout are shared. Only the leaves differ. Under the GladOS style (the route
 * is in G_READY and <html data-ui="glados">) every control renders from the G
 * kit; under Classic the same call renders the markup the engine always had
 * (components/creative-engine/classic.tsx), so Classic is unchanged (AC00.8).
 *
 * page.tsx decides once on the server (getAppearance + isGReady) and the
 * Dashboard provides it; surfaces read it with useG(). Surfaces import their
 * controls from here, never .ae-* control classes or raw <button>/<input>
 * (tests/g-controls.test.ts scans them, GP4).
 */

const SkinContext = createContext(false);

export function EngineSkin({ g, children }: { g: boolean; children: ReactNode }) {
  return <SkinContext.Provider value={g}>{children}</SkinContext.Provider>;
}

/** True when the engine renders its GladOS tree. */
export function useG(): boolean {
  return useContext(SkinContext);
}

/* ── buttons ───────────────────────────────────────────────────────────── */

export type BtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  /** `ink` is the one primary per view. */
  tone?: 'default' | 'ink' | 'danger';
  /** `sm` and `compact` (28px tool rows, GP3). */
  size?: 'md' | 'sm' | 'compact';
  /** Round icon button: needs aria-label. */
  icon?: boolean;
  href?: string;
  /** Classic only: client navigation through next/link (the kit always does for internal links). */
  link?: boolean;
  external?: boolean;
  download?: string | boolean;
  /** Why the control is disabled (kit: becomes the title). */
  disabledReason?: string;
  /** Kit only: the orbit spinner while a request is in flight (Classic callers draw their own busy state). */
  busy?: boolean;
  /** Layout classes for both skins. */
  className?: string;
  /** Classes only the kit skin gets (layout tweaks against the kit recipe). */
  gClassName?: string;
  /** Classes only the Classic skin gets. */
  cClassName?: string;
};

/** Every action button and button-styled link: GButton, or the engine's Classic .ae-btn. */
export const Btn = forwardRef<HTMLButtonElement & HTMLAnchorElement, BtnProps>(function Btn({ tone = 'default', size = 'md', icon = false, className, gClassName, cClassName, disabledReason, link, busy, ...rest }, ref) {
  const g = useG();
  if (g) {
    const variant = icon ? 'icon' : tone === 'ink' ? 'ink' : tone === 'danger' ? 'danger' : 'default';
    const { 'data-busy': _ignored, ...kit } = rest as typeof rest & { 'data-busy'?: unknown };
    return <GButton ref={ref} variant={variant} size={icon && size === 'md' ? 'sm' : size} disabledReason={disabledReason} busy={busy} className={cx(className, gClassName)} {...kit} />;
  }
  return <ClassicBtn ref={ref} tone={tone} size={size} icon={icon} link={link} className={cx(className, cClassName)} {...rest} />;
});

/**
 * A button that reads as text in a sentence ("Show", "Retry", "Replace").
 * Classic drew it as underlined text with the caller's classes; the kit has
 * no text-button role, so it is the small GButton (§3.2: a control is a kit control).
 */
export function TextButton({ onClick, children, title, disabled, cClassName, gClassName, 'aria-label': ariaLabel }: { onClick: () => void; children: ReactNode; title?: string; disabled?: boolean; cClassName?: string; gClassName?: string; 'aria-label'?: string }) {
  const g = useG();
  if (g) return <GButton size="sm" onClick={onClick} title={title} disabled={disabled} aria-label={ariaLabel} className={gClassName}>{children}</GButton>;
  return <ClassicTextButton onClick={onClick} title={title} disabled={disabled} aria-label={ariaLabel} className={cClassName}>{children}</ClassicTextButton>;
}

/** A proof-ad thumbnail that opens the ad: the paper .ae-thumb tile; under the kit a GButton drawn as the same tile. */
export function ThumbButton({ onClick, title, children }: { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; title: string; children: ReactNode }) {
  const g = useG();
  if (g) return <GButton onClick={onClick} title={title} className="ae-thumb ce-g-thumb">{children}</GButton>;
  return <ClassicTextButton onClick={onClick} title={title} className="ae-thumb">{children}</ClassicTextButton>;
}

/**
 * A pickable tile (an actor, a voice, a node template): the caller's card classes under Classic;
 * under the kit a GButton laid out as the same tile (.ce-g-tile), aria-pressed when it is a choice.
 */
export const TileButton = forwardRef<HTMLButtonElement & HTMLAnchorElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & Skinned>(function TileButton({ className, gClassName, cClassName, children, ...rest }, ref) {
  const g = useG();
  if (g) return <GButton ref={ref} className={cx('ce-g-tile', className, gClassName)} {...rest}>{children}</GButton>;
  return <ClassicTextButton ref={ref} className={cx(className, cClassName)} {...rest}>{children}</ClassicTextButton>;
});

/** One choice of several, drawn as a pill under Classic and a GChip (aria-pressed) under the kit. */
export function PickPill({ on, onClick, disabled, title, children }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
  const g = useG();
  if (!g) return <ClassicPickPill on={on} onClick={onClick} disabled={disabled} title={title}>{children}</ClassicPickPill>;
  return <GChip pressed={on} onPressedChange={() => onClick()} disabled={disabled} disabledReason={title} title={title}>{children}</GChip>;
}

/* ── the Motion console and workflow builder (GP1 FR-GP1.6) ────────────── */

/**
 * What an octane control is, so the kit can draw it at the console's density:
 * `icon` round 34px, `icon-sm` round 28px, `pill` compact 28px, `primary` the one
 * ink action (Generate, Run), `link` an in-sentence action ("Retry"), and
 * `row` a list row or readout line that keeps its octane layout (tree rows,
 * readout lines, the stage HUD) with the kit's focus, disabled and data-g.
 */
export type OKind = 'icon' | 'icon-sm' | 'pill' | 'primary' | 'danger' | 'link' | 'row';

export type OBtnProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
  kind: OKind;
  /** The control's classes under Classic, exactly as the console always drew it. */
  cls?: string;
  /** Layout classes the kit keeps (positioning, grid rows); look classes stay Classic-only. */
  keep?: string;
  disabledReason?: string;
  busy?: boolean;
};

const O_KIT: Record<OKind, { variant: 'default' | 'ink' | 'danger' | 'icon'; size: 'md' | 'sm' | 'compact'; cls?: string }> = {
  icon: { variant: 'icon', size: 'md' },
  'icon-sm': { variant: 'icon', size: 'compact' },
  pill: { variant: 'default', size: 'compact' },
  primary: { variant: 'ink', size: 'md' },
  danger: { variant: 'danger', size: 'compact' },
  link: { variant: 'default', size: 'compact' },
  row: { variant: 'default', size: 'compact', cls: 'ce-g-orow' },
};

/** Every button in the Motion console and the builder: the octane button under Classic, a compact GButton under the kit. */
export const OBtn = forwardRef<HTMLButtonElement & HTMLAnchorElement, OBtnProps>(function OBtn({ kind, cls, keep, disabledReason, busy, type, ...rest }, ref) {
  const g = useG();
  if (!g) return <ClassicTextButton ref={ref} className={cls} type={type} {...rest} />;
  const k = O_KIT[kind];
  const { 'data-busy': _b, ...kit } = rest as typeof rest & { 'data-busy'?: unknown };
  return <GButton ref={ref} type={type} variant={k.variant} size={k.size} disabledReason={disabledReason} busy={busy} className={cx(k.cls, keep)} {...kit} />;
});

/** A link styled as an octane pill (open a delivered file): the octane anchor under Classic, a compact GButton under the kit. */
export function OLink({ cls, href, children, external = false }: { cls?: string; href: string; children: ReactNode; external?: boolean }) {
  const g = useG();
  if (g) return <GButton size="compact" href={href} external={external}>{children}</GButton>;
  return <ClassicOctaneLink cls={cls} href={href} external={external}>{children}</ClassicOctaneLink>;
}

/** A field in the console or builder: the octane `.ae-o-text` under Classic, a compact GInput / GTextarea under the kit. */
export const OInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> & { cls?: string; keep?: string }>(function OInput({ cls, keep, ...rest }, ref) {
  const g = useG();
  if (g) return <GInput ref={ref} size="compact" className={keep} {...rest} />;
  return <ClassicBareInput ref={ref} className={cls} {...rest} />;
});

export const OTextarea = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & { cls?: string; keep?: string }>(function OTextarea({ cls, keep, ...rest }, ref) {
  const g = useG();
  if (g) return <GTextarea ref={ref} className={cx('ce-g-otext', keep)} {...rest} />;
  return <ClassicBareTextarea ref={ref} className={cls} {...rest} />;
});

/** A native select in the console: octane classes under Classic, a compact GSelect under the kit. */
export const OSelect = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'> & { cls?: string; keep?: string }>(function OSelect({ cls, keep, ...rest }, ref) {
  const g = useG();
  if (g) return <GSelect ref={ref} size="compact" className={keep} {...rest} />;
  return <ClassicBareSelect ref={ref} className={cls} {...rest} />;
});

/** A small text link that saves a file: the caller's classes under Classic, a small GButton under the kit. */
export function DownloadLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const g = useG();
  if (g) return <GButton size="sm" href={href} download>{children}</GButton>;
  return <ClassicDownload href={href} className={className}>{children}</ClassicDownload>;
}

/** A nav-list pill (the dashboard's tool list): GPill, or .ae-pill. */
export const NavPill = forwardRef<HTMLButtonElement & HTMLAnchorElement, { icon?: ReactNode; label: ReactNode; badge?: ReactNode; active?: boolean; onClick?: () => void; title?: string; 'aria-haspopup'?: 'true' | 'dialog' | 'menu'; 'aria-expanded'?: boolean }>(function NavPill(props, ref) {
  const g = useG();
  if (g) return <GPill ref={ref} {...props} />;
  return <ClassicPill ref={ref} {...props} />;
});

/**
 * A chip. With `active` it is a filter or toggle (GChip, aria-pressed); without
 * it the chip is an action ("+3 more", a CTA to insert), which the kit draws
 * as a small GButton (§3.2, C3).
 */
export function Chip({ active, onClick, children, title, disabled = false, disabledReason }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string; disabled?: boolean; disabledReason?: string }) {
  const g = useG();
  if (!g) return <ClassicChip active={active ?? false} onClick={onClick} title={title} disabled={disabled}>{children}</ClassicChip>;
  if (active === undefined) return <GButton size="sm" onClick={onClick} title={title} disabled={disabled} disabledReason={disabledReason}>{children}</GButton>;
  return <GChip pressed={active} onPressedChange={() => onClick?.()} title={title} disabled={disabled} disabledReason={disabledReason}>{children}</GChip>;
}

/* ── fields ────────────────────────────────────────────────────────────── */

type Skinned = { className?: string; gClassName?: string; cClassName?: string };

/**
 * `bare`: an inline editor drawn by its caller (a script beat typed in place). Classic renders the
 * element with only the caller's classes; the kit renders its field with the chrome taken off
 * (.ce-g-bare), keeping its focus ring.
 */
type Bare = { bare?: boolean };

export const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> & Skinned & Bare & { size?: 'md' | 'lg' | 'compact' }>(function Input({ className, gClassName, cClassName, bare = false, ...rest }, ref) {
  const g = useG();
  if (g) return <GInput ref={ref} className={cx(bare && 'ce-g-bare', className, gClassName)} {...rest} />;
  if (bare) return <ClassicBareInput ref={ref} className={cx(className, cClassName)} {...rest} />;
  return <ClassicInput ref={ref} className={cx(className, cClassName)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & Skinned & Bare & { maxLines?: number }>(function Textarea({ className, gClassName, cClassName, maxLines, bare = false, ...rest }, ref) {
  const g = useG();
  if (g) return <GTextarea ref={ref} maxLines={maxLines} className={cx(bare && 'ce-g-bare', className, gClassName)} {...rest} />;
  if (bare) return <ClassicBareTextarea ref={ref} className={cx(className, cClassName)} {...rest} />;
  return <ClassicTextarea ref={ref} className={cx(className, cClassName)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'> & Skinned & { size?: 'md' | 'compact' }>(function Select({ className, gClassName, cClassName, size, ...rest }, ref) {
  const g = useG();
  if (g) return <GSelect ref={ref} size={size} className={cx(className, gClassName)} {...rest} />;
  return <ClassicSelect ref={ref} className={cx(className, cClassName)} {...rest} />;
});

/** The angle card's round check. Display state: the card around it is the control. */
export function CheckMark({ on, children, className }: { on: boolean; children?: ReactNode; className?: string }) {
  const g = useG();
  if (!g) return <ClassicCheckMark on={on} className={className}>{children}</ClassicCheckMark>;
  return <span className={cx('ce-g-checkmark', className)} data-on={on || undefined} aria-hidden>{children}</span>;
}

/** A real round check control (GCheck under the kit). */
export function Check({ checked, onCheckedChange, label, disabled, disabledReason }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean; disabledReason?: string }) {
  return <GCheck checked={checked} onCheckedChange={onCheckedChange} aria-label={label} disabled={disabled} disabledReason={disabledReason} />;
}

/* ── tabs and menus ────────────────────────────────────────────────────── */

export function TitleTabs<T extends string>({ tabs, value, onChange, label, panelId }: { tabs: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; panelId: string }) {
  const g = useG();
  if (!g) return <ClassicTitleTabs tabs={tabs} value={value} onChange={onChange} label={label} panelId={panelId} />;
  return <GTabs tabs={tabs.map((t) => ({ value: t.value, label: t.label, controls: panelId }))} value={value} onChange={(v) => onChange(v as T)} label={label} />;
}

export type MenuItem = ClassicMenuItem;

/** A "…" actions menu on an icon button: GMenu, or the engine's .ae-pop menu. */
export function ActionsMenu({ items, label, triggerIcon }: { items: readonly MenuItem[]; label: string; triggerIcon: ReactNode }) {
  const g = useG();
  if (!g) return <ClassicActionsMenu items={items} label={label} triggerIcon={triggerIcon} />;
  return (
    <GMenu
      label={label}
      align="start"
      items={items.map((it) => ({ id: it.id, label: it.label, icon: it.icon, danger: it.danger, onSelect: it.onSelect }))}
      trigger={(p) => <GButton variant="icon" size="sm" aria-label={label} title={label} {...p}>{triggerIcon}</GButton>}
    />
  );
}

/** The span a Classic popover hangs from; under the kit a plain layout span (GPopover and GMenu anchor themselves). */
export function PopAnchor({ children, className }: { children: ReactNode; className?: string }) {
  const g = useG();
  if (!g) return <ClassicPopAnchor className={className}>{children}</ClassicPopAnchor>;
  return <span className={cx('relative', className)}>{children}</span>;
}

/* ── setup ─────────────────────────────────────────────────────────────── */

/**
 * The one Set up affordance (CLAUDE.md honest-or-absent): the shared SetupLink
 * under Classic, a small kit button to the same destination under GladOS.
 */
export function SetupLink({ href, hint, label = 'Set up', className }: { href?: string; hint?: string; label?: string; className?: string }) {
  const g = useG();
  if (!g) return <ClassicSetupLink href={href} hint={hint} label={label} className={className} />;
  return (
    <GButton size="sm" href={href ?? '/integrations'} title={hint} className={className}>
      {label} <span aria-hidden>›</span>
    </GButton>
  );
}
