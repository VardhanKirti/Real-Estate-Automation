'use client';
/**
 * Sheet (02 section 13): a right panel (bottom sheet on phones) that grows from the element that opened it.
 * The motion lives in motion/useFlipSheet.ts; this file holds no duration or easing literal (AC-02-46).
 * The Sheet does not touch the URL; the page owns ?post= and friends (01).
 *
 * `kind` stays an inline union (no named declaration): importing 01's SheetKind would pull lib/lab/view
 * into the /lab-frames import graph, which AC-02-43 forbids. tests/lab-v2-sheet-kind.test.ts proves the
 * union equals SheetKind.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { RoundButton } from './ActionPill';
import { flipClose, flipOpen, sharedElement, type FlipParts } from './motion/useFlipSheet';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type SheetProps = {
  kind: 'post' | 'event' | 'idea' | 'script' | 'test' | 'setup' | 'ask';
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  caption?: ReactNode;
  originId?: string | null;
  footer?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Header controls left of Close (Copy link, a status chip). U1 slot. */
  actions?: ReactNode;
  /** Inner tabs under the header (01 13.5, Setup's section tabs). U1 slot. */
  tabs?: ReactNode;
  children?: ReactNode;
};

/** The DOMRect of [data-lab-shared="<id>"] when the id is set, read at open time. */
export function useSharedOrigin(originId: string | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    setRect(sharedElement(originId)?.getBoundingClientRect() ?? null);
  }, [originId]);
  return rect;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({ kind, open, onClose, title, caption, originId, footer, busy, error, onRetry, actions, tabs, children }: SheetProps) {
  const km = useKitMark();
  const [mounted, setMounted] = useState(open);
  const layer = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLSpanElement>(null);
  const originEl = useRef<HTMLElement | null>(null);
  const tid = useId();

  const parts = (): FlipParts | null =>
    layer.current && panel.current && content.current && scrim.current
      ? { layer: layer.current, panel: panel.current, content: content.current, scrim: scrim.current }
      : null;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const focusBack = useRef<HTMLElement | null>(null);
  // Open: capture the origin, focus the close button, run the FLIP.
  useLayoutEffect(() => {
    if (!open || !mounted) return;
    originEl.current = sharedElement(originId);
    closeBtn.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
    const p = parts();
    if (p) void flipOpen(p, originEl.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // Close: animate back, unmount, return focus.
  useEffect(() => {
    if (open || !mounted) return;
    let live = true;
    const p = parts();
    const origin = sharedElement(originId) ?? originEl.current;
    (p ? flipClose(p, origin) : Promise.resolve()).then(() => {
      if (!live) return;
      focusBack.current = origin && document.contains(origin) ? origin : document.querySelector<HTMLElement>('h1');
      setMounted(false);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // Focus goes back once the unmount has committed: the page behind is inert until the inert effect's
  // cleanup runs, and a focus() on an inert element is dropped (AC-02-28, AC-03-27). Passive effect
  // cleanups run before new effects in the same commit, so the opener is focusable here; a frame
  // callback could run before React commits and land focus on <body>.
  useEffect(() => {
    if (mounted) return;
    const back = focusBack.current;
    focusBack.current = null;
    if (back && document.contains(back)) back.focus?.({ preventScroll: true });
  }, [mounted]);

  // The page behind is inert while the sheet is up.
  useEffect(() => {
    const el = layer.current;
    if (!mounted || !el?.parentElement) return;
    const sibs = [...el.parentElement.children].filter((c) => c !== el && !c.hasAttribute('inert')) as HTMLElement[];
    sibs.forEach((s) => s.setAttribute('inert', ''));
    return () => sibs.forEach((s) => s.removeAttribute('inert'));
  }, [mounted]);

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => !x.hasAttribute('inert'));
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  if (!mounted) return null;
  return (
    <div ref={layer} className="lab2-sheet-layer" data-lab="Sheet" {...km('LabSheet')} data-kind={kind} data-open={open ? '' : undefined}>
      <div ref={scrim} className="lab2-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className="lab2-sheet lab2-glass"
        data-tone="strong"
        data-radius="sheet"
        data-blur="on"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tid}
        onKeyDown={onKey}
      >
        <div ref={content} className="lab2-sheet-content">
          <header className="lab2-sheet-head">
            <span className="lab2-sheet-titles">
              <h2 id={tid} className="lab2-sheet-title" data-lab-ink="">{title}</h2>
              {caption && <span className="lab2-sheet-cap" data-lab-ink="">{caption}</span>}
            </span>
            <span className="lab2-sheet-tools">
              {actions}
              <span ref={closeBtn}><RoundButton label="Close" icon="close" onClick={onClose} /></span>
            </span>
          </header>
          {tabs && <div className="lab2-sheet-tabs">{tabs}</div>}
          {busy && <span className="lab2-sheet-busy" aria-hidden="true" />}
          <div className="lab2-sheet-body">
            {error ? (
              <p className="lab2-sheet-error" data-lab-ink="">
                Could not load this. Try again.
                {onRetry && <button type="button" className="lab2-pill" onClick={onRetry}>Retry</button>}
              </p>
            ) : (
              children
            )}
          </div>
          {footer && <footer className="lab2-sheet-foot">{footer}</footer>}
        </div>
      </div>
    </div>
  );
}
