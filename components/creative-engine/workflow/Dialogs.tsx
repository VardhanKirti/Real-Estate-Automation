'use client';

import { useId, type ReactNode } from 'react';
import { OBtn, OLink } from '@/components/creative-engine/skin';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialog } from '@/components/ui/use-dialog';

/**
 * The builder's modal pieces on the shared dialog behaviour (X1 useDialog):
 * focus moves in and back, Tab is trapped, page scroll locks, and Escape
 * closes only this layer. Both portal to the console root (or the full-screen
 * layer), because the builder sits under a transformed ancestor that would
 * trap a fixed overlay.
 */

export function ConfirmDialog({ title, body, cancelLabel = 'Cancel', confirmLabel, danger = false, container, onConfirm, onCancel }: {
  title: string;
  body: ReactNode;
  cancelLabel?: string;
  confirmLabel: string;
  danger?: boolean;
  container: Element;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dlg = useDialog({ open: true, onClose: onCancel, labelledBy: titleId });
  return createPortal(
    <div className="ae-o-gate" onClick={onCancel}>
      <div {...dlg.props} className="ae-o-panel w-full max-w-[420px] p-6" onClick={(e) => e.stopPropagation()}>
        <div id={titleId} className="text-[16px] font-medium">{title}</div>
        <div className="mt-3 text-[13px] text-[var(--o-muted)]">{body}</div>
        <div className="mt-5 flex justify-end gap-3">
          <OBtn kind="pill" cls="ae-o-pill" data-dialog-close onClick={onCancel} >{cancelLabel}</OBtn>
          <OBtn kind="pill" cls="ae-o-pill" onClick={onConfirm}  style={danger ? { background: 'var(--o-red-fill)', color: 'var(--o-red-text)' } : undefined}>{confirmLabel}</OBtn>
        </div>
      </div>
    </div>,
    container,
  );
}

export type LightboxAsset = { kind: 'image' | 'video'; path: string; label: string };

/** A node's delivered output at full size (S05b FR-65, Q-WF-5 default: an in-console lightbox). */
export function Lightbox({ asset, container, onClose }: { asset: LightboxAsset; container: Element; onClose: () => void }) {
  const titleId = useId();
  const dlg = useDialog({ open: true, onClose, labelledBy: titleId });
  return createPortal(
    <div className="ae-o-gate ae-o-wf-lightbox" onClick={onClose}>
      <div {...dlg.props} className="ae-o-panel" onClick={(e) => e.stopPropagation()}>
        <div className="hd">
          <span id={titleId}>{asset.label}</span>
          <OLink cls="ae-o-pill" href={asset.path} external>Open file</OLink>
          <OBtn kind="icon-sm" cls="ae-o-icon sm"  data-dialog-close aria-label="Close the preview" title="Close (Esc)" onClick={onClose}><X className="h-4 w-4" strokeWidth={2} /></OBtn>
        </div>
        {asset.kind === 'video' ? <video src={asset.path} controls autoPlay muted playsInline /> : <img src={asset.path} alt={asset.label} />}
      </div>
    </div>,
    container,
  );
}
