'use client';
/**
 * Breakouts (`/lab/breakouts`), GladOS tree (01 9): the filter bar, the Field, and the breakout cards
 * (strongest first; `mine=1` shows your posts). Filters replace the URL and re-render on the server;
 * Show more appends the next page from `GET /api/lab?page=breakouts&from=` and moves focus to it.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { GSelect } from '@/components/g';

import type { BreakoutsPageView, PostCardView } from '@/lib/lab/view/breakouts';
import { FilterChip, PageBar, Panel, SectionNote } from './bits';
import { Field } from './Field';
import { GPageShell } from './PageShell';
import { PostCard } from './PostCard';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

export function BreakoutsBody({ view }: { view: BreakoutsPageView }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams() ?? new URLSearchParams();
  const a = view.applied;
  const [more, setMore] = useState<PostCardView[]>([]);
  const [next, setNext] = useState<number | null>(view.cards.nextOffset);
  const [loading, setLoading] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const link = (set: Record<string, string | null>) => {
    const q = new URLSearchParams(params.toString());
    for (const k of ['post', 'event', 'idea', 'script', 'test', 'setup', 'ask', 'st', 'ver']) q.delete(k);
    for (const [k, v] of Object.entries(set)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return `${pathname}${s ? `?${s}` : ''}`;
  };
  const go = (set: Record<string, string | null>) => router.replace(link(set), { scroll: false });
  const showMore = async () => {
    if (next === null) return;
    setLoading(true);
    try {
      const q = new URLSearchParams(params.toString());
      q.set('page', 'breakouts');
      q.set('from', String(next));
      const res = await fetch(`/api/lab?${q.toString()}`, { cache: 'no-store' });
      const data = (await res.json()) as { view?: BreakoutsPageView };
      const items = data.view?.cards.items ?? [];
      const before = view.cards.items.length + more.length;
      setMore((m) => [...m, ...items]);
      setNext(data.view?.cards.nextOffset ?? null);
      requestAnimationFrame(() => grid.current?.querySelectorAll<HTMLElement>('.lab2g-postcard')[before]?.focus());
    } finally {
      setLoading(false);
    }
  };
  const items = [...view.cards.items, ...more];
  return (
    <div className="lab2g-stack">
      <PageBar
        tools={
          <>
            <GSelect aria-label={LAB_UI.platform} value={a.platform ?? ''} onChange={(e) => go({ platform: e.target.value || null })} options={[{ value: '', label: LAB_UI.allPlatforms }, ...view.filters.platforms.map((p) => ({ value: p.id, label: `${p.label} (${p.n})` }))]} />
            <GSelect aria-label={LAB_UI.format} value={a.format ?? ''} onChange={(e) => go({ format: e.target.value || null })} options={[{ value: '', label: LAB_UI.allFormats }, ...view.filters.formats.map((p) => ({ value: p.id, label: `${p.label} (${p.n})` }))]} />
            <GSelect aria-label={LAB_UI.quadrant} value={a.quadrant ?? ''} onChange={(e) => go({ quadrant: e.target.value || null })} options={[{ value: '', label: LAB_UI.allQuadrants }, ...view.filters.quadrants.map((p) => ({ value: p.id, label: `${p.label} (${p.n})` }))]} />
            <span className="lab2g-fgroup" role="group" aria-label={LAB_UI.windowLabel}>
              {view.filters.windows.map((w) => (
                <FilterChip key={w} href={link({ window: w === 30 ? null : String(w) })} active={a.window === w}>{fill(LAB_UI.days, { n: String(w) })}</FilterChip>
              ))}
            </span>
            {view.filters.dualHighAvailable ? (
              <FilterChip href={link({ dual: a.dual ? null : '1' })} active={a.dual}>{LAB_UI.dualHigh}</FilterChip>
            ) : (
              <span className="lab2g-fchip" aria-disabled="true" title={LAB_UI.dualHighOff} data-lab-ink="">{LAB_UI.dualHigh}</span>
            )}
            <FilterChip href={link({ mine: a.mine ? null : '1' })} active={a.mine}>{LAB_UI.mineOnly}</FilterChip>
            {a.creator && <FilterChip href={link({ creator: null })} active>{a.creator.label}</FilterChip>}
            {view.clearHref && <FilterChip href={view.clearHref} active={false}>{LAB_UI.clearFilters}</FilterChip>}
            <span className="lab2g-pagebar-total" data-lab-ink="">{fill(LAB_UI.totalPosts, { n: String(view.cards.total) })}</span>
          </>
        }
      />
      {view.measureNote && <p className="lab2g-onaurora" data-lab-ink="">{view.measureNote}</p>}
      <Panel id="lab2g-field" title={LAB_UI.theField} desc={LAB_UI.fieldDesc} priority={2}>
        {view.field.state.kind !== 'ready' && <SectionNote state={view.field.state} />}
        {view.field.view.points.length > 0 && <Field field={view.field.view} dualHighIds={view.field.view.dualHighIds} />}
      </Panel>
      <section aria-labelledby="lab2g-cards-title" className="lab2g-cards">
        <h2 id="lab2g-cards-title" className="lab2-row-title" data-lab-ink="">{a.mine ? LAB_UI.yourPostsTitle : LAB_UI.breakoutsTitle}</h2>
        {items.length === 0 ? (
          <SectionNote state={view.cards.state} className="lab2g-onaurora-note" />
        ) : (
          <div ref={grid} className="lab2g-cardgrid">
            {items.map((c) => <PostCard key={c.postId} card={c} />)}
          </div>
        )}
        {next !== null && (
          <span>
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={showMore} aria-busy={loading || undefined}>
              <span data-lab-ink="">{loading ? LAB_UI.loading : LAB_UI.showMore}</span>
            </button>
          </span>
        )}
      </section>
    </div>
  );
}

export function BreakoutsPage({ view }: { view: BreakoutsPageView }) {
  return (
    <GPageShell frame={view.frame} sheet={view.sheet}>
      <BreakoutsBody view={view} />
    </GPageShell>
  );
}
