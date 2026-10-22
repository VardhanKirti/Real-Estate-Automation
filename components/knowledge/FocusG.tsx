'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { GButton, GKeyValue, GWell } from '@/components/g';
import type { EdgeKind, KIEdge, KIEntity } from '@/lib/knowledge-index';
import type { NodeMetrics } from '@/lib/knowledge-metrics';
import { EDGE_HINT, EDGE_LABEL, KIND_LABEL, interpret } from '@/lib/knowledge-views';

/**
 * A record's panel under the GladOS style (S05 F05.33): what it is, what its
 * numbers mean in words, and every connection grouped by how it is known,
 * each carrying its evidence. Hosted in a docked GDrawer by KnowledgeG.
 */

const ORDER: EdgeKind[] = ['link', 'owns', 'mention', 'similar'];
const LIST_CAP = 24;

export function FocusG({ entity, metrics, edges, entities, sortedPr, medianDegree, onFocus, color, catOf, edgeColor }: {
  entity: KIEntity;
  metrics: Map<string, NodeMetrics>;
  edges: KIEdge[];
  entities: KIEntity[];
  sortedPr: number[];
  medianDegree: number;
  onFocus: (id: string) => void;
  color: string;
  catOf: (kind: string) => string;
  edgeColor: (k: EdgeKind) => string;
}) {
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const m = metrics.get(entity.id)!;
  const [openKind, setOpenKind] = useState<EdgeKind | null | undefined>(undefined);
  const connections = useMemo(() => {
    const out = new Map<EdgeKind, { other: KIEntity; edge: KIEdge }[]>();
    for (const e of edges) {
      if (e.a !== entity.id && e.b !== entity.id) continue;
      const other = byId.get(e.a === entity.id ? e.b : e.a);
      if (!other) continue;
      (out.get(e.kind) ?? out.set(e.kind, []).get(e.kind)!).push({ other, edge: e });
    }
    for (const list of out.values()) list.sort((a, b) => b.edge.weight - a.edge.weight);
    return out;
  }, [edges, entity.id, byId]);
  const total = [...connections.values()].reduce((s, l) => s + l.length, 0);
  const biggest = ORDER.filter((k) => (connections.get(k)?.length ?? 0) > 0).sort((a, b) => (connections.get(b)?.length ?? 0) - (connections.get(a)?.length ?? 0))[0] ?? null;
  const effective = openKind === undefined ? biggest : openKind;

  const stats = [
    { label: 'Connections', value: String(m.degree), title: 'Total edges touching this record' },
    { label: 'Written', value: String(m.authoredDegree), title: 'Edges a person actually wrote, excluding inferred similarity' },
    { label: 'Authority', value: (m.pagerank * 1000).toFixed(1), title: 'PageRank ×1000: how much of the graph flows through here' },
    { label: 'Brokerage', value: String(Math.round(m.betweenness)), title: 'Shortest paths between other records that pass through this one' },
    ...(entity.days !== null ? [{ label: 'Last edited', value: `${entity.days}d ago`, title: 'Days since the file was last modified' }] : []),
    ...(entity.words > 0 ? [{ label: 'Words', value: entity.words.toLocaleString('en-US'), title: 'Body length of the record' }] : []),
  ];

  return (
    <div className="kg-focus">
      <p className="kg-cap kg-focus-kind">
        <i className="kg-swatch" style={{ background: color }} aria-hidden="true" /> {KIND_LABEL[entity.kind] ?? entity.kind} · {entity.cluster}
      </p>
      {entity.summary && <p className="kg-body">{entity.summary}</p>}
      <GWell className="kg-focus-read">
        <p>{interpret(entity, m, { sortedPr, medianDegree })}</p>
      </GWell>
      <GKeyValue items={stats.map((s) => ({ key: s.label, label: s.label, value: s.value, title: s.title }))} />
      {entity.terms.length > 0 && (
        <div className="kg-stack-sm">
          <span className="kg-cap">What it is about (most distinctive terms)</span>
          <p className="kg-body">{entity.terms.join(' · ')}</p>
        </div>
      )}
      {entity.source && (
        <div className="kg-stack-sm">
          <span className="kg-cap">Source</span>
          <p className="kg-mono" data-mono-ok="">
            {entity.source}
          </p>
        </div>
      )}
      <div className="kg-stack-sm">
        <span className="kg-cap">{total} connections, grouped by how we know</span>
        {ORDER.map((k) => {
          const list = connections.get(k);
          if (!list?.length) return null;
          const open = effective === k;
          return (
            <div key={k} className="kg-conn-group">
              <GButton variant="sm" className="kg-group-toggle" aria-expanded={open} onClick={() => setOpenKind(open ? null : k)} title={EDGE_HINT[k]}>
                <i className="kg-edge-swatch" style={{ background: edgeColor(k) }} aria-hidden="true" />
                <span className="kg-cat-label">{EDGE_LABEL[k]}</span>
                <span className="kg-chip-sub">{list.length}</span>
                <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" className="kg-chev" data-open={open || undefined} />
              </GButton>
              {open && (
                <ul className="kg-evidence">
                  {list.slice(0, LIST_CAP).map(({ other, edge }, i) => (
                    <li key={`${other.id}-${i}`}>
                      <GButton variant="sm" className="kg-evidence-btn" onClick={() => onFocus(other.id)}>
                        <span className="kg-evidence-name">
                          <i className="kg-swatch" style={{ background: catOf(other.kind) }} aria-hidden="true" />
                          <span className="kg-trunc">{other.label}</span>
                        </span>
                        <span className="kg-evidence-text">{edge.evidence.length > 150 ? `${edge.evidence.slice(0, 149)}…` : edge.evidence}</span>
                      </GButton>
                    </li>
                  ))}
                  {list.length > LIST_CAP && <li className="kg-cap">+{list.length - LIST_CAP} more</li>}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
