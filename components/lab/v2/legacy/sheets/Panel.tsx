'use client';
/**
 * The Lab sheet as a FounderOS panel (pages/lab.md: "scrim fade, panel glide bn-panel-in, 1px border
 * radius 12"). Same contract as the shared Sheet (02 13): the page owns the URL, this only draws. One
 * dialog (components/ui/use-dialog: role, focus in and back, Tab trap, the one Escape stack, scroll lock),
 * the page behind inert while it is up, and a short glide out on close (none under reduced motion).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '@/components/ui/use-dialog';
import { prefersReducedMotion } from '@/components/lab/v2/shared/motion/useReducedMotion';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { Btn } from '../parts';

export type PanelProps = {
  kind: 'post' | 'event' | 'idea' | 'script' | 'test' | 'setup' | 'ask';
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  caption?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  error?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
};

const OUT_MS = 200;

export function Panel({ kind, open, onClose, title, caption, footer, busy, error, onRetry, children }: PanelProps) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const tid = useId();
  const dlg = useDialog<HTMLDivElement>({ open: mounted && !closing, onClose, labelledBy: tid });

  useEffect(() => {
    if (open) { setMounted(true); setClosing(false); return; }
    if (!mounted) return;
    if (prefersReducedMotion()) { setMounted(false); return; }
    setClosing(true);
    const t = window.setTimeout(() => { setMounted(false); setClosing(false); }, OUT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The page behind is inert while the panel is up.
  useEffect(() => {
    const el = layer.current;
    if (!mounted || !el?.parentElement) return;
    const sibs = [...el.parentElement.children].filter((c) => c !== el && !c.hasAttribute('inert')) as HTMLElement[];
    sibs.forEach((s) => s.setAttribute('inert', ''));
    return () => sibs.forEach((s) => s.removeAttribute('inert'));
  }, [mounted]);

  if (!mounted) return null;
  return (
    <div ref={layer} data-l="LabSheet" className="l-lab-sheet-layer" data-kind={kind} data-closing={closing ? '' : undefined}>
      <div className="l-lab-scrim" onClick={onClose} aria-hidden="true" />
      <div {...dlg.props} data-l="Panel" className="l-lab-sheet">
        <header className="l-lab-sheet-head">
          <span className="l-lab-sheet-titles">
            <h2 id={tid} className="l-lab-sheet-title">{title}</h2>
            {caption && <span className="l-lab-sheet-cap">{caption}</span>}
          </span>
          <button type="button" data-dialog-close="" data-l="Pressable" data-lens="c" className="l-pressable is-dark l-btn-icon l-btn-icon-sm" onClick={onClose} aria-label={C.close}>
            <X size={14} strokeWidth={1.7} aria-hidden />
          </button>
        </header>
        {busy && <span className="l-lab-sheet-busy" aria-hidden="true" />}
        <div className="l-lab-sheet-body">
          {error ? (
            <div className="l-lab-state">
              <p className="l-lab-state-text">{C.sectionError}{error}</p>
              {onRetry && <Btn onClick={onRetry}>{C.retry}</Btn>}
            </div>
          ) : (
            children
          )}
        </div>
        {footer && <footer className="l-lab-sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}
