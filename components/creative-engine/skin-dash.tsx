'use client';

import type { ReactNode } from 'react';
import { GBadge, GButton, GCardRaised, GDialog, GDotCloud, GDotNumber, GDrawer, GDriverBars, GEmpty, GEyebrow, GRuler, GSelect, GSheet, GStat, GTag, DOT_CLOUD_CAP, type DotSize, type GTagTone } from '@/components/g';
import { cx } from '@/components/g/cx';
import { DotNumeral, DriverBars, Empty as ClassicEmpty, Select as ClassicOptionSelect, TickGauge } from '@/components/creative-engine/primitives';
import { useG } from '@/components/creative-engine/skin';
import {
  ClassicBadge, ClassicCardButton, ClassicConfirmDelete, ClassicDotCloud, ClassicDrawer, ClassicOverlayButton, ClassicRuler, ClassicSheet, ClassicStat, ClassicTag,
} from '@/components/creative-engine/classic';

/**
 * The dashboard's shared pieces on one call each (glados-ui SPEC GP1 FR-GP1.2):
 * DotNumeral → GDotNumber, Stat → GStat, Ruler → GRuler, DotCloud → GDotCloud,
 * the paper Sheet and Drawer → GSheet and GDrawer, the confirm → GDialog. The
 * Classic skin renders the engine's original markup (classic.tsx).
 */

/** Dot numerals. `onHero` paints them in the hero ink. */
export function Numeral({ value, size, onHero = false }: { value: string; size: 3 | 4 | 5 | 6 | 7; onHero?: boolean }) {
  const g = useG();
  if (!g) return <DotNumeral value={value} size={size} color={onHero ? 'var(--p-on-hero)' : undefined} />;
  return <GDotNumber value={value} size={size as DotSize} tone={onHero ? 'on-hero' : 'ink'} label={value === '—' ? 'Not applicable' : value} />;
}

/** A tick gauge for one value on its scale. */
export function Gauge({ value, max, label, tone, onHero = false }: { value: number | null; max: number; label: string; tone?: 'warn' | 'over'; onHero?: boolean }) {
  const g = useG();
  if (!g) return <ClassicRuler pct={value === null || max <= 0 ? 0 : value / max} dark={!onHero} label={label} tone={tone} />;
  return <GRuler value={value} max={max} label={label} tone={tone} onHero={onHero} ticks={40} />;
}

/** The angle and brief proof gauge: median days live on a 0 to 90 day scale. */
export function ProofGauge({ value, max = 90, ticks = 30, label }: { value: number | null; max?: number; ticks?: number; label?: string }) {
  const g = useG();
  if (!g) return <TickGauge value={value} max={max} ticks={ticks} label={label} />;
  return (
    <div className="w-full">
      <GRuler value={value} max={max} ticks={ticks} label={value === null ? 'No proof ads' : `Median ${value} days live on a 0 to ${max} day scale`} />
      {label && <div className="ae-faint mt-1">{label}</div>}
    </div>
  );
}

/** What drives an ad or an angle: label · bar · score (out of 10), the first `top` rows full ink. */
export function Drivers({ drivers, top = 3, max = 10 }: { drivers: Record<string, number>; top?: number; max?: number }) {
  const g = useG();
  if (!g) return <DriverBars drivers={drivers} top={top} max={max} />;
  const rows = Object.entries(drivers).sort((a, b) => b[1] - a[1]).slice(0, Math.max(top, 5)).map(([k, v]) => ({ id: k, label: k, value: Math.min(v, max), display: String(v), title: `${k}: ${v} of ${max}` }));
  return <GDriverBars rows={rows} max={max} top={top} emptyText="No driver data" label="Drivers, scored out of 10" />;
}

/** An empty state; `action` is the one button that opens the step it names (S04 B34). */
export function Empty({ line1, line2, action }: { line1: string; line2: string; action?: { label: string; onClick: () => void } }) {
  const g = useG();
  if (!g) return <ClassicEmpty line1={line1} line2={line2} action={action} />;
  return <GEmpty title={line1} body={line2} action={action ? { label: action.label, onClick: () => action.onClick() } : undefined} />;
}

/** A small fixed-options select. */
export function OptionSelect<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  const g = useG();
  if (!g) return <ClassicOptionSelect value={value} options={options} onChange={onChange} />;
  return <GSelect value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T)} options={options} />;
}

/** One dot per item, lit first (capped at 192). Zero items render nothing. */
export function Cloud({ total, lit, label, onHero = false }: { total: number; lit: number; label: string; onHero?: boolean }) {
  const g = useG();
  const n = Math.min(DOT_CLOUD_CAP, total);
  if (n === 0) return null;
  if (!g) return <ClassicDotCloud n={n} lit={Math.min(n, lit)} label={total > DOT_CLOUD_CAP ? `${label} (first ${DOT_CLOUD_CAP} shown)` : label} />;
  return <GDotCloud total={total} lit={lit} label={label} onHero={onHero} />;
}

/** A whole card that opens something: GCardRaised, or the paper .ae-card-2 button. */
export function CardButton({ onClick, className, gClassName, cClassName, title, p = 16, children }: { onClick: () => void; className?: string; gClassName?: string; cClassName?: string; title?: string; p?: 16 | 20 | 24; children: ReactNode }) {
  const g = useG();
  if (!g) return <ClassicCardButton onClick={onClick} className={cx('ae-card-2', className, cClassName)} title={title}>{children}</ClassicCardButton>;
  return <GCardRaised onClick={() => onClick()} p={p} title={title} className={cx(className, gClassName)}>{children}</GCardRaised>;
}

