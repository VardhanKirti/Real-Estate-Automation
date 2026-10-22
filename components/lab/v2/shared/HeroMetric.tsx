'use client';
/**
 * HeroMetric and HeroPair (02 section 5): one thin large numeral with a superscript unit, a dot-matrix
 * "last vs this" chart, a glass delta pill and n. Sits straight on the Aurora (no container).
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';
import { SetupLink } from '@/components/SetupLink';
import { ArrowButton } from './ActionPill';
import { DotMatrix, dotLayout, visibleGroups, type DotGroup } from './DotMatrix';
import { N_MIN, NOT_ENOUGH, splitUnit, type ValueFormat } from './format';
import { IconChevronLeft, IconChevronRight, IconTrendDown, IconTrendUp } from './icons';
import { CountUpText } from './motion/CountUpText';
import { prefersReducedMotion } from './motion/useReducedMotion';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type { DotGroup } from './DotMatrix';
export type HeroState = 'ready' | 'thin' | 'empty' | 'not-configured' | 'loading' | 'sample';
export type HeroDelta = { text: string; dir: 'up' | 'down' | 'flat' };

export type HeroMetricProps = {
  id: string;
  label: string;
  /** Raw value, kept for the count-up target (03.4). Never printed by this component. */
  value?: number | null;
  /** The value as 01 formatted it ('1.4x', '12', '$8.20'). Numbers never become text in this tree (C7). */
  valueText: string | null;
  format: ValueFormat;
  n: number;
  /** n as 01's nText printed it ('n 41'). */
  nText: string;
  delta: HeroDelta | null;
  /** Spoken form of the delta for the aria label ('up 18 percent'). */
  deltaWords?: string;
  groups: DotGroup[];
  rows?: number;
  href?: string;
  state: HeroState;
  setupHref?: string;
  ariaLabel?: string;
};

const UNIT_WORDS: Record<string, string> = { x: ' times', '%': ' percent', $: ' dollars', h: ' hours', d: ' days' };

function effectiveState(p: HeroMetricProps): HeroState {
  if ((p.state === 'ready' || p.state === 'sample') && p.n < N_MIN) return 'thin';
  return p.state;
}

export function HeroMetric(p: HeroMetricProps) {
  const km = useKitMark();
  const state = effectiveState(p);
  const rows = p.rows ?? 5;
  const shown = state === 'ready' || state === 'sample';
  const split = p.valueText && shown ? splitUnit(p.valueText, p.format) : null;
  const vis = visibleGroups(p.groups);
  const layout = dotLayout(vis, rows);
  const prev = vis.find((g) => g.emphasis === 'prev');
  const aria =
    p.ariaLabel ??
    (shown && split
      ? `${p.label}: ${split.text}${split.unit ? UNIT_WORDS[split.unit] ?? '' : ''}${p.delta && p.deltaWords ? `, ${p.deltaWords} on ${prev?.label ?? 'the last period'}` : ''}, ${p.nText}`
      : `${p.label}: ${state === 'thin' ? NOT_ENOUGH : state === 'not-configured' ? 'Not configured' : state === 'empty' ? 'Nothing yet' : 'loading'}`);
  const showDots = state === 'ready' || state === 'sample' || state === 'thin' || state === 'loading';
  const showN = state === 'ready' || state === 'sample' || state === 'thin';
  const showArrow = !!p.href && (state === 'ready' || state === 'sample' || state === 'thin');

  return (
    <section className="lab2-hero" data-lab="HeroMetric" {...km('LabHeroMetric')} data-state={state} aria-label={aria} role="group">
      <div className="lab2-hero-head">
        <h3 className="lab2-hero-label" data-lab-ink="">{p.label}</h3>
        {showArrow && <ArrowButton label={`Open ${p.label}`} href={p.href} size={36} />}
      </div>

      <div className="lab2-hero-num" aria-hidden={shown ? true : undefined}>
        {shown && split ? (
          <span className="lab2-hero-numeral" data-lab-ink="">
            <CountUpText text={split.text} />
            {split.unit && <sup className="lab2-hero-unit" data-lab-ink="">{split.unit}</sup>}
          </span>
        ) : state === 'thin' ? (
          <span className="lab2-hero-word" data-lab-ink="">{NOT_ENOUGH}</span>
        ) : state === 'empty' ? (
          <span className="lab2-hero-word" data-lab-ink="">Nothing yet</span>
        ) : state === 'not-configured' ? (
          <span className="lab2-hero-nc">
            <span className="lab2-hero-word" data-lab-ink="">Not configured</span>
            <SetupLink href={p.setupHref ?? '?setup=keys'} label="Set up" className="lab2-setup" />
          </span>
        ) : (
          <span className="lab2-skel lab2-skel-hero" />
        )}
      </div>

      {showDots && vis.length > 0 && (
        <div className="lab2-hero-viz" style={{ width: layout.width }}>
          <DotMatrix groups={vis} rows={rows} label={`${p.label}, ${vis.map((g) => g.label).join(' against ')}`} unlit={state !== 'ready' && state !== 'sample'} />
          {shown && p.delta && (
            <span className="lab2-delta" data-dir={p.delta.dir} data-lab-ink="">
              {p.delta.dir === 'up' ? <IconTrendUp size={12} /> : p.delta.dir === 'down' ? <IconTrendDown size={12} /> : null}
              {p.delta.text}
            </span>
          )}
        </div>
      )}
      {(showN || (showDots && vis.length > 0)) && (
        <div className="lab2-hero-foot">
          {showDots && layout.groups.map((g, i) => (
            <span key={g.id} className="lab2-hero-glabel" style={{ left: g.x }} data-lab-ink="">
              {vis[i].label}
            </span>
          ))}
          {showN && <span className="lab2-hero-n" data-lab-ink="">{p.nText}</span>}
        </div>
      )}
    </section>
  );
}

