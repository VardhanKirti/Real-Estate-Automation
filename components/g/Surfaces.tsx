'use client';

import type { MouseEventHandler, ReactNode } from 'react';
import Link from 'next/link';
import { cx } from './cx';
import { GDotNumber } from './Numbers';
import { GButton } from './Controls';

/**
 * Surfaces (SPEC S00 §5.3, GP3). Elevation is a fill step plus one neutral
 * shadow: no borders, no outer glow; the only glow in the kit is inside a
 * GHeroCard gradient (§3.3.8).
 */

type ActionProps = {
  /** The whole card opens this. */
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export type GCardProps = ActionProps & {
  children?: ReactNode;
  /** Padding 16, 20 (default) or 24. */
  p?: 16 | 20 | 24;
  /** Top media slot (16:9, inner radius 20); `mediaCaption` sits on a scrim over it. */
  media?: ReactNode;
  mediaCaption?: ReactNode;
  as?: 'div' | 'section' | 'article' | 'li';
  title?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  id?: string;
  className?: string;
};

function Media({ media, caption }: { media: ReactNode; caption?: ReactNode }) {
  return (
    <div className="g-card-media">
      {media}
      {caption != null && <div className="g-card-media-cap">{caption}</div>}
    </div>
  );
}

function surface(name: 'GCard' | 'GCardRaised', cls: string) {
  return function Surface({ children, p = 20, media, mediaCaption, href, onClick, as: Tag = 'div', className, ...rest }: GCardProps) {
    const body = (
      <>
        {media != null && <Media media={media} caption={mediaCaption} />}
        {children}
      </>
    );
    const attrs = { 'data-g': name, 'data-p': String(p), className: cx(cls, className), ...rest } as const;
    if (href) {
      return (
        <Link href={href} data-action="" {...attrs}>
          {body}
        </Link>
      );
    }
    if (onClick) {
      return (
        <button type="button" onClick={onClick} data-action="" {...attrs}>
          {body}
        </button>
      );
    }
    return <Tag {...attrs}>{body}</Tag>;
  };
}

/** Main card: --g-card, radius 28, --g-shadow. `href` / `onClick` make the whole card the action. */
export const GCard = surface('GCard', 'g-card');
/** Card inside a card, or a rail card: --g-card-2, radius 20, --g-shadow-sm. */
export const GCardRaised = surface('GCardRaised', 'g-card-raised');

/** Inset area inside a card (replaces every bordered tile): --g-well, radius 14, no shadow. */
export function GWell({ children, className, as: Tag = 'div' }: { children?: ReactNode; className?: string; as?: 'div' | 'section' | 'li' }) {
  return (
    <Tag data-g="GWell" className={cx('g-well', className)}>
      {children}
    </Tag>
  );
}

/* ── GHeroCard ────────────────────────────────────────────────────────── */

type HeroBase = {
  /** a = primary score, b = secondary, c = action card (C4). */
  variant?: 'a' | 'b' | 'c';
  /** Centred 13px caption in the gradient's label zone. */
  caption: ReactNode;
  /** Status line under the numeral. Unconfigured: names what is missing (default "Not configured"). */
  status?: ReactNode;
  /** Bottom strip: GRuler, GDotCloud, GSparkline, GRings, GTickStrip, GShareBar. */
  strip?: ReactNode;
  /** `md` min-height 250, `sm` 236 (rail). */
  size?: 'md' | 'sm';
  /** Spoken value when the numeral text is not enough ("Revenue $631K this month"). */
  label?: string;
  /** What the value is, its source and window. */
  title?: string;
  /**
   * Unconfigured: the card renders as a div with `—`, "Not configured" and a
   * Set up link here (GP3 div mode: anchors never nest).
   */
  setupHref?: string;
  setupHint?: string;
  /** A hero that opens or closes a region (the AdPilot library slab). */
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  className?: string;
};

/**
 * A hero must show a value or act (FR-18): one of `value`, `href`,
 * `onClick` is required, or `setupHref` when its source is unconfigured.
 */
export type GHeroCardProps = HeroBase &
  (
    | { value: string | number | null; href?: string; onClick?: MouseEventHandler<HTMLButtonElement> }
    | { value?: undefined; href: string; onClick?: never }
    | { value?: undefined; onClick: MouseEventHandler<HTMLButtonElement>; href?: never }
    | { value?: undefined; setupHref: string; href?: never; onClick?: never }
  );

/**
 * Gradient hero: caption, auto-fit dot numeral, status, strip. At most two
 * per view (C22).
 */
export function GHeroCard(props: GHeroCardProps) {
  const { variant = 'a', caption, status, strip, size = 'md', label, title, setupHref, setupHint, className, value, href, onClick } = props;
  const unconfigured = setupHref != null;
  const body = (
    <>
      <span className="g-hero-cap">{caption}</span>
      {(value !== undefined || unconfigured) && (
        <span className="g-hero-num">
          <GDotNumber value={unconfigured ? null : (value ?? null)} size="auto" tone="on-hero" label={label} />
        </span>
      )}
      {(status != null || unconfigured) && <span className="g-hero-status">{unconfigured ? (status ?? 'Not configured') : status}</span>}
      {unconfigured && (
        <GButton variant="sm" href={setupHref} title={setupHint} className="g-btn-onhero">
          Set up
        </GButton>
      )}
      {strip != null && !unconfigured && <span className="g-hero-strip">{strip}</span>}
    </>
  );
  const attrs = {
    'data-g': 'GHeroCard',
    'data-variant': variant,
    'data-size': size,
    'data-state': unconfigured ? 'unconfigured' : undefined,
    title,
    'aria-expanded': props['aria-expanded'],
    'aria-controls': props['aria-controls'],
    className: cx('g-hero', className),
  } as const;
  if (!unconfigured && href) {
    return (
      <Link href={href} data-action="" {...attrs}>
        {body}
      </Link>
    );
  }
  if (!unconfigured && onClick) {
    return (
      <button type="button" onClick={onClick} data-action="" {...attrs}>
        {body}
      </button>
    );
  }
  return <div {...attrs}>{body}</div>;
}
