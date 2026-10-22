'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pushEscape } from '@/lib/escape-stack';
import { pushToast, toToastItem, type ToastInput, type ToastItem } from '@/components/ui/Toast';

/**
 * Register a layer on the shared Escape stack (X1) while `open`. The latest
 * `onClose` is always the one called. The handled Escape stops here: a
 * window listener that still does its own Escape walk (the Motion console's)
 * would otherwise run after React has already removed the closed layer and
 * close itself on the same key press.
 */
export function useEscapeLayer(open: boolean, id: string, onClose: () => void): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    return pushEscape((e) => { e.stopImmediatePropagation(); ref.current(); }, { id });
  }, [open, id]);
}

let toastSeq = 1;

/**
 * Toasts that live inside the builder stage (X2 pieces, anchored). The
 * builder owns its stack instead of mounting a provider because the stage
 * moves between the console and the full-screen portal.
 */
export function useStageToasts(): { items: ToastItem[]; toast: (t: ToastInput) => void; dismiss: (id: number) => void } {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((l) => l.filter((x) => x.id !== id));
  }, []);
  const toast = useCallback((input: ToastInput) => {
    const item = toToastItem(input, toastSeq++);
    setItems((l) => pushToast(l, item));
    if (item.ms > 0) timers.current.set(item.id, setTimeout(() => dismiss(item.id), item.ms));
  }, [dismiss]);
  useEffect(() => {
    const m = timers.current;
    return () => { m.forEach((t) => clearTimeout(t)); m.clear(); };
  }, []);
  return { items, toast, dismiss };
}

/** localStorage read/write that never throws (private windows, blocked storage). */
export function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
export function writeLocal(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable: the default applies next time */ }
}
