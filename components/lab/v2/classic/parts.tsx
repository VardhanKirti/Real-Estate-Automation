'use client';
/**
 * Small Classic-tree building blocks shared by the six pages and the sheets. Colours come only from the
 * --lab-* tokens through the .lab2c-* classes in app/globals.css; no literal colour and no English text.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SetupLink } from '@/components/SetupLink';
import { Glass, type GlassPriority, type GlassTone } from '@/components/lab/v2/shared';
import type { SectionState } from '@/lib/lab/view/shared';
import { r2 } from './geom';

/** A section-state line (01 5.2): the sentence for empty / not_built / needs_key / off / error, above the content for thin. */
export function StateLine({ state, compact }: { state: SectionState; compact?: boolean }) {
  if (state.kind === 'ready' || !state.message) return null;
  const setup = state.kind === 'needs_key' || state.kind === 'off';
  return (
    <div className="lab2c-state" data-kind={state.kind} data-compact={compact ? '' : undefined}>
      <p className="lab2c-state-text" data-lab-ink="">{state.message}</p>
      {state.action &&
        (setup ? (
          <SetupLink href={state.action.href} label={state.action.label} className="lab2-setup" />
        ) : (
          <Link href={state.action.href} className="lab2-pill lab2-seeall" data-lab-ink="" scroll={false}>
            {state.action.label}
          </Link>
        ))}
    </div>
  );
}

/** True when a section's body should render (ready or thin). */
export const shows = (s: SectionState) => s.kind === 'ready' || s.kind === 'thin';

/** A titled glass panel. */
export function Panel({
  id, title, desc, tools, children, tone = 'strong', priority = 3, className, as = 'section', ...rest
}: {
  id?: string; title?: ReactNode; desc?: ReactNode; tools?: ReactNode; children?: ReactNode; tone?: GlassTone; priority?: GlassPriority; className?: string; as?: 'section' | 'div' | 'article';
} & { [k: `data-${string}`]: string | undefined }) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <Glass as={as} tone={tone} radius="tile" priority={priority} className={['lab2c-panel', className].filter(Boolean).join(' ')} aria-labelledby={title ? hid : undefined} id={id} {...rest}>
      {(title || tools) && (
        <header className="lab2c-panel-head">
          <span className="lab2c-panel-titles">
            {title && <h2 id={hid} className="lab2c-panel-title" data-lab-ink="">{title}</h2>}
            {desc && <span className="lab2c-panel-desc" data-lab-ink="">{desc}</span>}
          </span>
          {tools && <span className="lab2c-panel-tools">{tools}</span>}
        </header>
      )}
      {children}
    </Glass>
  );
}

/** Page heading row under the frame: the page's own controls (filters, primary actions). */
export function PageBar({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="lab2c-bar" role={label ? 'toolbar' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

/** A chip-style filter link (replace + re-render, D3). */
export function FilterChip({ href, active, children, disabled, title }: { href: string; active: boolean; children: ReactNode; disabled?: boolean; title?: string }) {
  if (disabled) {
    return (
      <span className="lab2c-fchip" aria-disabled="true" title={title} data-lab-ink="">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} replace scroll={false} className="lab2c-fchip" aria-current={active ? 'true' : undefined} data-lab-ink="">
      {children}
    </Link>
  );
}

export function Tag({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'err' | 'quiet' | 'strong' }) {
  return (
    <span className="lab2c-tag" data-tone={tone}>
      {/* ink on the text box, inside the pill's straight run: the pill's rounded ends are not its ground */}
      <span data-lab-ink="">{children}</span>
    </span>
  );
}

/** Key value pair on strong glass. */
export function KV({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="lab2c-kv">
      <dt className="lab2c-kv-k" data-lab-ink="">{k}</dt>
      {/* a value that is a chip or a link carries its own ink marker; the dd marks plain text only */}
      <dd className="lab2c-kv-v" data-lab-ink={typeof v === 'string' || typeof v === 'number' ? '' : undefined}>{v}</dd>
    </div>
  );
}

/** A big numeral with an optional superscript unit, the way heroes and tiles draw units (02 2.5). */
export function Num({ text, unit, unitFirst, size = 'm' }: { text: string; unit?: string | null; unitFirst?: boolean; size?: 's' | 'm' | 'l' }) {
  return (
    <span className="lab2c-num" data-size={size} data-lab-ink="">
      {unit && unitFirst && <sup className="lab2c-num-unit" data-first="">{unit}</sup>}
      {text}
      {unit && !unitFirst && <sup className="lab2c-num-unit">{unit}</sup>}
    </span>
  );
}

/** A 2px interval bar: the point, the 90% range, a 1x reference tick. Domain is log-ish (0 to scaleMax). */
export function IntervalBar({ lo, hi, point, scaleMax = 10, struck }: { lo: number | null; hi: number | null; point: number | null; scaleMax?: number; struck?: boolean }) {
  const x = (v: number) => r2(Math.max(0, Math.min(100, (Math.log10(Math.max(v, 0.1)) + 1) / (Math.log10(scaleMax) + 1) * 100)));
  return (
    <span className="lab2c-ibar" data-struck={struck ? '' : undefined} aria-hidden="true">
      <span className="lab2c-ibar-track" />
      <span className="lab2c-ibar-one" style={{ left: `${x(1)}%` }} />
      {lo !== null && hi !== null && <span className="lab2c-ibar-range" data-lab-mark="" style={{ left: `${x(lo)}%`, width: `${r2(Math.max(1, x(hi) - x(lo)))}%` }} />}
      {point !== null && <span className="lab2c-ibar-pt" data-lab-mark="" style={{ left: `${x(point)}%` }} />}
    </span>
  );
}
