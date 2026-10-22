'use client';

import { useEffect, useState } from 'react';
import { OBtn } from '@/components/creative-engine/skin';
import { createPortal } from 'react-dom';
import { clampPopover } from '@/lib/creative-engine/workflow-edit';

/**
 * Coach marks (S05b FR-48): three hints in sequence, each anchored to the
 * real element it explains, shown once per viewer (localStorage
 * `ae-wf-coach`). They never block the canvas: the card takes the pointer,
 * nothing else does. "Next" moves on, "Skip all" ends them; "Show tips
 * again" in the shortcuts sheet clears the flag. A step whose element is not
 * on screen (no link yet) waits until it is.
 */

export const COACH_KEY = 'ae-wf-coach';

export const COACH_STEPS: { selector: string; text: string }[] = [
  { selector: '[data-out-port] i', text: 'Drag from a right-side dot to a left-side dot to link nodes.' },
  { selector: '.ae-o-wf-hit', text: 'Click a link to select it; Delete removes it. Drop a new link on a used input to replace it.' },
  { selector: '[data-run-button]', text: "Run sends every paid node to Arcads. You'll see the cost first." },
];

export function Coach({ step, scope, container, onNext, onSkip }: { step: number; scope: Element | null; container: Element; onNext: () => void; onSkip: () => void }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const s = COACH_STEPS[step];
  useEffect(() => {
    if (!s || !scope) return;
    let raf = 0;
    const tick = () => {
      const el = scope.querySelector(s.selector);
      const r = el?.getBoundingClientRect() ?? null;
      setRect((old) => (r && (!old || Math.abs(old.x - r.x) > 0.5 || Math.abs(old.y - r.y) > 0.5 || old.width !== r.width) ? r : r ? old : null));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s, scope]);
  if (!s || !rect || rect.width === 0) return null;
  const W = 260; const H = 104;
  const anchor = { x: rect.left + rect.width / 2 - 20, y: rect.bottom + 10 };
  const pos = clampPopover(anchor, { w: W, h: H }, { w: window.innerWidth, h: window.innerHeight });
  return createPortal(
    <div className="ae-o-wf-coach" role="dialog" aria-label={`Tip ${step + 1} of ${COACH_STEPS.length}`} style={{ left: pos.x, top: pos.y, width: W }} onPointerDown={(e) => e.stopPropagation()}>
      <i className="ring" aria-hidden style={{ left: rect.left - pos.x - 4, top: rect.top - pos.y - 4, width: rect.width + 8, height: rect.height + 8 }} />
      <div className="tx">{s.text}</div>
      <div className="ft">
        <span>{step + 1} of {COACH_STEPS.length}</span>
        <OBtn kind="pill" cls="ae-o-pill"  onClick={onSkip}>Skip all</OBtn>
        <OBtn kind="pill" cls="ae-o-pill"  data-primary onClick={onNext}>{step + 1 === COACH_STEPS.length ? 'Done' : 'Next'}</OBtn>
      </div>
    </div>,
    container,
  );
}
