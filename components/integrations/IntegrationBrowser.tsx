'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { GButton, GChip, GEmpty, GSearch } from '@/components/g';
import { BROWSE_STATES, EMPTY_FILTER, countBy, filterBrowse, isFiltering, resultCaption, type BrowseFilter, type BrowseItem, type BrowseState } from '@/lib/integration-browser';

/**
 * Search and filter the Connections catalogue (founderos-ui F11). The server
 * renders every tool card once per tree and hands them in with their facts;
 * with no filter the board shows its category accordions (children), with
 * one it shows a flat grid of the matching cards. Nothing is fetched here.
 */

export type BrowserItem = BrowseItem & { card: ReactNode };

type Props = {
  ui: 'glados' | 'classic';
  items: BrowserItem[];
  categories: string[];
  /** the unfiltered view: the category accordions */
  children: ReactNode;
  /** grid class for the filtered results (each tree's own card grid) */
  gridClassName: string;
};

function toggle<T>(list: readonly T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function IntegrationBrowser({ ui, items, categories, children, gridClassName }: Props) {
  const [f, setF] = useState<BrowseFilter>(EMPTY_FILTER);
  const filtering = isFiltering(f);
  const results = useMemo(() => filterBrowse(items, f), [items, f]);
  const catCounts = useMemo(() => countBy(filterBrowse(items, { ...f, categories: [] }), 'category'), [items, f]);
  const stateCounts = useMemo(() => countBy(filterBrowse(items, { ...f, states: [] }), 'state'), [items, f]);
  const setQ = (q: string) => setF((p) => ({ ...p, q }));
  const flipCat = (c: string) => setF((p) => ({ ...p, categories: toggle(p.categories, c) }));
  const flipState = (s: BrowseState) => setF((p) => ({ ...p, states: toggle(p.states, s) }));
  const clear = () => setF(EMPTY_FILTER);

  const caption = resultCaption(results.length, items.length);

  if (ui === 'glados') {
    return (
      <div className="kg-browse" data-integration-browser="">
        <div className="kg-browse-bar">
          <GSearch value={f.q} onValueChange={setQ} size="md" placeholder="Search tools" aria-label="Search tools by name, use or category" />
          <div className="kg-browse-chips" role="group" aria-label="Filter by state">
            {BROWSE_STATES.map((s) => (
              <GChip key={s.id} size="compact" pressed={f.states.includes(s.id)} onPressedChange={() => flipState(s.id)} count={stateCounts[s.id] ?? 0}>
                {s.label}
              </GChip>
            ))}
          </div>
          <div className="kg-browse-chips" role="group" aria-label="Filter by category">
            {categories.map((c) => (
              <GChip key={c} size="compact" pressed={f.categories.includes(c)} onPressedChange={() => flipCat(c)} count={catCounts[c] ?? 0}>
                {c}
              </GChip>
            ))}
          </div>
          {filtering && (
            <div className="kg-browse-meta">
              <span className="kg-cap" aria-live="polite">
                {caption}
              </span>
              <GButton variant="sm" onClick={clear}>
                Clear filters
              </GButton>
            </div>
          )}
        </div>
        {!filtering ? (
          children
        ) : results.length === 0 ? (
          <GEmpty title="No tools match" body="Try another word, or clear the filters to see every tool." action={{ label: 'Clear filters', onClick: clear }} />
        ) : (
          <div className={gridClassName}>{results.map((r) => r.card)}</div>
        )}
      </div>
    );
  }

  const chip = (pressed: boolean) =>
    `inline-flex items-center gap-1.5 rounded-sm-t border px-2.5 py-1 text-[12px] transition-colors ${
      pressed ? 'border-os-accent bg-os-surface2 text-os-text' : 'border-os-border text-os-muted hover:bg-os-surface2 hover:text-os-text'
    }`;
  return (
    <div data-integration-browser="">
      <div className="mb-4 flex flex-col gap-3 rounded-lg-t border border-os-border bg-os-surface p-4">
        <label className="flex items-center gap-2.5 rounded-sm-t border border-os-border bg-os-bg px-3 py-2 focus-within:border-os-border-strong">
          <Search className="h-3.5 w-3.5 shrink-0 text-os-dim" strokeWidth={1.6} aria-hidden="true" />
          <input
            type="search"
            value={f.q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && f.q) {
                e.preventDefault();
                setQ('');
              }
            }}
            placeholder="Search tools"
            aria-label="Search tools by name, use or category"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-os-text outline-none placeholder:text-os-dim"
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
          {BROWSE_STATES.map((s) => (
            <button key={s.id} type="button" aria-pressed={f.states.includes(s.id)} onClick={() => flipState(s.id)} className={chip(f.states.includes(s.id))}>
              {s.label}
              <span className="font-mono text-[10.5px] text-os-dim">{stateCounts[s.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {categories.map((c) => (
            <button key={c} type="button" aria-pressed={f.categories.includes(c)} onClick={() => flipCat(c)} className={chip(f.categories.includes(c))}>
              {c}
              <span className="font-mono text-[10.5px] text-os-dim">{catCounts[c] ?? 0}</span>
            </button>
          ))}
        </div>
        {filtering && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-os-muted">
            <span aria-live="polite">{caption}</span>
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-sm-t border border-os-border px-2 py-1 text-os-muted hover:bg-os-surface2 hover:text-os-text">
              <X className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" /> Clear filters
            </button>
          </div>
        )}
      </div>
      {!filtering ? (
        children
      ) : results.length === 0 ? (
        <div className="rounded-lg-t border border-os-border bg-os-surface px-5 py-4 text-[13px] text-os-muted">No tools match. Try another word, or clear the filters.</div>
      ) : (
        <div className={gridClassName}>{results.map((r) => r.card)}</div>
      )}
    </div>
  );
}
