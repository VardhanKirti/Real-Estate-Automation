'use client';

import { useMemo } from 'react';
import { ChevronRight, CornerLeftUp, Lock, RefreshCw } from 'lucide-react';
import {
  GButton, GCard, GCardRaised, GChip, GDrawer, GEmpty, GErrorLine, GList, GProgress, GRow, GSearch, GSectionHeader, GTable, GTreemap,
  type GColumn, type TreemapBlock, type TreemapKind,
} from '@/components/g';
import type { DbNode } from '@/lib/database/scan';
import { KINDS, dominant, fmtBytes, kindOf, pct, useBrainFiles, type Kind, type Tree } from './DatabaseExplorer';

/**
 * Brain Files under the GladOS style (SPEC S05 F05.20 to F05.24): the same
 * navigation, filter, search, preview and rescan as the Classic explorer
 * (shared through useBrainFiles), drawn from the kit. Kind chips are real
 * filters (H38): a pinned kind dims other blocks and filters the table.
 * Table rows drill in exactly like the blocks, so map and table stay in step.
 */

const MAP_H = 480;

/** Kind → categorical slot (X2 --g-cat-*): fixed, never cycled. */
const KIND_SLOT: Record<Kind, TreemapKind['color']> = {
  docs: 'cat-1', video: 'cat-2', image: 'cat-3', audio: 'cat-4', code: 'cat-5', data: 'cat-6', system: 'muted', other: 'cat-8',
};
const G_KINDS: TreemapKind[] = KINDS.map((k) => ({ id: k.id, label: k.label, color: KIND_SLOT[k.id] }));

export function DatabaseHeaderStats({ total, files, root }: { total: number; files: number; root: string }) {
  return (
    <>
      {fmtBytes(total)} · {files.toLocaleString()} files ·{' '}
      <span className="kg-mono-inline" data-mono-ok="">
        {root}
      </span>
    </>
  );
}

