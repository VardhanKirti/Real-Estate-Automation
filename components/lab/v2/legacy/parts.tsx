'use client';
/**
 * Content Lab, Bennett Legacy tree: the small parts every page and sheet shares. Built on the Legacy kit
 * (components/legacy) and the --l-* tokens; every element carries data-l. No literal colour, no English
 * literal (strings arrive from the views, CLASSIC_COPY or ./copy).
 */
import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Badge, Chip, type Tone } from '@/components/legacy';
import type { SectionState } from '@/lib/lab/view/shared';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { r2 } from '../classic/geom';

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

/** True when a section's body should render (ready or thin). */
export const shows = (s: SectionState) => s.kind === 'ready' || s.kind === 'thin';

/** Appends ?sample=1 (or &sample=1) to a Lab href when the page is the sample world. */
export function withSample(href: string, sample: boolean): string {
  if (!sample || href.startsWith('?') || href.startsWith('#') || href.includes('sample=1')) return href;
  return href + (href.includes('?') ? '&' : '?') + 'sample=1';
}

/** The Set up link in place of data (pages/README "Not configured"): a Legacy pill, routed to the fix. */
export function LabSetupLink({ href, label = C.setUp }: { href: string; label?: string }) {
  return (
    <Link data-l="SetupLink" href={href} scroll={false} className="l-pressable is-dark l-pill l-setup-link" data-lens="c">
      {label} <span aria-hidden>›</span>
    </Link>
  );
}

/**
 * A section's honest state (01 5.2) as an FO empty line in --l-text-2: the sentence for empty, not built,
 * needs a key, off or error, above the content for thin. Not configured adds the err chip and Set up.
 */
export function LState({ state, compact }: { state: SectionState; compact?: boolean }) {
  if (state.kind === 'ready' || !state.message) return null;
  const setup = state.kind === 'needs_key' || state.kind === 'off';
  return (
    <div data-l="LabState" data-kind={state.kind} className={cx('l-lab-state', compact && 'is-compact')}>
      {setup && <Chip tone="err">{C.setupSheet.keyState.not_configured}</Chip>}
      {state.kind === 'error' && <Badge tone="err">{C.retry}</Badge>}
      <p className="l-lab-state-text">{state.message}</p>
      {state.action &&
        (setup ? (
          <LabSetupLink href={state.action.href} label={state.action.label} />
        ) : state.action.href === '#run' ? (
          <Btn onClick={() => window.dispatchEvent(new CustomEvent('lab:run'))}>{state.action.label}</Btn>
        ) : (
          <Btn href={state.action.href}>{state.action.label}</Btn>
        ))}
    </div>
  );
}

