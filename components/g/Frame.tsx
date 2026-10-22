import type { ElementType, ReactNode } from 'react';
import { cx } from './cx';

/**
 * Frame and type (SPEC S00 §5.3, X1). Every GladOS page is one GPage; the
 * title is a GDisplay (or GSectionHeader size="page"); sections and cards
 * are headed by GSectionHeader. Colours and sizes come from --g-* tokens in
 * the "1d G kit" block of app/globals.css.
 */

export type GPageProps = {
  children: ReactNode;
  /** 232 / fluid / 300 frame with the 760 and 1100 container breakpoints. */
  layout?: 'stack' | 'three-col';
  className?: string;
};

/**
 * Fixed full-viewport ground (the existing .page-ground layer, C38) painted
 * --g-bg with the --g-bg-lift radial, and the page container (`g-page`
 * inline-size) with the launcher's bottom gutter.
 */
export function GPage({ children, layout = 'stack', className }: GPageProps) {
  return (
    <div data-g="GPage" className={cx('g-page', className)} data-layout={layout}>
      <div className="page-ground g-ground" aria-hidden />
      <div className="g-page-body">{children}</div>
    </div>
  );
}

export type GDisplayProps = {
  children: ReactNode;
  /** `display` 44 (32 under a 760px container), `title` 28. */
  size?: 'display' | 'title';
  /** Full text for the hover title when the 2-line clamp cuts it. */
  title?: string;
  as?: ElementType;
  className?: string;
};

export function GDisplay({ children, size = 'display', title, as: Tag = 'h1', className }: GDisplayProps) {
  return (
    <Tag data-g="GDisplay" className={cx('g-display', className)} data-size={size} title={title}>
      {children}
    </Tag>
  );
}

export type GSectionHeaderProps = {
  title: ReactNode;
  /** One muted line under the title. */
  caption?: ReactNode;
  /** One right-slot action, usually a GButton that opens the full list. */
  action?: ReactNode;
  /** 22, 26 (default) or 30; `page` renders a GDisplay with the caption as subtitle. */
  size?: 22 | 26 | 30 | 'page';
  /** Heading element; defaults to h2 (h1 for size="page"). */
  as?: ElementType;
  id?: string;
  className?: string;
};

export function GSectionHeader({ title, caption, action, size = 26, as, id, className }: GSectionHeaderProps) {
  const page = size === 'page';
  const Tag = as ?? (page ? 'h1' : 'h2');
  return (
    <div data-g="GSectionHeader" className={cx('g-section-head', className)} data-size={String(size)}>
      <div className="g-section-head-text">
        {page ? (
          <GDisplay as={Tag}>
            <span id={id}>{title}</span>
          </GDisplay>
        ) : (
          <Tag id={id} className="g-section-title">
            {title}
          </Tag>
        )}
        {caption != null && <p className="g-section-cap">{caption}</p>}
      </div>
      {action != null && <div className="g-section-action">{action}</div>}
    </div>
  );
}

/** 11.5 muted sentence-case label above data; says what the headline is. */
export function GEyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-g="GEyebrow" className={cx('g-eyebrow', className)}>
      {children}
    </span>
  );
}
