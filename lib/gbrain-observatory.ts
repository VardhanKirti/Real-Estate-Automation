/**
 * Optimal Engine Observatory data — the REAL feed behind the /brain radial and Home
 * (the /design/gbrain prototypes are in archive/design-prototypes/).
 *
 * Every visual element maps to something true in the brain-store:
 *   cluster = a real top-level folder (page count shown is real)
 *   big dot = a real page; small dots around it = its embedded chunks
 *   cross links = resolved [[wikilinks]] between real pages
 * When the store isn't mounted the data says so — the canvas renders an
 * honest empty state instead of an invented brain.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStoreNotes } from '@/lib/connectors/gbrain';
import { chunkText, parseNote } from '@/lib/brain-graph';
import { brainStoreDir } from '@/lib/stores';
import { isFilming, demoContextHealth } from '@/lib/demo-mode';

export type ObservatoryCluster = { key: string; name: string; color: string; pages: number };
/** c = cluster index, t = display filename, k = chunk dots shown, hub = labeled on canvas */
export type ObservatoryNote = { c: number; t: string; k: number; hub: boolean };
/** Full per-page record for the radial (design 6) variant — every number real. */
export type ObservatoryPage = {
  c: number;
  t: string;
  title: string;
  chunks: number;
  words: number;
  /** whole days since last modified; null when mtime unknown */
  days: number | null;
  /** calendar year of last modification; null when mtime unknown */
  year: number | null;
  excerpt: string;
  /** resolved wikilinks touching this page */
  links: number;
  /** word count of each chunk (first 24) — real size distribution */
  chunkWords: number[];
  /** context health 0-100 — how far a page can still be trusted as context */
  health: number;
};

export type ObservatoryData = {
  mounted: boolean;
  totalPages: number;
  totalChunks: number;
  shownChunks: number;
  wikilinks: number;
  statusLine: string;
  clusters: ObservatoryCluster[];
  notes: ObservatoryNote[];
  /** note-index pairs — resolved wikilinks between pages */
  links: [number, number][];
  /** same order as `notes` */
  pages: ObservatoryPage[];
  /** % of pages touched in the last 30 days / untouched for 90+ (null without mtimes) */
  freshPct: number | null;
  stalePct: number | null;
  /** pages last modified per year, ascending — the timeline rail */
  years: { year: number; count: number }[];
};

/**
 * Context health, 0-100 — how far a page can still be trusted as context,
 * from signals the store itself yields. No invented inputs.
 *
 *   freshness     45%  mtime decay: full at <=30d, floored at 0.2 past a year
 *   connectedness 25%  resolved wikilink degree — an isolated page rots unseen
 *   substance     30%  body length plus chunk density, so stubs score low
 *
 * Interim by design: when /drift lands, its measured contradiction against
 * the canon replaces the freshness term rather than sitting beside it.
 */
export function pageHealth(p: {
  days: number | null;
  links: number;
  words: number;
  chunkWords: number[];
}): number {
  // no mtime is not evidence of rot — score freshness neutral rather than dead
  const freshness =
    p.days == null ? 0.6 : p.days <= 30 ? 1 : Math.max(0.2, 1 - ((p.days - 30) / 335) * 0.8);
  const connectedness = Math.min(1, p.links / 4); // 4+ links = fully woven in
  const body = Math.min(1, p.words / 400);
  const avgChunk =
    p.chunkWords.length > 0 ? p.chunkWords.reduce((s, n) => s + n, 0) / p.chunkWords.length : 0;
  const density = Math.min(1, avgChunk / 180);
  const substance = 0.6 * body + 0.4 * density;
  return Math.round(100 * (0.45 * freshness + 0.25 * connectedness + 0.3 * substance));
}

const MAX_LOBES = 7;
/** Dot budget — keeps the canvas at filming framerate on big stores. */
const CHUNK_BUDGET = 700;
/** Console data ramp first, honest status hues after — assigned by folder size. */
const PALETTE = ['#6e96f2', '#6656e3', '#bd5fe8', '#8fb4f6', '#3fd968', '#f2b33d', '#d9e4fb', '#8a90a8'];

