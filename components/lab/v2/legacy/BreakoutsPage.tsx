'use client';
/**
 * Breakouts (`/lab/breakouts`) under Bennett Legacy (founderos-ui pages/lab.md section 1): filter chips,
 * the Field as a monochrome scatter with square markers, and the specimen grid (cards radius 12, the post
 * frame, age-matched lift as a Chip). Show more appends through GET /api/lab?page=breakouts&from= (D14).
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import type { BreakoutsPageView, PostCardView } from '@/lib/lab/view/breakouts';
import { fmtCount } from '@/lib/lab/view/format';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { openSheetHref } from '@/components/lab/v2/shared/useSheetRoute';
import { LEGACY_LAB as L } from './copy';
import { LegacyCapHost } from './dialogs';
import { Frame } from './Frame';
import { Btn, Card, FilterChip, LState, shows } from './parts';
import { SpecimenCard } from './SpecimenCard';
import { FieldPlot } from './viz';

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

/** 01 9.3: one line from 09's gates, omitted when either gate is blocked or absent. */
function gatesLine(v: BreakoutsPageView): string | null {
  const wk = v.gates?.find((g) => g.gate === 'breakouts_week' && g.platform === 'all') ?? v.gates?.find((g) => g.gate === 'breakouts_week');
  const base = v.gates?.find((g) => g.gate === 'baseline_24h');
  if (!wk || !base || wk.state === 'blocked' || base.state === 'blocked' || wk.rate === null || !base.days) return null;
  return fill(C.breakouts.gatesLine, { n: fmtCount(Math.round(wk.rate)), d: fmtCount(Math.round(base.days.med)) });
}

export function BreakoutsPage({ view }: { view: BreakoutsPageView }) {
  return (
    <LegacyCapHost>
      <BreakoutsBody view={view} />
    </LegacyCapHost>
  );
}

function BreakoutsBody({ view }: { view: BreakoutsPageView }) {
  const href = useHref();
  const router = useRouter();
  const a = view.applied;
  const f = view.filters;
  const [extra, setExtra] = useState<PostCardView[]>([]);
  const [next, setNext] = useState<number | null>(view.cards.nextOffset);
  const [loading, setLoading] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
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
      requestAnimationFrame(() => grid.current?.querySelectorAll<HTMLElement>('.l-lab-specimen-link')[at]?.focus());
    } finally {
      setLoading(false);
    }
  };

  const bar = (
    <>
      <Btn className="l-lab-filters-toggle" aria-expanded={filtersOpen} aria-controls="bo-filters" onClick={() => setFiltersOpen((o) => !o)}>
        {`${C.breakouts.filtersButton}${appliedCount ? ` (${appliedCount})` : ''}`}
      </Btn>
      <div id="bo-filters" className="l-lab-filters" data-open={filtersOpen ? '' : undefined} role="toolbar" aria-label={C.aria.filters}>
        <span className="l-chip-row" role="group" aria-label={C.breakouts.platform}>
          <FilterChip href={href({ platform: null })} active={!a.platform}>{C.breakouts.allPlatforms}</FilterChip>
          {f.platforms.map((p) => <FilterChip key={p.id} href={href({ platform: p.id })} active={a.platform === p.id} count={p.n}>{p.label}</FilterChip>)}
        </span>
        <label className="l-lab-selectchip">
          <span className="l-micro">{C.breakouts.format}</span>
          <select className="l-select" value={a.format ?? ''} onChange={(e) => router.replace(href({ format: e.target.value || null }), { scroll: false })} aria-label={C.breakouts.format}>
            <option value="">{C.breakouts.allFormats}</option>
            {f.formats.map((x) => <option key={x.id} value={x.id}>{`${x.label} (${x.n})`}</option>)}
          </select>
        </label>
        <span className="l-chip-row" role="group" aria-label={C.breakouts.quadrant}>
          <FilterChip href={href({ quadrant: null })} active={!a.quadrant}>{C.breakouts.allQuadrants}</FilterChip>
          {f.quadrants.map((qd) => <FilterChip key={qd.id} href={href({ quadrant: qd.id })} active={a.quadrant === qd.id} count={qd.n}>{qd.label}</FilterChip>)}
        </span>
        <span className="l-chip-row" role="group" aria-label={C.breakouts.window}>
          {f.windows.map((w) => <FilterChip key={w} href={href({ window: w === 30 ? null : String(w) })} active={a.window === w}>{`${w}d`}</FilterChip>)}
        </span>
        <span className="l-chip-row">
          <FilterChip href={href({ dual: a.dual ? null : '1' })} active={a.dual} disabled={!f.dualHighAvailable} title={f.dualHighAvailable ? undefined : C.breakouts.dualDisabled}>{C.breakouts.dual}</FilterChip>
          <FilterChip href={href({ mine: a.mine ? null : '1' })} active={a.mine}>{C.breakouts.mine}</FilterChip>
          {a.creator && <FilterChip href={href({ creator: null })} active>{a.creator.label}</FilterChip>}
        </span>
        {view.clearHref && <Link href={view.clearHref} replace scroll={false} className="l-link">{C.clearFilters}</Link>}
      </div>
      <span className="l-lab-bar-end l-muted">{fill(C.breakouts.total, { n: view.cards.total })}</span>
    </>
  );

  const cards = [...view.cards.items, ...extra];
  const gl = view.cards.state.kind === 'empty' && !view.clearHref ? gatesLine(view) : null;
  return (
    <Frame frame={view.frame} sheet={view.sheet} bar={bar}>
      <div className="l-stack">
        {view.measureNote && <p className="l-lab-note">{view.measureNote}</p>}
        <Card id="field" title={C.breakouts.field} sub={C.breakouts.fieldDesc} i={1}>
          <LState state={view.field.state} />
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
        </Card>

        <section className="l-lab-row" aria-labelledby="bo-cards">
          <header className="l-lab-row-head">
            <span className="l-lab-row-titles">
              <h2 id="bo-cards" className="l-lab-row-title">{a.mine ? C.breakouts.yourPosts : C.breakouts.breakouts}</h2>
              <span className="l-muted">{L.specimens}</span>
            </span>
          </header>
          <LState state={view.cards.state} />
          {gl && <p className="l-lab-note">{gl}</p>}
          {shows(view.cards.state) && (
            <div className="l-lab-specimens" ref={grid}>
              {cards.map((c, i) => <SpecimenCard key={c.postId} c={c} i={Math.min(8, i + 2)} />)}
            </div>
          )}
          {next !== null && shows(view.cards.state) && (
            <div className="l-lab-more">
              <Btn onClick={() => void more()} busy={loading}>{C.more}</Btn>
            </div>
          )}
        </section>
      </div>
    </Frame>
  );
}
