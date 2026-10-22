/**
 * The Connections board's browser (founderos-ui pages/feature-additions.md
 * F11): search the catalogue and filter it by category and state. Pure, so
 * both trees (GladOS, Classic; Legacy renders Classic under its skin) share it.
 *
 * States are what the tile itself shows, never more: `connected` only when
 * the linked connector reports connected (lib/integrations-catalog.ts), `key
 * saved` when every connect-flow key sits in .env.local but nothing reports
 * live, else `not connected`.
 */

export const BROWSE_STATES = [
  { id: 'connected', label: 'Connected' },
  { id: 'key-saved', label: 'Key saved' },
  { id: 'not-connected', label: 'Not connected' },
] as const;
export type BrowseState = (typeof BROWSE_STATES)[number]['id'];

export type BrowseItem = {
  slug: string;
  name: string;
  tagline: string;
  category: string;
  state: BrowseState;
};

export function browseState(entry: { connected: boolean; keySaved: boolean }): BrowseState {
  if (entry.connected) return 'connected';
  if (entry.keySaved) return 'key-saved';
  return 'not-connected';
}

export type BrowseFilter = { q: string; categories: readonly string[]; states: readonly BrowseState[] };

export const EMPTY_FILTER: BrowseFilter = { q: '', categories: [], states: [] };

export function isFiltering(f: BrowseFilter): boolean {
  return f.q.trim() !== '' || f.categories.length > 0 || f.states.length > 0;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Every item that matches all of: each word of the query somewhere in the
 * name, tagline, slug or category; one of the picked categories (none picked
 * = any); one of the picked states (none picked = any). Catalogue order kept.
 */
export function filterBrowse<T extends BrowseItem>(items: readonly T[], f: BrowseFilter): T[] {
  const words = norm(f.q).split(' ').filter(Boolean);
  return items.filter((i) => {
    if (f.categories.length > 0 && !f.categories.includes(i.category)) return false;
    if (f.states.length > 0 && !f.states.includes(i.state)) return false;
    if (words.length === 0) return true;
    const hay = norm(`${i.name} ${i.tagline} ${i.slug} ${i.category}`);
    return words.every((w) => hay.includes(w));
  });
}

/** How many items each chip would leave, given the other filters (shown as the chip count). */
export function countBy<T extends BrowseItem>(items: readonly T[], key: 'category' | 'state'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i[key]] = (out[i[key]] ?? 0) + 1;
  return out;
}

/** The result line under the filters. */
export function resultCaption(n: number, total: number): string {
  if (n === 0) return 'No tools match. Clear the filters to see all of them.';
  return n === total ? `All ${total} tools` : `${n} of ${total} tools`;
}
