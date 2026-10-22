'use client';
/**
 * Breakouts (`/lab/breakouts`), Classic tree (01 9): filters, the Field, and the breakout cards with their
 * age-matched read and 90% interval. Show more appends through GET /api/lab?page=breakouts&from= (D14).
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type ReactNode } from 'react';
import { Glass } from '@/components/lab/v2/shared';
import type { BreakoutsPageView, PostCardView } from '@/lib/lab/view/breakouts';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';

/** 01 9.3: one line from 09's gates, omitted when either gate is blocked or absent. */
function gatesLine(v: BreakoutsPageView): string | null {
  const wk = v.gates?.find((g) => g.gate === 'breakouts_week' && g.platform === 'all') ?? v.gates?.find((g) => g.gate === 'breakouts_week');
  const base = v.gates?.find((g) => g.gate === 'baseline_24h');
  if (!wk || !base || wk.state === 'blocked' || base.state === 'blocked' || wk.rate === null || !base.days) return null;
  return fill(C.breakouts.gatesLine, { n: fmtCount(Math.round(wk.rate)), d: fmtCount(Math.round(base.days.med)) });
}
import { ClassicCapHost } from './dialogs';
import { Frame } from './Frame';
import { FilterChip, IntervalBar, Panel, StateLine, Tag, shows } from './parts';
import { FieldPlot, Strand } from './viz';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';

function useHref() {
  const params = useSearchParams();
  return (set: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(set)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `?${s}` : '?';
  };
}

/** `tag` (Ask the Lab's match kind) sits in the card's tag row with Dual-High, not floating above the card. */
export function BreakoutCard({ c, tag }: { c: PostCardView; tag?: ReactNode }) {
  const judged = c.read.state === 'judged';
  const head = judged ? c.read.text : c.read.state === 'not_built' ? c.ladder.text ?? c.read.text : c.read.text;
  return (
    <Glass as="article" tone="strong" radius="tile" priority={2} className="lab2c-pcard" data-lab="PostCard">
      <Link href={`?post=${c.postId}`} scroll={false} className="lab2c-pcard-link" data-lab-shared={`card-${c.postId}`} aria-label={`${c.hookText}, ${head}, n ${c.read.n}`}>
        <span className="lab2c-pcard-hook" data-lab-ink="">{c.hookText}</span>
        <span className="lab2c-pcard-who" data-lab-ink="">
          {c.creator.displayName}
          <span aria-hidden="true"> · </span>
          {c.formatLabel ?? c.platform}
        </span>
        <span className="lab2c-pcard-read">
          <span className="lab2c-pcard-num" data-lab-ink="">{head}</span>
          <span className="lab2c-pcard-at" data-lab-ink="">{judged ? `${c.read.atLabel ?? ''} · n ${c.read.n}` : `n ${c.read.n}`}</span>
        </span>
        <IntervalBar lo={c.confidenceBars.lo} hi={c.confidenceBars.hi} point={c.confidenceBars.point} scaleMax={c.confidenceBars.scaleMax} />
        <span className="lab2c-pcard-tags">
          {c.metrics.depthText && <span className="lab2c-muted" data-lab-ink="">{c.metrics.depthText}</span>}
          {c.dualHigh && <Tag tone="strong">{C.breakouts.dualChip}</Tag>}
          {c.exogenous && <Tag tone="quiet">{C.breakouts.outsideChip}</Tag>}
          {tag}
        </span>
        {c.strand && <Strand strand={c.strand} label={c.hookText} />}
      </Link>
    </Glass>
  );
}

export function BreakoutsPage({ view }: { view: BreakoutsPageView }) {
  return (
    <ClassicCapHost>
      <BreakoutsPageBody view={view} />
    </ClassicCapHost>
  );
}