/** The invisible whole-card button under a card that also holds its own control. */
export function OverlayButton({ label, onClick }: { label: string; onClick: () => void }) {
  const g = useG();
  if (!g) return <ClassicOverlayButton label={label} onClick={onClick} />;
  return <GButton aria-label={label} title={label} onClick={onClick} className="ce-g-overlay" />;
}

/** The one headline badge per group. */
export function Badge({ children, className, ...data }: { children: ReactNode; className?: string; 'data-status'?: string; 'data-state'?: string; 'data-sample-badge'?: boolean }) {
  const g = useG();
  if (!g) return <ClassicBadge className={className} {...data}>{children}</ClassicBadge>;
  return <span className={cx('inline-flex', className)} {...data}><GBadge>{children}</GBadge></span>;
}

/** A small status or count label. */
export function Tag({ children, className, tone, ...data }: { children: ReactNode; className?: string; tone?: GTagTone; 'data-dry-tag'?: boolean; 'data-state'?: string }) {
  const g = useG();
  if (!g) return <ClassicTag className={className} {...data}>{children}</ClassicTag>;
  return <span className={cx('inline-flex', className)} {...data}><GTag tone={tone}>{children}</GTag></span>;
}

/** The small sentence-case label above data (Classic drew it uppercase and letterspaced; §3.3.7 retires that under the kit). */
export function Eyebrow({ children, className, cClassName }: { children: ReactNode; className?: string; cClassName?: string }) {
  const g = useG();
  if (!g) return <div className={cx('ae-cap', className, cClassName)}>{children}</div>;
  return <div className={className}><GEyebrow>{children}</GEyebrow></div>;
}

/**
 * The centred sheet every tool opens in. Under the kit it is a GSheet in a
 * portal, so the body gets its own .ae-paper scope (the --p-* aliases, GP1.1).
 * A sheet opened from the Motion console says so and its close goes back there.
 */
export function EngineSheet({ title, onClose, backLabel, children }: { title: string; onClose: () => void; backLabel?: string; children: ReactNode }) {
  const g = useG();
  if (!g) return <ClassicSheet title={title} onClose={onClose} backLabel={backLabel}>{children}</ClassicSheet>;
  return (
    <GSheet open onClose={onClose} title={title} caption={backLabel ? <GButton size="sm" onClick={onClose} title={`${backLabel} (Esc)`}>‹ {backLabel}</GButton> : undefined} className="ce-g-sheet">
      <div className="ae-paper ce-g-paper min-h-[60vh]">{children}</div>
    </GSheet>
  );
}

/** The right drawer (Runs, Proof library, Credits, Connect Arcads, an ad's detail). */
export function EngineDrawer({ title, onClose, children, back }: { title: string; onClose: () => void; children: ReactNode; back?: { label: string; onClick: () => void } }) {
  const g = useG();
  if (!g) return <ClassicDrawer title={title} onClose={onClose} back={back}>{children}</ClassicDrawer>;
  return (
    <GDrawer open onClose={onClose} title={title} width={520} onBack={back?.onClick} backLabel={back?.label}>
      <div className="ae-paper ce-g-paper">{children}</div>
    </GDrawer>
  );
}

/** A destructive confirm: Cancel has focus, Escape cancels unless the delete is in flight. */
export function ConfirmDelete({ title, body, error, busy, onCancel, onConfirm }: { title: ReactNode; body: ReactNode; error: string | null; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const g = useG();
  if (!g) return <ClassicConfirmDelete title={title} body={body} error={error} busy={busy} onCancel={onCancel} onConfirm={onConfirm} />;
  return (
    <GDialog open onClose={onCancel} title={title} tone="danger" confirmLabel={busy ? 'Deleting' : 'Delete'} onConfirm={onConfirm} busy={busy}>
      <p>{body}</p>
      {error && <p role="alert" className="mt-3 text-[12.5px] text-[var(--g-err)]">{error}</p>}
    </GDialog>
  );
}

/**
 * One stat (S07 F1 to F5): a button that opens where its number lives. Classic
 * draws the numeral at two sizes and its container query shows one; the kit's
 * GStat applies the C6 dots-or-text rule. Unconfigured reads `—`, never 0.
 */
export function Stat({ value, badge, lime = false, tip, unconfigured = false, missing, onOpen }: { value: number; badge: string; lime?: boolean; tip: string; unconfigured?: boolean; missing?: string; onOpen: () => void }) {
  const g = useG();
  const title = unconfigured ? 'Research needs the Foreplay key' : tip;
  const text = value.toLocaleString('en-US');
  if (!g) return <ClassicStat lg={<DotNumeral value={text} size={4} />} sm={<DotNumeral value={text} size={3} />} badge={badge} lime={lime} title={title} ariaLabel={`${text} ${badge}. ${title}`} empty={value === 0} onClick={onOpen} />;
  return <GStat value={text} label={badge} badge={lime} source={tip} state={unconfigured ? 'unconfigured' : 'ready'} missing={missing} onClick={onOpen} />;
}