export function DatabaseG({ initial }: { initial: Tree }) {
  const s = useBrainFiles(initial, MAP_H);
  const { data, focusPath, stack, setStack, selected, setSelected, preview, query, setQuery, busy, pinned, setPinned, hl, box, width, mix, focus, viewItems, viewSize, total, blocks, go, up, open, openRest, rescan, matches, jump, crumbs, listItems } = s;
  const atRoot = !focusPath && stack.length === 0;

  const tmBlocks: TreemapBlock[] = useMemo(
    () =>
      blocks.map((b, i) => {
        if (!b.node) {
          return { id: `rest-${i}`, label: `${b.restCount} smaller items`, value: b.w * b.h, kind: 'other', sub: fmtBytes(b.restSize ?? 0), rest: true };
        }
        const m = mix.get(b.node.path)!;
        return {
          id: b.node.path,
          label: b.node.dir ? `${b.node.name}/` : b.node.name,
          value: b.w * b.h,
          kind: dominant(m),
          sub: `${fmtBytes(b.node.size)} · ${pct(b.node.size, total)}`,
          mix: b.node.dir ? m : undefined,
        };
      }),
    [blocks, mix, total],
  );
  const onBlock = (id: string) => {
    if (id.startsWith('rest-')) return openRest();
    const n = viewItems.find((c) => c.path === id);
    if (n) open(n);
  };

  const viewMix = s.viewMix;
  const chips = KINDS.filter((k) => viewMix[k.id] > 0 || k.id === pinned).sort((a, b) => viewMix[b.id] - viewMix[a.id]);

  const columns: GColumn<DbNode>[] = [
    {
      key: 'name',
      label: atRoot ? 'Folder' : 'Item',
      sortValue: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="kg-cell-name" title={r.path}>
          <i className="kg-swatch" style={{ background: `var(--g-${KIND_SLOT[dominant(mix.get(r.path)!)]})` }} aria-hidden="true" />
          <span className="kg-trunc">
            {r.name}
            {r.dir ? '/' : ''}
          </span>
        </span>
      ),
    },
    { key: 'size', label: 'Size', numeric: true, sortValue: (r) => r.size, render: (r) => fmtBytes(r.size) },
    // At the root "% here" equals "% brain", so only one shows (F05.23).
    ...(atRoot ? [] : [{ key: 'here', label: '% here', numeric: true, sortValue: (r: DbNode) => r.size, render: (r: DbNode) => pct(r.size, viewSize) }]),
    { key: 'brain', label: '% brain', numeric: true, sortValue: (r) => r.size, render: (r) => pct(r.size, total) },
  ];

  return (
    <div className="kg-section">
      <div className="kg-db-tools">
        <div className="kg-db-search">
          <GSearch value={query} onValueChange={setQuery} size="md" placeholder="Find a file or folder" aria-label="Find a file or folder" />
          {matches.length > 0 && (
            <GCardRaised p={16} className="kg-db-results">
              <GList label="Matches">
                {matches.map((m) => (
                  <GRow key={m.path} title={`${m.path}${m.dir ? '/' : ''}`} trailing={fmtBytes(m.size)} onClick={() => jump(m)} hint={m.path} />
                ))}
              </GList>
            </GCardRaised>
          )}
        </div>
        <GButton variant="sm" onClick={rescan} busy={busy}>
          <RefreshCw size={13} strokeWidth={1.8} aria-hidden="true" /> Rescan
        </GButton>
      </div>
      {data.truncated && <GErrorLine align="left">Large folder: the map stops at 60,000 entries.</GErrorLine>}

      <GCard as="section" p={20} className="kg-db" aria-label="Brain block map">
        <div className="kg-db-nav">
          <nav aria-label="Folder path" className="kg-crumbs">
            <GButton variant="sm" size="compact" onClick={() => go('')} aria-current={atRoot ? 'page' : undefined}>
              {data.tree.name}/
            </GButton>
            {crumbs.map((c, i) => {
              const p = crumbs.slice(0, i + 1).join('/');
              const last = i === crumbs.length - 1 && !stack.length;
              return (
                <span key={p} className="kg-crumb">
                  <ChevronRight size={12} strokeWidth={1.8} aria-hidden="true" />
                  <GButton variant="sm" size="compact" onClick={() => go(p)} aria-current={last ? 'page' : undefined}>
                    {c}/
                  </GButton>
                </span>
              );
            })}
            {stack.map((_, i) => (
              <span key={`rest-${i}`} className="kg-crumb">
                <ChevronRight size={12} strokeWidth={1.8} aria-hidden="true" />
                <GButton
                  variant="sm"
                  size="compact"
                  onClick={() => {
                    setStack((st) => st.slice(0, i + 1));
                    setSelected(null);
                  }}
                  aria-current={i === stack.length - 1 ? 'page' : undefined}
                >
                  Smaller items
                </GButton>
              </span>
            ))}
          </nav>
          {!atRoot && (
            <GButton variant="sm" size="compact" onClick={up} title="Up one level (Esc)">
              <CornerLeftUp size={13} strokeWidth={1.8} aria-hidden="true" /> Up
            </GButton>
          )}
        </div>
        <p className="kg-cap">
          {fmtBytes(viewSize)} here{atRoot ? '' : ` · ${pct(viewSize, total)} of the brain`} · {viewItems.length} item{viewItems.length === 1 ? '' : 's'} ·{' '}
          {viewItems.reduce((a, c) => a + c.files, 0).toLocaleString()} files
        </p>

        <div className="kg-chips kg-chips-scroll" role="group" aria-label="Filter by file type">
          {chips.map((k) => (
            <GChip
              key={k.id}
              pressed={pinned === k.id}
              onPressedChange={() => setPinned((h) => (h === k.id ? null : k.id))}
              title={pinned === k.id ? `Showing only items with ${k.label.toLowerCase()} · click to clear` : `Show only items with ${k.label.toLowerCase()}`}
            >
              <i className="kg-swatch" style={{ background: `var(--g-${KIND_SLOT[k.id]})` }} aria-hidden="true" />
              {k.label} <span className="kg-chip-sub">{fmtBytes(viewMix[k.id])}</span>
            </GChip>
          ))}
        </div>

        <div className="kg-db-grid">
          <div ref={box} className="kg-db-map">
            {width > 0 && (
              <GTreemap
                blocks={tmBlocks}
                kinds={G_KINDS}
                dimKinds={hl ? [hl] : null}
                onOpen={onBlock}
                height={MAP_H}
                label={`Block map of ${focus.name || 'the brain'}`}
                empty={<GEmpty inline title="This folder is empty" />}
              />
            )}
          </div>
          <div className="kg-db-table">
            <GSectionHeader size={22} title={stack.length ? 'Smaller items' : focusPath ? `${focus.name}/` : 'Top-level breakdown'} />
            {pinned && (
              <div className="kg-filter-line">
                <span className="kg-cap">
                  Showing {listItems.length} of {viewItems.length} with {KINDS.find((x) => x.id === pinned)!.label.toLowerCase()}
                </span>
                <GButton variant="sm" size="compact" onClick={() => setPinned(null)}>
                  Clear
                </GButton>
              </div>
            )}
            <div className="kg-db-table-scroll">
              <GTable
                columns={columns}
                rows={listItems}
                rowKey={(r) => r.path}
                caption="Items in this view, by size"
                onRowClick={open}
                rowLabel={(r) => (r.dir ? `Open folder ${r.name}` : `Read ${r.name}`)}
                empty={viewItems.length ? 'Nothing here of that type.' : 'Nothing in this folder.'}
              />
            </div>
          </div>
        </div>
      </GCard>

      <GDrawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.name ?? 'File'} width={520}>
        {selected && (
          <div className="kg-preview">
            <p className="kg-mono" data-mono-ok="">
              {selected.path}
            </p>
            <p className="kg-cap">
              {KINDS.find((k) => k.id === kindOf(selected.path, selected.name))!.label} · {fmtBytes(selected.size)} · {pct(selected.size, total)} · modified{' '}
              {new Date(selected.mtime).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
            {!preview ? (
              <GProgress text="Reading…" />
            ) : !preview.ok ? (
              <GEmpty kind="error" inline title="Could not read the file" body={preview.error} />
            ) : preview.kind === 'private' ? (
              <p className="kg-body">
                <Lock size={13} strokeWidth={1.8} aria-hidden="true" /> Private file: the contents stay on disk and are never shown here.
              </p>
            ) : preview.kind === 'binary' ? (
              <p className="kg-body">
                Not a text file, so there is no preview. Open it from {data.root}/{preview.path}.
              </p>
            ) : preview.kind === 'text' ? (
              <>
                <pre className="kg-pre" data-mono-ok="">
                  {preview.text}
                </pre>
                {preview.truncated && <p className="kg-cap">First 24 KB shown.</p>}
              </>
            ) : null}
          </div>
        )}
      </GDrawer>
    </div>
  );
}