export function buildObservatoryData(
  rawNotes: { path: string; content: string }[],
  opts?: { mtimes?: Map<string, number>; now?: number },
): ObservatoryData {
  const parsed = rawNotes.map((n) => {
    const note = parseNote(n.path, n.content);
    return { note, chunks: Math.max(1, chunkText(note.body).length) };
  });
  if (parsed.length === 0) {
    return {
      mounted: false,
      totalPages: 0,
      totalChunks: 0,
      shownChunks: 0,
      wikilinks: 0,
      statusLine: 'brain-store not mounted',
      clusters: [],
      notes: [],
      links: [],
      pages: [],
      freshPct: null,
      stalePct: null,
      years: [],
    };
  }

  // folders by page count; top lobes keep their name, the tail folds into misc
  const byFolder = new Map<string, typeof parsed>();
  for (const p of parsed) {
    const list = byFolder.get(p.note.folder) ?? [];
    list.push(p);
    byFolder.set(p.note.folder, list);
  }
  const folders = [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const head = folders.length > MAX_LOBES ? folders.slice(0, MAX_LOBES - 1) : folders;
  const tail = folders.length > MAX_LOBES ? folders.slice(MAX_LOBES - 1) : [];

  const groups: { key: string; name: string; items: typeof parsed }[] = head.map(([name, items]) => ({ key: name, name, items }));
  if (tail.length > 0) groups.push({ key: 'misc', name: 'misc', items: tail.flatMap(([, items]) => items) });

  const totalChunks = parsed.reduce((s, p) => s + p.chunks, 0);
  const scale = totalChunks > CHUNK_BUDGET ? CHUNK_BUDGET / totalChunks : 1;

  const clusters: ObservatoryCluster[] = groups.map((g, i) => ({
    key: g.key,
    name: g.name,
    color: PALETTE[i % PALETTE.length],
    pages: g.items.length,
  }));

  // shared basenames (every skill ships a SKILL.md) get their parent folder
  // in the display name so labels stay unambiguous
  const baseCounts = new Map<string, number>();
  for (const p of parsed) {
    const base = p.note.slug.split('/').pop()!;
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  }

  const notes: ObservatoryNote[] = [];
  const slugToIndex = new Map<string, number>();
  const orderedParsed: (typeof parsed)[number][] = [];
  groups.forEach((g, ci) => {
    // biggest pages get the on-canvas labels
    const ranked = [...g.items].sort((a, b) => b.chunks - a.chunks);
    const hubs = new Set(ranked.slice(0, 2).map((p) => p.note.slug));
    for (const p of g.items) {
      const idx = notes.length;
      const base = p.note.slug.split('/').pop()!;
      const display = (baseCounts.get(base) ?? 0) > 1 ? p.note.slug.split('/').slice(-2).join('/') : base;
      notes.push({
        c: ci,
        t: `${display}.md`,
        k: Math.max(1, Math.round(p.chunks * scale)),
        hub: hubs.has(p.note.slug),
      });
      orderedParsed.push(p);
      slugToIndex.set(p.note.slug.toLowerCase(), idx);
      if (!slugToIndex.has(base.toLowerCase())) slugToIndex.set(base.toLowerCase(), idx);
    }
  });

  // resolve wikilinks between pages (dedupe, drop self-links)
  const seen = new Set<string>();
  const links: [number, number][] = [];
  orderedParsed.forEach((p, i) => {
    for (const target of p.note.wikilinks) {
      const t = target.toLowerCase().replace(/\.md$/, '');
      const j = slugToIndex.get(t) ?? slugToIndex.get(t.split('/').pop() ?? '');
      if (j == null || j === i) continue;
      const key = i < j ? `${i}:${j}` : `${j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([i, j]);
    }
  });

  // per-page link degree
  const degree = new Array<number>(notes.length).fill(0);
  for (const [i, j] of links) {
    degree[i]++;
    degree[j]++;
  }

  // full page records (same order as notes); freshness from mtimes when given
  const now = opts?.now ?? Date.now();
  const pages: ObservatoryPage[] = orderedParsed.map((p, i) => {
    const mtime = opts?.mtimes?.get(p.note.slug);
    const chunkWords = chunkText(p.note.body)
      .slice(0, 24)
      .map((c) => c.split(/\s+/).filter(Boolean).length);
    const days = mtime != null ? Math.max(0, Math.floor((now - mtime) / 86_400_000)) : null;
    return {
      c: notes[i].c,
      t: notes[i].t,
      title: p.note.title,
      chunks: p.chunks,
      words: p.note.wordCount,
      days,
      year: mtime != null ? new Date(mtime).getFullYear() : null,
      excerpt: p.note.excerpt,
      links: degree[i],
      chunkWords,
      health: isFilming()
        ? demoContextHealth(p.note.slug)
        : pageHealth({ days, links: degree[i], words: p.note.wordCount, chunkWords }),
    };
  });

  const dated = pages.filter((p) => p.days != null) as (ObservatoryPage & { days: number })[];
  const freshPct = dated.length > 0 ? Math.round((dated.filter((p) => p.days <= 30).length / dated.length) * 100) : null;
  const stalePct = dated.length > 0 ? Math.round((dated.filter((p) => p.days >= 90).length / dated.length) * 100) : null;
  const yearCounts = new Map<number, number>();
  if (opts?.mtimes) {
    for (const p of orderedParsed) {
      const mtime = opts.mtimes.get(p.note.slug);
      if (mtime == null) continue;
      const y = new Date(mtime).getFullYear();
      yearCounts.set(y, (yearCounts.get(y) ?? 0) + 1);
    }
  }
  const years = [...yearCounts.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }));

  const shownChunks = notes.reduce((s, n) => s + n.k, 0);
  return {
    mounted: true,
    totalPages: parsed.length,
    totalChunks,
    shownChunks,
    wikilinks: links.length,
    statusLine: `${parsed.length} pages · brain-store mounted`,
    clusters,
    notes,
    links,
    pages,
    freshPct,
    stalePct,
    years,
  };
}

/** Server entry — reads the live store (GBRAIN_STORE / ~/knowledge/brain-store). */
export function loadObservatoryData(): ObservatoryData {
  const storePath = brainStoreDir();
  const raw = readStoreNotes();
  const mtimes = new Map<string, number>();
  for (const n of raw) {
    try {
      const slug = n.path.replace(/\.md$/, '');
      mtimes.set(slug, fs.statSync(path.join(storePath, n.path)).mtimeMs);
    } catch {
      // stat failed — page just has no freshness data
    }
  }
  return buildObservatoryData(raw, { mtimes });
}
