'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A Details value that copies itself (S10 FR-17): the Store row shows a
 * shortened path, and a click copies the full one. Where the clipboard is
 * unavailable it selects the text instead so the operator can copy by hand.
 */
export function HomeCopyValue({ text, copy, className = '' }: { text: string; copy: string; className?: string }) {
  const [note, setNote] = useState('');
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (msg: string) => {
    setNote(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(''), 1500);
  };
  const selectText = () => {
    const el = ref.current;
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    flash('Selected');
  };
  const onClick = async () => {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(copy);
      flash('Copied');
    } catch {
      selectText();
    }
  };

  return (
    <button type="button" onClick={onClick} className={`h6-copy flex min-w-0 items-baseline justify-end gap-2 ${className}`} title={`${copy} (click to copy)`} aria-label={`Copy ${copy}`}>
      <span aria-live="polite" className="shrink-0 font-sans text-[10px]" style={{ color: 'var(--accent)' }}>
        {note}
      </span>
      <span ref={ref} className="min-w-0 truncate">
        {text}
      </span>
    </button>
  );
}
