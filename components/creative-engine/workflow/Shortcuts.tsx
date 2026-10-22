'use client';

import { useEffect, useRef } from 'react';
import { OBtn } from '@/components/creative-engine/skin';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * The shortcuts sheet (S05b FR-67), opened by the "?" bar button or the `?`
 * key. Lists the keyboard map and what Run does, and offers "Show tips
 * again" for the coach marks.
 */

const KEYS: [string, string][] = [
  ['Delete / Backspace', 'Delete the selected nodes or links'],
  ['Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, Ctrl+Y', 'Undo, redo'],
  ['Cmd/Ctrl+A', 'Select every node'],
  ['Shift+click, Shift+drag', 'Add to the selection, marquee select'],
  ['Cmd/Ctrl+C / V / D', 'Copy, paste, duplicate'],
  ['Cmd/Ctrl+K or /', 'Add a node at the centre'],
  ['Cmd/Ctrl+S', 'Save a version'],
  ['Cmd/Ctrl+Enter', 'Run (opens the cost check first)'],
  ['Arrows, Shift+Arrows', 'Nudge the selection 1 or 11 px'],
  ['Alt while dragging', 'Move without snapping to the grid'],
  ['F', 'Fit the selection, or everything'],
  ['0, +, −', 'Zoom to 100%, in, out'],
  ['Shift+F', 'Full screen on or off'],
  ['Enter', 'Open the settings of the selected node'],
  ['Space+drag, middle-drag', 'Pan from anywhere'],
  ['Esc', 'Close the innermost menu, sheet or selection'],
  ['?', 'This sheet'],
];

export function Shortcuts({ container, dry, onClose, onTips }: { container: Element; dry: boolean; onClose: () => void; onTips: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }, []);
  return createPortal(
    <div className="ae-o-gate" onClick={onClose}>
      <div ref={root} className="ae-o-panel ae-o-wf-keys w-full max-w-[560px] p-6" role="dialog" aria-modal="true" aria-labelledby="ae-wf-keys-title" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div id="ae-wf-keys-title" className="text-[16px] font-medium">Workflow builder keys</div><OBtn kind="icon-sm" cls="ae-o-icon sm"  onClick={onClose} aria-label="Close"><X className="h-4 w-4" strokeWidth={2} /></OBtn></div>
        <dl>{KEYS.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}</dl>
        <div className="about">
          <b>About Run.</b> Run checks the graph, then resolves local nodes (text, script, files, Claude, enhance, Deliver) in dependency order and sends each paid node to Arcads as its own request. Each paid node is charged separately when Arcads accepts it; the cost check lists them first. {dry ? 'This instance runs dry: paid nodes get placeholder outputs and nothing is charged.' : 'Run failed only re-sends just what failed; Stop stops tracking requests, but anything Arcads already accepted stays charged.'}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <OBtn kind="pill" cls="ae-o-pill"  onClick={onTips}>Show tips again</OBtn>
          <OBtn kind="pill" cls="ae-o-pill"  onClick={onClose}>Close</OBtn>
        </div>
      </div>
    </div>,
    container,
  );
}
