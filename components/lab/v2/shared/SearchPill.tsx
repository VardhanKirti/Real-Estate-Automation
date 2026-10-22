'use client';
/** Search pill (02 section 12): "Ask the Lab", focused by "/" outside inputs. */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Glass } from './Glass';
import { IconSearch } from './icons';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';
import { prefersReducedMotion } from './motion/useReducedMotion';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

export type SearchPillProps = { placeholder?: string; defaultValue?: string; onSubmit?: (q: string) => void; shortcut?: '/' };

function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function SearchPill({ placeholder = 'Ask the Lab', defaultValue = '', onSubmit, shortcut = '/' }: SearchPillProps) {
  const km = useKitMark();
  const input = useRef<HTMLInputElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const [q, setQ] = useState(defaultValue);
  /** Typing feedback: the search mark ticks once per keystroke burst (never stacks, never loops). */
  const tick = () => {
    const el = icon.current;
    if (!el || prefersReducedMotion() || typeof el.animate !== 'function' || el.getAnimations().length) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: LAB_DUR.s, easing: LAB_EASE.out });
  };
  useEffect(() => {
    const on = (e: globalThis.KeyboardEvent) => {
      if (e.key !== shortcut || e.metaKey || e.ctrlKey || e.altKey || typingTarget(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [shortcut]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v) onSubmit?.(v);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    if (q) setQ('');
    else input.current?.blur();
  };
  return (
    <Glass as="form" tone="base" radius="pill" priority={0} role="search" className="lab2-search" onSubmit={submit} data-lab="SearchPill" {...km('LabSearchPill')} data-filled={q ? '' : undefined}>
      <input
        ref={input}
        type="search"
        className="lab2-search-input"
        aria-label="Ask the Lab"
        placeholder={placeholder}
        value={q}
        onChange={(e) => { setQ(e.target.value); tick(); }}
        onKeyDown={onKey}
        data-lab-ink=""
      />
      <kbd className="lab2-kbd" data-lab-ink="">{shortcut}</kbd>
      <span ref={icon} className="lab2-search-icon" data-lab-mark=""><IconSearch size={16} /></span>
    </Glass>
  );
}
