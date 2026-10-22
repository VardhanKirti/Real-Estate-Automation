'use client';

import { useEffect, useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { pushEscape } from '@/lib/escape-stack';

/**
 * Shared dialog behaviour (SPEC X1). One hook for every sheet, drawer,
 * dossier, confirm and gate:
 *
 *   const dlg = useDialog({ open, onClose, labelledBy: 'del-title' });
 *   {open && <div {...dlg.props} className="...">
 *     <h2 id="del-title">Delete campaign?</h2>
 *     <button data-dialog-close onClick={onClose}>Cancel</button>
 *   </div>}
 *
 * It sets role="dialog" and aria-modal, traps Tab inside the container,
 * moves focus in on open (initialFocus, else the close or Cancel button, else
 * the first focusable, else the container), returns focus to the opener on
 * close, locks body scroll (ref-counted, so stacked dialogs unlock once), and
 * registers with the one Escape stack so Escape closes only the top layer.
 */

export type UseDialogOptions = {
  open: boolean;
  onClose: () => void;
  /** id of the element that names the dialog (its heading). */
  labelledBy?: string;
  /** Element to focus on open. Default: the close or Cancel button. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Restore focus to the element that had it when the dialog opened. */
  returnFocus?: boolean;
  /** Lock page scroll while open. */
  lockScroll?: boolean;
  /** Stable id for the Escape stack (debugging, dedupe). Default: generated. */
  id?: string;
  /** Let Escape close this dialog. Default true. */
  closeOnEscape?: boolean;
};

export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where Tab should land, given `count` focusables and the index of the one
 * that has focus (-1 when focus is outside the dialog). Returns the index to
 * force-focus, or null to let the browser move focus normally.
 */
export function trapTabIndex(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

/** Close-ish label: what the default initial focus looks for. */
export function isCloseLabel(text: string | null | undefined): boolean {
  return /^\s*(close|cancel|dismiss|done)\b/i.test(text ?? '');
}

let scrollLocks = 0;
let savedOverflow = '';

/** Ref-counted body scroll lock. Returns the release (idempotent). */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
  };
}

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.closest('[inert]') && visible(el),
  );
}

function defaultFocusTarget(root: HTMLElement): HTMLElement {
  const marked = root.querySelector<HTMLElement>('[data-dialog-close]');
  if (marked && visible(marked)) return marked;
  const all = focusablesIn(root);
  const close = all.find(
    (el) => el.tagName === 'BUTTON' && (isCloseLabel(el.getAttribute('aria-label')) || isCloseLabel(el.textContent)),
  );
  return close ?? all[0] ?? root;
}

// useLayoutEffect warns during SSR; dialogs are client-only behaviour.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useDialog<T extends HTMLElement = HTMLDivElement>(opts: UseDialogOptions) {
  const {
    open,
    labelledBy,
    returnFocus = true,
    lockScroll = true,
    closeOnEscape = true,
  } = opts;
  const autoId = useId();
  const escapeId = opts.id ?? `dialog${autoId}`;
  const ref = useRef<T>(null);
  const onCloseRef = useRef(opts.onClose);
  onCloseRef.current = opts.onClose;
  const initialRef = useRef(opts.initialFocus);
  initialRef.current = opts.initialFocus;

  // Focus in on open, back to the opener on close.
  // The element to hand focus back to, captured outside the dialog, and a run
  // counter: React's development double-mount (StrictMode) runs the cleanup and
  // then the effect again on the same node. The second run must neither take the
  // dialog's own close button as the opener nor let the first cleanup move focus
  // out of a dialog that is still open.
  const openerRef = useRef<HTMLElement | null>(null);
  const runRef = useRef(0);
  useIsoLayoutEffect(() => {
    if (!open) return;
    const run = ++runRef.current;
    const root = ref.current;
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    if (!root || !active || !root.contains(active)) openerRef.current = active;
    if (root) {
      const target = initialRef.current?.current ?? defaultFocusTarget(root);
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    return () => {
      if (!returnFocus) return;
      // After the dialog unmounts, so a re-render cannot steal it back.
      queueMicrotask(() => {
        if (runRef.current !== run) return; // the effect ran again: the dialog is still open
        const opener = openerRef.current;
        if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [open, returnFocus]);

  useEffect(() => {
    if (!open || !lockScroll) return;
    return lockBodyScroll();
  }, [open, lockScroll]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    return pushEscape(() => onCloseRef.current(), { id: escapeId });
  }, [open, closeOnEscape, escapeId]);

  // Tab trap. Bound on the container so a nested dialog (inside this one's
  // DOM) handles Tab first and marks it handled.
  useEffect(() => {
    const root = ref.current;
    if (!open || !root) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const items = focusablesIn(root);
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = trapTabIndex(items.length, current, e.shiftKey);
      if (items.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      if (next !== null) {
        e.preventDefault();
        items[next].focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [open]);

  return {
    ref,
    escapeId,
    /** Spread on the dialog container. */
    props: {
      ref,
      role: 'dialog' as const,
      'aria-modal': true as const,
      'aria-labelledby': labelledBy,
      tabIndex: -1,
    },
  };
}
