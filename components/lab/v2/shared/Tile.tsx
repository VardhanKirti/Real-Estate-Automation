'use client';
/**
 * Tile and TileRow (02 section 8). A tile is one number with one comparison and one small trend. The whole
 * tile is one link; the arrow inside is a visual affordance, never a nested control.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ArrowButton } from './ActionPill';
import { N_MIN, NOT_ENOUGH, TOO_NEW, splitUnit, type ValueFormat } from './format';
import { Glass } from './Glass';
import { IconTrendDown, IconTrendUp } from './icons';
import { BandViz, CapViz, TickViz, WaveViz } from './MiniViz';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type TileViz =
  | { kind: 'band'; ageH: number; points: { h: number; v: number }[]; band: { h: number; lo: number; mid: number; hi: number }[] }
  | { kind: 'wave'; buckets: number[]; nowIndex: number; window: 'open' | 'closing' | 'closed'; max?: number }
  | { kind: 'cap'; spent: number; cap: number; currency: '$' }
  | { kind: 'ticks'; values: number[]; highlight: number[] };
export type TileState = 'ready' | 'thin' | 'too-new' | 'loading';
export type TileProps = {
  id: string;
  title: string;
  href: string;
  /** Raw value (count-up target). Never printed by this component. */
  value?: number | null;
  /** The value as 01 formatted it. */
  valueText: string | null;
  format: ValueFormat;
  n: number;
  nText: string;
  delta?: { text: string; dir: 'up' | 'down' | 'flat' } | null;
  foot: string;
  viz: TileViz | null;
  state: TileState;
  sharedId?: string;
  /** Spoken value for the link label ('2.3 times'); defaults to valueText. */
  valueWords?: string;
};

/** Tile viz box: narrower than 02's 88 x 32 so a two-digit ratio and the viz never touch at 184px. */
export const TILE_VIZ = { w: 64, h: 30 } as const;

function Viz({ viz, dim }: { viz: TileViz; dim: boolean }) {
  const { w, h } = TILE_VIZ;
  switch (viz.kind) {
    case 'band': return <BandViz ageH={viz.ageH} points={viz.points} band={viz.band} dim={dim} w={w} h={h} />;
    case 'wave': return <WaveViz buckets={viz.buckets} nowIndex={viz.nowIndex} window={viz.window} max={viz.max} dim={dim} w={w} h={h} />;
    case 'cap': return <CapViz spent={viz.spent} cap={viz.cap} dim={dim} w={w} h={h} />;
    case 'ticks': return <TickViz values={viz.values} highlight={dim ? [] : viz.highlight} dim={dim} w={w} h={h} />;
  }
}

export function Tile(p: TileProps) {
  const km = useKitMark();
  const router = useRouter();
  const state: TileState = p.state === 'ready' && p.n < N_MIN ? 'thin' : p.state;
  const split = state === 'ready' && p.valueText ? splitUnit(p.valueText, p.format) : null;
  const foot = state === 'too-new' ? 'judged from 6h' : p.foot;
  const spoken = state === 'ready' ? p.valueWords ?? p.valueText ?? '' : state === 'thin' ? NOT_ENOUGH : state === 'too-new' ? TOO_NEW : 'loading';
  const label = p.nText ? `${p.title}: ${spoken}, ${foot}, ${p.nText}` : `${p.title}: ${spoken}, ${foot}`;
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(p.href, { scroll: false });
  };
  return (
    <Glass
      as="a"
      href={p.href}
      onClick={onClick}
      tone="strong"
      radius="tile"
      priority={2}
      className="lab2-tile"
      data-lab="Tile"
      {...km('LabTile')}
      data-state={state}
      data-lab-shared={p.sharedId ?? p.id}
      aria-label={label}
    >
      <span className="lab2-tile-body">
        <span className="lab2-tile-title" data-lab-ink="">{p.title}</span>
        <ArrowButton label={`Open ${p.title}`} size={32} decorative />
        <span className="lab2-tile-bottom">
          <span className="lab2-tile-num">
            {state === 'ready' && split ? (
              <>
                <span className="lab2-tile-numeral" data-lab-ink="">
                  {split.text}
                  {split.unit && <sup data-lab-ink="">{split.unit}</sup>}
                </span>
                {p.delta && (
                  <span className="lab2-tile-delta" data-dir={p.delta.dir} data-lab-ink="">
                    {p.delta.dir === 'up' ? <IconTrendUp size={10} /> : p.delta.dir === 'down' ? <IconTrendDown size={10} /> : null}
                    {p.delta.text}
                  </span>
                )}
              </>
            ) : state === 'loading' ? (
              <span className="lab2-skel" style={{ width: 56, height: 28 }} />
            ) : (
              <span className="lab2-tile-word" data-lab-ink="">{state === 'too-new' ? TOO_NEW : NOT_ENOUGH}</span>
            )}
          </span>
          <span className="lab2-tile-side">
            <span className="lab2-tile-foot" data-lab-ink="">{p.nText ? `${foot} · ${p.nText}` : foot}</span>
            {p.viz && state !== 'loading' && <Viz viz={p.viz} dim={state !== 'ready'} />}
          </span>
        </span>
      </span>
    </Glass>
  );
}

export type TileRowProps = {
  title: string;
  description: string;
  seeAllHref?: string;
  seeAllLabel?: string;
  children?: ReactNode;
  emptyText?: string;
  id?: string;
};

export function TileRow({ title, description, seeAllHref, seeAllLabel = 'See all', children, emptyText, id }: TileRowProps) {
  const km = useKitMark();
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  const hid = id ? `${id}-title` : undefined;
  const row = useRef<HTMLDivElement>(null);
  // 01 22.2: a tile row is one tab stop; Left and Right (Home, End) move real focus between tiles, Enter
  // opens the focused one. Roving tabindex, no aria-activedescendant.
  const tiles = () => [...(row.current?.querySelectorAll<HTMLElement>("[data-lab='Tile']") ?? [])];
  useEffect(() => {
    const all = tiles();
    if (!all.length) return;
    const cur = all.findIndex((t) => t.getAttribute('tabindex') === '0');
    all.forEach((t, i) => t.setAttribute('tabindex', i === (cur >= 0 ? cur : 0) ? '0' : '-1'));
  });
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = tiles();
    const i = all.findIndex((t) => t === document.activeElement || t.contains(document.activeElement));
    if (i < 0) return;
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const j = Math.max(0, Math.min(all.length - 1, to));
    all.forEach((t, k) => t.setAttribute('tabindex', k === j ? '0' : '-1'));
    all[j].focus();
    all[j].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  return (
    <section className="lab2-row" data-lab="TileRow" {...km('LabTileRow')} aria-labelledby={hid}>
      <header className="lab2-row-head">
        <span className="lab2-row-text">
          <h2 id={hid} className="lab2-row-title" data-lab-ink="">{title}</h2>
          <span className="lab2-row-desc" data-lab-ink="">{description}</span>
        </span>
        {seeAllHref && (
          <Link href={seeAllHref} scroll={false} className="lab2-pill lab2-seeall" data-lab-ink="">{seeAllLabel}</Link>
        )}
      </header>
      {has ? <div ref={row} className="lab2-row-scroll" onKeyDown={onKey}>{children}</div> : <p className="lab2-row-empty" data-lab-ink="">{emptyText}</p>}
    </section>
  );
}