function BreakoutsPageBody({ view }: { view: BreakoutsPageView }) {
  const href = useHref();
  const router = useRouter();
  const a = view.applied;
  const f = view.filters;
  const [extra, setExtra] = useState<PostCardView[]>([]);
  const [next, setNext] = useState<number | null>(view.cards.nextOffset);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const firstNew = useRef<HTMLDivElement>(null);
  const appliedCount = [a.platform, a.format, a.quadrant, a.dual || null, a.mine || null, a.creator].filter(Boolean).length;

  const more = async () => {
    if (next === null) return;
    setLoading(true);
    try {
      const q = new URLSearchParams(window.location.search);
      q.set('page', 'breakouts');
      q.set('from', String(next));
      const res = await fetch(`/api/lab?${q.toString()}`);
      const data = (await res.json()) as { view?: BreakoutsPageView };
      const items = data.view?.cards.items ?? [];
      const at = view.cards.items.length + extra.length;
      setExtra((x) => [...x, ...items]);
      setNext(data.view?.cards.nextOffset ?? null);
      requestAnimationFrame(() => firstNew.current?.querySelectorAll<HTMLElement>('.lab2c-pcard-link')[at]?.focus());
    } finally {
      setLoading(false);
    }
  };

  const filters = (
    <>
      <span className="lab2c-bar-group" role="group" aria-label={C.breakouts.platform}>
        <FilterChip href={href({ platform: null })} active={!a.platform}>{C.breakouts.allPlatforms}</FilterChip>
        {f.platforms.map((p) => (
          <FilterChip key={p.id} href={href({ platform: p.id })} active={a.platform === p.id}>
            {p.label}<span className="lab2c-fchip-n">{p.n}</span>
          </FilterChip>
        ))}
      </span>
      <label className="lab2c-bar-group">
        <span className="lab2c-bar-label lab2c-sr-phone" data-lab-ink="">{C.breakouts.format}</span>
        <select className="lab2c-input lab2c-select" value={a.format ?? ''} onChange={(e) => router.replace(href({ format: e.target.value || null }), { scroll: false })} aria-label={C.breakouts.format}>
          <option value="">{C.breakouts.allFormats}</option>
          {f.formats.map((x) => <option key={x.id} value={x.id}>{`${x.label} (${x.n})`}</option>)}
        </select>
      </label>
      <span className="lab2c-bar-group" role="group" aria-label={C.breakouts.quadrant}>
        <FilterChip href={href({ quadrant: null })} active={!a.quadrant}>{C.breakouts.allQuadrants}</FilterChip>
        {f.quadrants.map((qd) => (
          <FilterChip key={qd.id} href={href({ quadrant: qd.id })} active={a.quadrant === qd.id}>
            {qd.label}<span className="lab2c-fchip-n">{qd.n}</span>
          </FilterChip>
        ))}
      </span>
      <span className="lab2c-bar-group" role="group" aria-label={C.breakouts.window}>
        {f.windows.map((w) => (
          <FilterChip key={w} href={href({ window: w === 30 ? null : String(w) })} active={a.window === w}>{`${w}d`}</FilterChip>
        ))}
      </span>
      <span className="lab2c-bar-group">
        <FilterChip href={href({ dual: a.dual ? null : '1' })} active={a.dual} disabled={!f.dualHighAvailable} title={f.dualHighAvailable ? undefined : C.breakouts.dualDisabled}>{C.breakouts.dual}</FilterChip>
        <FilterChip href={href({ mine: a.mine ? null : '1' })} active={a.mine}>{C.breakouts.mine}</FilterChip>
        {a.creator && <FilterChip href={href({ creator: null })} active>{a.creator.label}</FilterChip>}
      </span>
      {view.clearHref && <Link href={view.clearHref} replace scroll={false} className="lab2-textlink" data-lab-ink="">{C.clearFilters}</Link>}
    </>
  );

  const cards = [...view.cards.items, ...extra];
  return (
    <Frame frame={view.frame} sheet={view.sheet}>
      <div className="lab2c-bar lab2c-filterbar">
        <button type="button" className="lab2c-btn lab2c-filters-toggle" aria-expanded={filtersOpen} aria-controls="bo-filters" onClick={() => setFiltersOpen((o) => !o)}>
          {`${C.breakouts.filtersButton}${appliedCount ? ` (${appliedCount})` : ''}`}
        </button>
        <div id="bo-filters" className="lab2c-filters" data-open={filtersOpen ? '' : undefined} role="toolbar" aria-label={C.aria.filters}>{filters}</div>
        <span className="lab2c-bar-end lab2c-muted" data-lab-ink="">{fill(C.breakouts.total, { n: view.cards.total })}</span>
      </div>
      {view.measureNote && <p className="lab2c-note" data-lab-ink="">{view.measureNote}</p>}

      <Panel id="field" title={C.breakouts.field} desc={C.breakouts.fieldDesc} priority={2} className="lab2c-gap-top">
        <StateLine state={view.field.state} />
        {(shows(view.field.state) || view.field.view.points.length > 0) && (
          <FieldPlot
            field={view.field.view}
            dualHighIds={view.field.view.dualHighIds}
            label={C.breakouts.field}
            quadrantLabels={C.breakouts.quadrants}
            axis={{ x: C.breakouts.xAxis, y: C.breakouts.yAxis }}
            onOpen={(id) => { const u = new URL(window.location.href); u.searchParams.set('post', id); openSheetHref(u.pathname + u.search); }}
          />
        )}
      </Panel>

      <section className="lab2c-gap-top" aria-labelledby="bo-cards">
        <header className="lab2-row-head lab2c-sechead">
          <span className="lab2-row-text">
            <h2 id="bo-cards" className="lab2-row-title" data-lab-ink="">{a.mine ? C.breakouts.yourPosts : C.breakouts.breakouts}</h2>
          </span>
        </header>
        <StateLine state={view.cards.state} />
        {view.cards.state.kind === 'empty' && !view.clearHref && gatesLine(view) && <p className="lab2c-note" data-lab-ink="">{gatesLine(view)}</p>}
        {view.cards.state.kind === 'empty' && view.cards.state.action?.href === '#run' && (
          <button type="button" className="lab2c-btn lab2c-btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('lab:run'))}>{C.runNow}</button>
        )}
        {shows(view.cards.state) && (
          <div className="lab2c-cards" ref={firstNew}>
            {cards.map((c) => <BreakoutCard key={c.postId} c={c} />)}
          </div>
        )}
        {next !== null && shows(view.cards.state) && (
          <div className="lab2c-more">
            <button type="button" className="lab2c-btn" onClick={() => void more()} aria-busy={loading ? 'true' : undefined}>{C.more}</button>
          </div>
        )}
      </section>
    </Frame>
  );
}
