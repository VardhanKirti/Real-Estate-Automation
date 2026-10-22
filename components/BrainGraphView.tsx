'use client';

import dynamic from 'next/dynamic';
import type { ComponentProps } from 'react';
import type { KnowledgeGraph as KnowledgeGraphType } from '@/components/KnowledgeGraph';

/**
 * The graph engine is one of the heaviest client bundles in the app
 * (KnowledgeGraph alone is ~114KB of source pulling d3-force). It loads
 * lazily, client-only, behind a dimension-matched skeleton so /brain's first
 * paint ships without it and nothing shifts when it hydrates.
 */
const KnowledgeGraph = dynamic(() => import('@/components/KnowledgeGraph').then((m) => m.KnowledgeGraph), {
  ssr: false,
  loading: () => (
    // mirrors the graph's settled footprint: 680px canvas + directory aside
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="h-[680px] min-w-0 flex-1 animate-pulse rounded-lg-t border border-os-border bg-os-surface" />
      <div className="hidden shrink-0 rounded-lg-t border border-os-border bg-os-surface lg:block lg:h-[680px] lg:w-72" />
    </div>
  ),
});

/**
 * The /brain knowledge graph: the radial six-pillar wheel. The Neural view
 * was cut on 2026-10-09 (GladOS UI H34): its strand signs and weights were
 * hash-derived, not real signals. It lives in archive/neural-graph/. With one
 * view left there is no view switch.
 */
export function BrainGraphView(props: ComponentProps<typeof KnowledgeGraphType>) {
  return <KnowledgeGraph {...props} />;
}
