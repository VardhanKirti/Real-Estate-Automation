'use client';

import { History as HistoryIcon, X } from 'lucide-react';
import { OBtn } from '@/components/creative-engine/skin';
import type { WorkflowVersion } from '@/lib/creative-engine/store';

/**
 * Version history (S05b FR-63): the side list. Each version can be
 * previewed (the canvas shows it read-only under a banner) or restored
 * (one history step; the server saves the current design first).
 */

const time = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const REASON: Record<WorkflowVersion['reason'], string> = { run: 'Run', save: 'Saved', restore: 'Before restore' };

export function VersionsPanel({ versions, loading, previewing, readOnly, onPreview, onRestore, onSave, onClose }: { versions: WorkflowVersion[]; loading: boolean; previewing: number | null; readOnly: boolean; onPreview: (v: WorkflowVersion) => void; onRestore: (v: WorkflowVersion) => void; onSave: () => void; onClose: () => void }) {
  return (
    <div className="ae-o-wf-sheet ae-o-wf-versions" role="complementary" aria-label="Version history" onPointerDown={(e) => e.stopPropagation()}>
      <h4><span className="ae-o-node-icon" style={{ width: 22, height: 22 }}><HistoryIcon className="h-3.5 w-3.5" strokeWidth={2.2} /></span><span className="flex-1">Version history</span><OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={onClose} title="Close" aria-label="Close version history"><X className="h-4 w-4" strokeWidth={2} /></OBtn></h4>
      <div className="hint">Every Run saves one, and so does Save version (Cmd/Ctrl+S). Autosave doesn&apos;t. The last 30 are kept.</div>
      {!readOnly && <OBtn kind="pill" cls="ae-o-pill self-start" keep="self-start"  onClick={onSave}>Save version now</OBtn>}
      {loading ? <div className="hint">Loading</div> : versions.length === 0 ? <div className="hint">No versions yet. Run the workflow or save one.</div> : (
        <ul>
          {versions.map((v) => (
            <li key={v.n} data-on={previewing === v.n || undefined}>
              <div className="t"><b>v{v.n}</b> · {REASON[v.reason]} · {time(v.at)} · {v.nodes.length} node{v.nodes.length === 1 ? '' : 's'}</div>
              {v.note && <div className="nt">{v.note}</div>}
              <div className="act">
                <OBtn kind="pill" cls="ae-o-pill"  onClick={() => onPreview(v)} aria-pressed={previewing === v.n}>Preview</OBtn>
                {!readOnly && <OBtn kind="pill" cls="ae-o-pill"  onClick={() => onRestore(v)}>Restore</OBtn>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
