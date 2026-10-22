/**
 * Terminal-direction primitives shared across screens.
 * Server-component friendly: no state, no handlers.
 */

export type DotState = 'ok' | 'warn' | 'err' | 'off';

const DOT_FOR: Record<string, DotState> = {
  connected: 'ok',
  active: 'ok',
  ok: 'ok',
  available: 'warn',
  warn: 'warn',
  training: 'warn',
  idle: 'warn',
  error: 'err',
  fail: 'err',
  not_configured: 'off',
  planned: 'off',
  off: 'off',
};

export function dotState(state: string): DotState {
  return DOT_FOR[state] ?? 'off';
}

export function Dot({ state, pulse = false }: { state: string; pulse?: boolean }) {
  const cls = dotState(state);
  return <span className={`dot ${cls}${pulse && cls === 'ok' ? ' pulse' : ''}`} />;
}

export type BadgeTone = 'default' | 'accent' | 'ok' | 'warn' | 'err';

const BADGE_TONE: Record<BadgeTone, string> = {
  default: 'border-os-border-strong text-os-muted',
  accent: 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-os-accent',
  ok: 'border-[color-mix(in_oklab,var(--ok)_35%,transparent)] bg-[color-mix(in_oklab,var(--ok)_9%,transparent)] text-os-ok',
  // warn text rides --warn-text: amber on Console, plain text under Red (no yellow text there)
  warn: 'border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--warn)_9%,transparent)] text-[var(--warn-text)]',
  err: 'border-[color-mix(in_oklab,var(--err)_35%,transparent)] bg-[color-mix(in_oklab,var(--err)_9%,transparent)] text-os-err',
};

export function Badge({
  tone = 'default',
  ghost = false,
  children,
}: {
  tone?: BadgeTone;
  ghost?: boolean;
  children: React.ReactNode;
}) {
  // Console badge: sentence case, chip recipe — no uppercase micro-tracking.
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[6px] border px-2 py-[3px] text-[11.5px] ${BADGE_TONE[tone]} ${
        ghost ? 'border-dashed' : ''
      }`}
    >
      {children}
    </span>
  );
}

/** Console section label: sentence case, quiet weight, optional hairline rule. */
export function Label({
  children,
  count,
  rule = false,
}: {
  children: React.ReactNode;
  count?: string | number;
  rule?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] font-medium text-os-muted">
      <span className="whitespace-nowrap">{children}</span>
      {count != null && <span className="c-chip">{count}</span>}
      {rule && <span className="h-px flex-1 bg-[var(--hairline)]" />}
    </div>
  );
}

export function SectionHead({
  label,
  count,
  link,
  href,
}: {
  label: string;
  count?: string | number;
  link?: string;
  href?: string;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Label count={count} rule>
          {label}
        </Label>
      </div>
      {link && href && (
        <a href={href} className="shrink-0 text-[12.5px] text-os-dim transition-colors hover:text-os-text">
          {link} →
        </a>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[6px] border border-os-border-strong border-b-2 bg-os-surface2 px-1.5 py-0.5 font-mono text-[11.5px] text-os-muted">
      {children}
    </kbd>
  );
}

/** Accent sparkline with a 10%-opacity fill. */
export function Spark({ data, w = 72, h = 22 }: { data: number[]; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map(
    (v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 5)).toFixed(1)}`,
  );
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="var(--accent)" opacity="0.1" />
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
    </svg>
  );
}
