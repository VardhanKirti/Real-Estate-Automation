'use client';

import Link from 'next/link';
import { RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from './Status';
import { cx } from './format';

/**
 * Bennett Legacy states (founderos-ui pages/README "States, defined once").
 * Each says what it is in plain words; none fakes a value.
 */

/** Configured, nothing yet: one plain sentence saying what will appear and what makes it appear. */
export function LEmpty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-l="Empty" className={cx('l-state l-empty', className)}>
      {children}
    </div>
  );
}

/**
 * No key or no feed: the Not configured badge and a Set up link in place of
 * the data, never a zero. `href` comes from setupHrefFor(connectorId).
 */
export function LUnconfigured({ what, href = '/integrations', hint }: { what: string; href?: string; hint?: string }) {
  return (
    <div data-l="Unconfigured" className="l-state l-unconfigured">
      <Badge tone="warn">Not configured</Badge>
      <span className="l-state-text">{what} is not connected yet.</span>
      <Link data-l="SetupLink" href={href} title={hint} className="l-pressable is-dark l-pill l-setup-link" data-lens="c">
        Set up <span aria-hidden>›</span>
      </Link>
    </div>
  );
}

/**
 * The source answered with an error or timed out. With a cached value the
 * card keeps it and says how old it is; without one it shows the error and Retry.
 */
export function LError({
  message,
  lastGood,
  age,
  onRetry,
}: {
  message: string;
  lastGood?: ReactNode;
  age?: string;
  onRetry?: () => void;
}) {
  return (
    <div data-l="Error" role="status" className="l-state l-error">
      {lastGood != null ? (
        <>
          <div className="l-error-last">{lastGood}</div>
          <span className="l-state-text">
            <Badge tone="err">Stale</Badge> {age ? `last good value, ${age} old.` : 'last good value.'} {message}
          </span>
        </>
      ) : (
        <span className="l-state-text">
          <Badge tone="err">Error</Badge> {message}
        </span>
      )}
      {onRetry && (
        <button type="button" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn" onClick={onRetry}>
          <RotateCw size={12} strokeWidth={1.8} aria-hidden /> Retry
        </button>
      )}
    </div>
  );
}

/** Skeleton blocks at the final size, so streamed content never shifts the layout. */
export function LSkeleton({ lines = 3, height, className }: { lines?: number; height?: number; className?: string }) {
  return (
    <div data-l="Skeleton" aria-hidden className={cx('l-skeleton-stack', className)} style={height ? { minHeight: height } : undefined}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="l-skeleton" style={{ width: `${[92, 76, 58, 84, 66][i % 5]}%` }} />
      ))}
    </div>
  );
}

/** The amber SAMPLE chip on a fixture (?sample=1) or in Filming mode. */
export function LSampleChip({ label = 'Sample' }: { label?: string }) {
  return (
    <span data-l="SampleChip" data-sample-badge className="l-badge l-sample" data-tone="warn">
      {label}
    </span>
  );
}
