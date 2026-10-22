import type { CSSProperties, ReactNode } from 'react';
import { Lightbulb } from 'lucide-react';
import { CountUp } from './CountUp';
import { cx, insightTicks, isKnown, type CountKind } from './format';

/**
 * Bennett Legacy surfaces (FounderOS kit Slab, SlabTitle, SlabCard,
 * InsightCard). Colours come only from --l-* tokens (app/globals.css, L0
 * block); every element carries data-l="<Name>".
 */

const rise = (i: number): CSSProperties => ({ ['--l-rise-i' as string]: i });

/** The floating surface a page sits on: 28px corners, hairline, a soft drop (FO v1 .os-slab). */
export function Slab({ className, children, style }: { className?: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <div data-l="Slab" className={cx('l-slab', className)} style={style}>
      {children}
    </div>
  );
}

/** `// EYEBROW`, the 44/700 title, a mono meta line and the right-hand actions. */
export function SlabTitle({ eyebrow, title, meta, right }: { eyebrow?: string; title: string; meta?: ReactNode; right?: ReactNode }) {
  return (
    <div data-l="SlabTitle" className="l-rise l-slab-title" style={rise(0)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="l-eyebrow" data-l-part="eyebrow" title={`// ${eyebrow}`}>
            {`// ${eyebrow}`}
          </div>
        )}
        <h1 className="l-h1">{title}</h1>
        {meta && <div className="l-meta">{meta}</div>}
      </div>
      {right && <div className="l-slab-title-right">{right}</div>}
    </div>
  );
}

/** Inset card: rises on the stagger, lifts 1px on hover. Title 19/600, a mono caption beside it. */
export function SlabCard({
  title,
  sub,
  action,
  i = 1,
  className,
  children,
}: {
  title?: string;
  sub?: ReactNode;
  action?: ReactNode;
  i?: number;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section data-l="SlabCard" className={cx('l-rise l-rise-card l-card', className)} style={rise(i)}>
      {title && (
        <div className="l-card-head">
          <div className="l-card-title-row">
            <h2 className="l-card-title">{title}</h2>
            {sub && <span className="l-card-sub">{sub}</span>}
          </div>
          {action && <div className="l-card-actions">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

/**
 * The ONE loud card a page may carry: a metallic glow, grain, a glass shard,
 * a big number, eight progress ticks. Unknown reads "unknown".
 */
export function InsightCard({
  badge,
  icon,
  value,
  kind = 'int',
  display,
  headline,
  body,
  frac = 0,
  i = 5,
  compact = false,
  className,
}: {
  badge: string;
  icon?: ReactNode;
  value?: number | null;
  kind?: CountKind;
  display?: string;
  headline: ReactNode;
  body?: ReactNode;
  frac?: number | null;
  i?: number;
  compact?: boolean;
  className?: string;
}) {
  const lit = insightTicks(frac);
  return (
    <div data-l="InsightCard" className={cx('l-rise l-rise-card l-insight', compact && 'is-compact', className)} style={rise(i)}>
      <div aria-hidden className="l-insight-grain" style={{ backgroundImage: GRAIN }} />
      <div aria-hidden className="l-insight-shard" />
      <div className="l-insight-inner">
        <div className={compact ? 'l-insight-top' : 'contents'}>
          <span className="l-insight-pill">
            {icon ?? <Lightbulb size={13} strokeWidth={1.7} aria-hidden />}
            {badge}
          </span>
          <div className="l-insight-value">
            {display != null ? display : isKnown(value) ? <CountUp value={value} kind={kind} /> : <span data-unknown>unknown</span>}
          </div>
        </div>
        <div className="l-insight-headline">{headline}</div>
        {body && <div className="l-insight-body">{body}</div>}
        <div className="l-insight-ticks" aria-hidden>
          {Array.from({ length: 8 }, (_, t) => (
            <span key={t} data-tick={t < lit ? 'on' : 'off'} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Mono section label: `LABEL  count ————`. */
export function Label({ count, rule = false, children }: { count?: ReactNode; rule?: boolean; children?: ReactNode }) {
  return (
    <div data-l="Label" className="l-label">
      <span className="whitespace-nowrap">{children}</span>
      {count != null && <span className="l-label-count">{count}</span>}
      {rule && <span aria-hidden className="l-label-rule" />}
    </div>
  );
}
