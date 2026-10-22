'use client';

import { CircleDollarSign, SquarePlus } from 'lucide-react';
import { OBtn } from '@/components/creative-engine/skin';
import { NODE_SPECS, type TemplateSummary } from '@/lib/creative-engine/workflow';
import type { NodeType } from '@/lib/creative-engine/schemas';
import { plural } from '@/lib/creative-engine/format';
import { NODE_ICON } from '@/components/creative-engine/workflow/icons';

/**
 * First-run guidance (S05b FR-45 to FR-47). With no workflow the stage shows
 * a start card: every template as a tile with its own mini diagram and the
 * paid requests one run makes, plus Blank canvas. "Start here" marks the
 * recommended tile (Script to talking actor when the campaign has an
 * approved script, otherwise Prompt, video, edit). An empty workflow shows
 * three quick-add chips instead.
 */

const NODE_W = 224;
const NODE_H = 120;

function MiniDiagram({ preview }: { preview?: TemplateSummary['preview'] }) {
  if (!preview?.nodes?.length) return <svg className="mini" viewBox="0 0 200 64" aria-hidden />;
  const minX = Math.min(...preview.nodes.map((n) => n.x)); const minY = Math.min(...preview.nodes.map((n) => n.y));
  const maxX = Math.max(...preview.nodes.map((n) => n.x + NODE_W)); const maxY = Math.max(...preview.nodes.map((n) => n.y + NODE_H));
  const pad = 16;
  return (
    <svg className="mini" viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      {preview.edges.map((e, i) => {
        const a = preview.nodes[e.from]; const b = preview.nodes[e.to];
        if (!a || !b) return null;
        const x1 = a.x + NODE_W; const y1 = a.y + NODE_H / 2; const x2 = b.x; const y2 = b.y + NODE_H / 2; const dx = Math.max(40, Math.abs(x2 - x1) / 2);
        return <path key={i} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} className="w" />;
      })}
      {preview.nodes.map((n, i) => <rect key={i} x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={22} className="n" style={{ fill: `var(${NODE_SPECS[n.type].tint})` }} />)}
    </svg>
  );
}

export function StartCard({ templates, approvedScript, busy, onPick, onScripter }: { templates: TemplateSummary[]; approvedScript: boolean; busy: boolean; onPick: (templateId?: string) => void; /** opens the Scripter, for a template that needs an approved script (edge case 12) */ onScripter?: () => void }) {
  const recommended = approvedScript ? 'script-ugc' : 'prompt-video-edit';
  return (
    <div className="ae-o-wf-start" role="region" aria-label="Start a workflow">
      <div className="hd"><b>Start a workflow</b><span>Pick a starting graph. Every node and link can be changed after.</span></div>
      <div className="tiles">
        {templates.map((t) => {
          const inner = (<>
            <MiniDiagram preview={t.preview} />
            <span className="nm">{t.name}{t.id === recommended && <em>Start here</em>}</span>
            <span className="ht">{t.needsScript ? 'Needs an approved script' : t.hint}</span>
            <span className="paid"><CircleDollarSign className="h-3 w-3" strokeWidth={2} />{t.paidRequests ? `${plural(t.paidRequests, 'paid request')} per run` : t.id === 'beats' ? 'One paid request per beat' : 'No paid requests'}</span>
          </>);
          // a template that needs an approved script can't be created yet: the tile says so and links to the Scripter
          if (t.needsScript) return (
            <div key={t.id} className="tile" data-off title="Needs an approved script: approve one in the Scripter first">
              {inner}
              {onScripter && <OBtn kind="pill" cls="ae-o-pill go"  onClick={onScripter}>Open the Scripter</OBtn>}
            </div>
          );
          return (
            <OBtn kind="row" cls="tile" keep="tile" key={t.id}  disabled={busy} data-start={t.id === recommended || undefined} onClick={() => onPick(t.id)} title={`Create "${t.name}"`}>{inner}</OBtn>
          );
        })}
        <OBtn kind="row" cls="tile blank" keep="tile blank"  disabled={busy} onClick={() => onPick(undefined)} title="An empty canvas">
          <span className="plus"><SquarePlus className="h-6 w-6" strokeWidth={1.6} /></span>
          <span className="nm">Blank canvas</span>
          <span className="ht">Place nodes yourself</span>
        </OBtn>
      </div>
    </div>
  );
}

const QUICK: NodeType[] = ['text', 'script', 'video'];

export function EmptyCanvas({ onAdd }: { onAdd: (t: NodeType) => void }) {
  return (
    <div className="ae-o-wf-empty" data-chips>
      <div>
        <div><b>Double-click</b> anywhere, or press <b>Add node</b>, to place your first node.</div>
        <div className="chips">
          {QUICK.map((t) => (
            <OBtn kind="pill" cls="ae-o-pill ae-o-wf-empty-act" key={t}  onClick={() => onAdd(t)}><span className="ae-o-node-icon" style={{ width: 18, height: 18 }}>{NODE_ICON[t]}</span>{t === 'script' ? 'Approved script' : NODE_SPECS[t].label}</OBtn>
          ))}
        </div>
      </div>
    </div>
  );
}