export type HeroPage = { id: 'all' | 'instagram' | 'tiktok' | 'youtube' | 'linkedin' | 'x'; label: string; heroes: [HeroMetricProps, HeroMetricProps] };
export type HeroPairProps = { pages: HeroPage[]; page?: HeroPage['id']; onPage?: (id: HeroPage['id']) => void };

/** Two heroes side by side with the platform pager under them (wraps). Controlled when onPage is set. */
export function HeroPair({ pages, page, onPage }: HeroPairProps) {
  const km = useKitMark();
  const [local, setLocal] = useState<HeroPage['id']>(page ?? pages[0]?.id ?? 'all');
  const cur = onPage ? page ?? local : local;
  const idx = Math.max(0, pages.findIndex((p) => p.id === cur));
  const pg = pages[idx];
  const row = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const go = (d: number) => {
    if (pages.length < 2) return;
    const next = pages[(idx + d + pages.length) % pages.length].id;
    if (onPage) onPage(next);
    else setLocal(next);
    slide(d);
  };
  /** 03.7.2: the incoming pair and label slide in from the side they came from (no count-up here). */
  const slide = (d: number) => {
    if (prefersReducedMotion()) return;
    const dx = d > 0 ? 24 : -24;
    for (const [el, dist, dur] of [[row.current, dx, LAB_DUR.enter], [label.current, dx / 3, LAB_DUR.s]] as const) {
      if (!el || typeof el.animate !== 'function') continue;
      el.getAnimations().forEach((a) => a.finish());
      el.animate([{ opacity: 0, transform: `translateX(${dist}px)` }, { opacity: 1, transform: 'none' }], { duration: dur, easing: LAB_EASE.out });
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };
  if (!pg) return null;
  return (
    <div className="lab2-heropair" data-lab="HeroPair" {...km('LabHeroPair')} role="group" aria-label={`Hero metrics, ${pg.label}`}>
      <div ref={row} className="lab2-heropair-row">
        <HeroMetric {...pg.heroes[0]} />
        <HeroMetric {...pg.heroes[1]} />
      </div>
      <div className="lab2-heropair-foot">
        <span className="lab2-rule" aria-hidden="true" />
        <span className="lab2-pager" data-lab="HeroPager" {...km('LabHeroPager')}>
          <button type="button" className="lab2-pager-btn" aria-label="Previous platform" aria-disabled={pages.length < 2 ? true : undefined} onClick={() => go(-1)} onKeyDown={onKey} data-lab-mark="">
            <IconChevronLeft size={14} />
          </button>
          <span ref={label} className="lab2-pager-label" data-lab-ink="">{pg.label}</span>
          <button type="button" className="lab2-pager-btn" aria-label="Next platform" aria-disabled={pages.length < 2 ? true : undefined} onClick={() => go(1)} onKeyDown={onKey} data-lab-mark="">
            <IconChevronRight size={14} />
          </button>
        </span>
        <span className="lab2-rule" aria-hidden="true" />
      </div>
    </div>
  );
}
