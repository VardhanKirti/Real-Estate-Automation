'use client';

/**
 * /skills = search bar + the scope hierarchy + the library grid, sharing one
 * query: typing filters the grid AND dims non-matching leaves in the tree;
 * the hierarchy panel's "Read SKILL.md" opens the grid's viewer.
 */

import { useState } from 'react';
import { Search } from 'lucide-react';
import { SkillsGrid, type SkillCard } from '@/components/SkillsGrid';
import { SkillHierarchy } from '@/components/SkillHierarchy';

export function SkillsExplorer({ cards, sourceNote }: { cards: SkillCard[]; sourceNote: string }) {
  const [query, setQuery] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  return (
    <div>
      {/* search — the whole skill library answers to this */}
      <div className="mb-4 flex max-w-[520px] items-center gap-3 rounded-full border border-os-border bg-os-surface px-4 py-2.5 transition-colors focus-within:border-[var(--accent-line)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-os-dim" strokeWidth={1.7} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills"
          spellCheck={false}
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-os-text outline-none placeholder:text-os-dim"
          style={{ caretColor: 'var(--accent)' }}
        />
        {query !== '' && (
          <button onClick={() => setQuery('')} className="font-mono text-[12px] text-os-dim hover:text-os-text" aria-label="Clear search">
            ×
          </button>
        )}
      </div>

      {/* full-bleed, viewport-height — the same window treatment as the
          Optimal Engine hero  */}
      <section className="relative -mx-8 mb-7 h-[calc(100vh-130px)] min-h-[560px] wide:-mx-10 ultra:-mx-12">
        <SkillHierarchy cards={cards} query={query} onOpen={(id) => setOpenSlug(id)} />
      </section>

      <SkillsGrid cards={cards} sourceNote={sourceNote} query={query} openSlug={openSlug} onOpened={() => setOpenSlug(null)} />
    </div>
  );
}
