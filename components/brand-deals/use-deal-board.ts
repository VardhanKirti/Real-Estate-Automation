'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chainDepthBucket, pollStatus, type ChainDepthBucket, type DealFilter } from '@/lib/brand-deals-view';
import type { BrandDealsSnapshot, Deal } from '@/lib/brand-deals';

/**
 * The Brand Deals board's state and actions (glados-ui SPEC S02 FR-B1, FR-B5,
 * FR-B7): the 30 s poll and its freshness pill, the stage, slash-token, text
 * and chain-depth filters, and the drawer's POST actions. The GladOS tree
 * (DealBoardG) renders from it; the Classic DealBoard keeps its own copy of
 * the same logic so its markup stays byte-for-byte (AC00.18).
 */

export const SLASH_TOKENS: Record<string, DealFilter> = {
  '/unique': 'unique',
  '/approval': 'approval',
  '/won': 'won',
  '/lost': 'lost',
};

export function matchesFilter(d: Deal, f: DealFilter): boolean {
  if (f === 'all') return true;
  if (f === 'unique') return d.tag === 'UNIQUE';
  if (f === 'won' || f === 'lost') return d.outcome === f;
  if (f === 'closed') return d.stage === 'closed';
  return d.stage === f;
}

/** Split a filter query into its leading slash token (if any) and the text. */
export function parseDealQuery(query: string): { token: string | null; tokenFilter: DealFilter | null; text: string } {
  const q = query.trim();
  const token = q.startsWith('/') ? q.split(/\s+/)[0] : null;
  const text = (token ? q.slice(token.length) : q).trim().toLowerCase();
  return { token, tokenFilter: token ? (SLASH_TOKENS[token] ?? null) : null, text };
}

export function filterDeals(deals: Deal[], stage: DealFilter, query: string, depth: ChainDepthBucket | null): Deal[] {
  const { tokenFilter, text } = parseDealQuery(query);
  return deals.filter((d) => {
    if (!matchesFilter(d, stage)) return false;
    if (tokenFilter && !matchesFilter(d, tokenFilter)) return false;
    if (depth && chainDepthBucket(d.chainLen) !== depth) return false;
    if (text) {
      const hay = `${d.brand} ${d.email} ${d.subject} ${d.tagReason} ${d.summary ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

export function useDealBoard(initial: BrandDealsSnapshot) {
  const [snap, setSnap] = useState(initial);
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState(false);
  const [now, setNow] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<DealFilter>('all');
  const [depth, setDepth] = useState<ChainDepthBucket | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      const r = await fetch('/api/brand-deals');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSnap(await r.json());
      setLastOkAt(Date.now());
      setLastError(false);
    } catch {
      setLastError(true); // keep the last good snapshot, say the update failed
    } finally {
      pending.current = false;
    }
  }, []);

  /** POST an action; adopt the fresh snapshot the API returns. */
  const act = useCallback(async (key: string, url: string, payload: unknown): Promise<boolean> => {
    setBusy(key);
    setNotice(null);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await r.json();
      if (body.snapshot) setSnap(body.snapshot);
      if (!body.ok) setNotice(body.error ?? 'action failed');
      return Boolean(body.ok);
    } catch (e) {
      setNotice(String(e));
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  /** GET the editable draft body for a deal. */
  const loadDraft = useCallback(async (id: string): Promise<string | null> => {
    setBusy('draft-load');
    setNotice(null);
    try {
      const r = await fetch(`/api/brand-deals/draft?id=${encodeURIComponent(id)}`);
      const b = await r.json();
      if (b.ok) return b.draft.body as string;
      setNotice(b.error || 'could not load the draft');
      return null;
    } catch (e) {
      setNotice(String(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // One-second clock for the "Updated n s ago" pill; the server just rendered `initial`.
  useEffect(() => {
    const start = Date.now();
    setLastOkAt((v) => v ?? start);
    setNow(start);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const filtered = filterDeals(snap.deals, stageFilter, query, depth);
  const selected = snap.deals.find((d) => d.id === selectedId) ?? null;

  return {
    snap,
    poll: pollStatus(lastOkAt, now, lastError),
    now,
    refresh,
    act,
    loadDraft,
    busy,
    notice,
    setNotice,
    query,
    setQuery,
    stageFilter,
    setStageFilter,
    depth,
    setDepth,
    filtered,
    selected,
    selectedId,
    setSelectedId,
  };
}
