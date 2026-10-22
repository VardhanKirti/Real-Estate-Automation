'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { OBtn } from '@/components/creative-engine/skin';
import { createPortal } from 'react-dom';
import { clampPopover } from '@/lib/creative-engine/workflow-edit';

/**
 * A small menu for the builder (edge right-click, the port "×" list).
 * Portalled like the palette, clamped to the viewport, keyboard reachable:
 * ArrowUp/ArrowDown move, Enter or click runs, Escape (via the builder's
 * Escape layer) closes, a press outside closes.
 */

export type MenuItem = { label: string; hint?: string; danger?: boolean; checked?: boolean; disabled?: boolean; /** a heading row above this item */ section?: string; onSelect: () => void };

export function ContextMenu({ at, label, items, container, onClose, wide = false }: { at: { x: number; y: number }; label: string; items: MenuItem[]; container: Element; onClose: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 220, h: 40 + items.length * 32 });
  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (r) setSize({ w: r.width, h: r.height });
    root.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);
  const pos = clampPopover(at, size, { w: window.innerWidth, h: window.innerHeight });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };
  return createPortal(
    <div ref={root} className="ae-o-wf-menu" data-wide={wide || undefined} role="menu" aria-label={label} style={{ left: pos.x, top: pos.y }} onKeyDown={onKey} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <div key={i} role="none" className="contents">
          {it.section && <div className="sec" role="presentation">{it.section}</div>}
          <OBtn kind="row" role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={it.checked} disabled={it.disabled} data-danger={it.danger || undefined} data-checked={it.checked || undefined} onClick={() => { onClose(); it.onSelect(); }}>
            <span>{it.label}</span>{it.hint && <small>{it.hint}</small>}
          </OBtn>
        </div>
      ))}
    </div>,
    container,
  );
}