type BtnProps = {
  children?: ReactNode;
  primary?: boolean;
  href?: string;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
  replace?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children' | 'disabled'> & { [k: `data-${string}`]: string | undefined };

/**
 * The Lab's one button (Legacy Pressable): mono 10.5/600, primary is the white fill. Disabled keeps its
 * label and says why through `title` (aria-disabled, so the reason stays readable on hover and focus).
 */
export function Btn({ children, primary, href, busy, disabled, className, replace, type = 'button', onClick, ...rest }: BtnProps) {
  const cls = cx('l-pressable l-btn', primary ? 'is-primary' : 'is-dark', className);
  if (href && !disabled) {
    return (
      <Link href={href} replace={replace} scroll={false} data-l="Pressable" data-lens="c" className={cls} title={rest.title} aria-label={rest['aria-label']} data-lab-shared={rest['data-lab-shared']}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type={type}
      data-l="Pressable"
      data-lens="c"
      className={cls}
      aria-disabled={disabled ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      onClick={disabled ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {busy && <span className="l-lab-busy" aria-hidden />}
      {children}
    </button>
  );
}

/** A filter chip that is a link (filters replace the URL and re-render, D3). Solid when on. */
export function FilterChip({ href, active, children, disabled, title, count }: { href: string; active: boolean; children: ReactNode; disabled?: boolean; title?: string; count?: number }) {
  const body = (
    <>
      {children}
      {count !== undefined && <span className="l-lab-chip-n">{count}</span>}
    </>
  );
  if (disabled) {
    return (
      <span data-l="ToggleChip" data-on="false" className="l-pressable l-toggle-chip is-dark l-lab-fchip" aria-disabled="true" title={title}>
        {body}
      </span>
    );
  }
  return (
    <Link href={href} replace scroll={false} data-l="ToggleChip" data-lens="c" data-on={active ? 'true' : 'false'} aria-current={active ? 'true' : undefined} className={cx('l-pressable l-toggle-chip l-lab-fchip', !active && 'is-dark')}>
      {body}
    </Link>
  );
}

/** A chip button (radio and toggle groups inside sheets and forms). */
export function ChipButton({ on, children, onClick, disabled, title, role, ...rest }: { on: boolean; children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string; role?: string } & { [k: `aria-${string}`]: string | boolean | undefined }) {
  return (
    <button
      type="button"
      data-l="ToggleChip"
      data-lens="c"
      data-on={on ? 'true' : 'false'}
      role={role}
      aria-pressed={role ? undefined : on}
      aria-checked={role === 'radio' ? on : undefined}
      aria-disabled={disabled ? 'true' : undefined}
      title={title}
      className={cx('l-pressable l-toggle-chip l-lab-fchip', !on && 'is-dark')}
      onClick={disabled ? undefined : onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A status chip with its LED: strong (on), quiet, or a warning tone. */
export function Tag({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'err' | 'quiet' | 'strong' }) {
  const led: Tone | undefined = tone === 'ok' || tone === 'warn' || tone === 'err' ? tone : tone === 'strong' ? 'accent' : undefined;
  return (
    <Chip tone={led} className={cx('l-lab-tag', tone === 'strong' && 'is-strong', tone === 'quiet' && 'is-quiet')}>
      {children}
    </Chip>
  );
}

/** Mono section label inside a card: `LABEL` and a hairline rule. */
export function Rule({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div data-l="Label" className="l-lab-rule">
      <span className="l-lab-rule-text">{children}</span>
      <span aria-hidden className="l-label-rule" />
      {aside}
    </div>
  );
}

/** A key and value row. */
export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div data-l="KV" className="l-lab-kv">
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** A big mono numeral with an optional superscript unit. */
export function Num({ text, unit, size = 'm' }: { text: string; unit?: string | null; size?: 's' | 'm' | 'l' }) {
  return (
    <span data-l="Num" className="l-lab-num" data-size={size}>
      {text}
      {unit && <sup>{unit}</sup>}
    </span>
  );
}

/**
 * The 90% interval in Monolith ink: a hairline track, the range as a solid bar, the point as a square
 * marker, a 1x tick. Domain is log-ish from 0.1 to scaleMax.
 */
export function IntervalBar({ lo, hi, point, scaleMax = 10, struck }: { lo: number | null; hi: number | null; point: number | null; scaleMax?: number; struck?: boolean }) {
  const x = (v: number) => r2(Math.max(0, Math.min(100, ((Math.log10(Math.max(v, 0.1)) + 1) / (Math.log10(scaleMax) + 1)) * 100)));
  return (
    <span data-l="IntervalBar" className="l-lab-ibar" data-struck={struck ? '' : undefined} aria-hidden="true">
      <span className="l-lab-ibar-track" />
      <span className="l-lab-ibar-one" style={{ left: `${x(1)}%` }} />
      {lo !== null && hi !== null && <span className="l-lab-ibar-range" style={{ left: `${x(lo)}%`, width: `${r2(Math.max(1, x(hi) - x(lo)))}%` }} />}
      {point !== null && <span className="l-lab-ibar-pt" style={{ left: `${x(point)}%` }} />}
    </span>
  );
}

/** A card on the slab (SlabCard look) that can be a section with an id and its own head. */
export function Card({
  id, title, sub, tools, children, className, i = 1, as: As = 'section', flush,
}: {
  id?: string; title?: ReactNode; sub?: ReactNode; tools?: ReactNode; children?: ReactNode; className?: string; i?: number; as?: 'section' | 'div' | 'article'; flush?: boolean;
}) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <As data-l="SlabCard" id={id} className={cx('l-rise l-rise-card l-card l-lab-card', className)} style={{ ['--l-rise-i' as string]: i }} aria-labelledby={title ? hid : undefined}>
      {(title || tools) && (
        <div className="l-card-head">
          <div className="l-card-title-row">
            {title && <h2 id={hid} className="l-card-title">{title}</h2>}
            {sub && <span className="l-card-sub">{sub}</span>}
          </div>
          {tools && <div className="l-card-actions">{tools}</div>}
        </div>
      )}
      <div className={flush ? 'l-lab-card-flush' : 'l-card-body'}>{children}</div>
    </As>
  );
}
