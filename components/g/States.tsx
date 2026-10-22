import type { MouseEventHandler, ReactNode } from 'react';
import { cx } from './cx';
import { GBadge, GButton, GTag } from './Controls';

/**
 * States (SPEC S00 §5.3, §3.1.4): every widget defines populated, empty,
 * loading, error and unconfigured. Unconfigured always routes to the fix
 * (house rule: honest or absent, a Set up link from setupHrefFor).
 */

type EmptyAction = { label: string; href?: string; onClick?: MouseEventHandler<HTMLButtonElement> };

type EmptyBase = {
  /** 15/300 ink line: what is missing. */
  title: ReactNode;
  /** 11.5 muted line: why, or what fills it. */
  body?: ReactNode;
  /** Compact form for a table cell or a small card. */
  inline?: boolean;
  className?: string;
};

export type GEmptyProps = EmptyBase &
  (
    | { kind?: 'empty'; /** At most one ink button that opens the named step. */ action?: EmptyAction }
    | {
        kind: 'unconfigured';
        /** Where the fix lives: `setupHrefFor(connectorId)` or `/setup`. */
        setupHref: string;
        /** The raw diagnostic ("set ZERNIO_API_KEY"), kept in the hover title. */
        setupHint?: string;
      }
    | { kind: 'error'; onRetry?: () => void; retryBusy?: boolean }
  );

export function GEmpty(props: GEmptyProps) {
  const { title, body, inline = false, className } = props;
  const kind = props.kind ?? 'empty';
  return (
    <div data-g="GEmpty" data-kind={kind} data-inline={inline || undefined} className={cx('g-empty', className)} role={kind === 'error' ? 'alert' : undefined}>
      {kind === 'unconfigured' && (
        <GTag tone="outline" size="xs">
          Not configured
        </GTag>
      )}
      <p className="g-empty-title">{title}</p>
      {body != null && <p className="g-empty-body">{body}</p>}
      {props.kind === 'unconfigured' && (
        <GButton variant="sm" href={props.setupHref} title={props.setupHint}>
          Set up
        </GButton>
      )}
      {props.kind === 'error' && props.onRetry && (
        <GButton variant="sm" onClick={props.onRetry} busy={props.retryBusy}>
          Retry
        </GButton>
      )}
      {(props.kind === undefined || props.kind === 'empty') && props.action && (
        <GButton variant="ink" href={props.action.href} onClick={props.action.onClick}>
          {props.action.label}
        </GButton>
      )}
    </div>
  );
}

/** Busy: a pulsing 8px ink dot and a muted line (pulse off under reduced motion). */
export function GProgress({ text, className }: { text: ReactNode; className?: string }) {
  return (
    <div data-g="GProgress" className={cx('g-progress', className)} role="status">
      <span className="g-progress-dot" aria-hidden />
      <span>{text}</span>
    </div>
  );
}

export type GSkeletonProps = {
  /** CSS length; default 100%. */
  width?: number | string;
  /** CSS length; default one text line. */
  height?: number | string;
  /** Radius token: card 28, nested 20, well 14, input 12, pill, line (6). */
  shape?: 'card' | 'nested' | 'well' | 'input' | 'pill' | 'line';
  className?: string;
};

/** Loading block at the final size (no layout shift); breathes at 1.2s (off under reduced motion). */
export function GSkeleton({ width = '100%', height = 14, shape = 'line', className }: GSkeletonProps) {
  return <span data-g="GSkeleton" data-shape={shape} aria-hidden className={cx('g-skel', className)} style={{ width, height }} />;
}

/** 12.5 --g-err line, centred unless `align="left"` (field errors). */
export function GErrorLine({ children, align = 'center', onRetry, className }: { children: ReactNode; align?: 'center' | 'left'; onRetry?: () => void; className?: string }) {
  return (
    <p data-g="GErrorLine" data-align={align} className={cx('g-errline', className)} role="alert">
      <span>{children}</span>
      {onRetry && (
        <GButton variant="sm" onClick={onRetry}>
          Retry
        </GButton>
      )}
    </p>
  );
}

/** Required on any demo or Filming data: a "Sample" badge whose title names the fixture. */
export function GSampleBadge({ fixture, className }: { fixture: string; className?: string }) {
  return (
    <span data-g="GSampleBadge" data-sample-badge="" className={cx('g-sample', className)}>
      <GBadge title={`Sample data: ${fixture}`}>Sample</GBadge>
    </span>
  );
}
