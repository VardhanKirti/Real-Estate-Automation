import { readVentures } from '@/lib/ventures-store';
import { readCache, readSettings } from '@/lib/creative-engine/store';
import type { Catalog } from '@/lib/arcads/catalog';

/**
 * Where the Creative generator's Product field gets its options (S03 FR-12):
 * the operator's ventures, the Arcads product chosen in Connect Arcads, and
 * the cached Arcads catalog. Read from disk only; page load never calls the
 * network. De-duplicated case-insensitively; a venture wins (its detail is
 * richer). Server-only.
 */

export type ProductSource = 'venture' | 'arcads';
export type ProductOption = { label: string; detail: string; source: ProductSource };

export type ProductInputs = {
  ventures: { label: string; detail: string }[];
  settingsProduct: string | null;
  catalogProducts: { name: string; description?: string }[];
};

/** Pure merge, for tests and for the page. */
export function mergeProductOptions(i: ProductInputs): ProductOption[] {
  const out: ProductOption[] = [];
  const seen = new Set<string>();
  const add = (label: string | null | undefined, detail: string, source: ProductSource) => {
    const l = (label ?? '').replace(/\s+/g, ' ').trim();
    if (!l) return;
    const key = l.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label: l, detail, source });
  };
  for (const v of i.ventures) add(v.label, v.detail, 'venture');
  add(i.settingsProduct, 'Chosen in Connect Arcads', 'arcads');
  for (const p of i.catalogProducts) add(p.name, p.description ?? 'Arcads product', 'arcads');
  return out;
}

export function productOptions(): ProductOption[] {
  const settings = readSettings();
  // Any age is fine here: these are names to suggest, not live state.
  const catalog = readCache<Catalog>('arcads-catalog', Number.POSITIVE_INFINITY);
  return mergeProductOptions({
    ventures: readVentures().map((v) => ({ label: v.label, detail: v.detail })),
    settingsProduct: settings.arcadsProductName,
    catalogProducts: catalog?.products ?? [],
  });
}
