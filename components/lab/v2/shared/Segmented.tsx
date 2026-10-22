'use client';
/** Segmented pill (02 section 10): a tablist with roving tabindex; arrows move and select. */
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LAB_DUR, LAB_EASE } from '@/lib/lab/motion';
import { Glass } from './Glass';
import { prefersReducedMotion } from './motion/useReducedMotion';
import { useKitMark } from '@/components/lab/v2/shared/kitMark';

/** 03.7.3 thumb: a solid pill flies from the old option to the new one (transform only), then hands over. */
function flyThumb(seg: HTMLElement, from: HTMLElement, to: HTMLElement) {
  if (prefersReducedMotion() || typeof seg.animate !== 'function') return;
  const s = seg.getBoundingClientRect();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  seg.querySelectorAll('.lab2-seg-fly').forEach((n) => n.remove());
  const fly = document.createElement('span');
  fly.className = 'lab2-seg-fly';
  fly.setAttribute('aria-hidden', 'true');
  Object.assign(fly.style, { left: `${b.left - s.left}px`, top: `${b.top - s.top}px`, width: `${b.width}px`, height: `${b.height}px` });
  seg.appendChild(fly);
  seg.setAttribute('data-flying', '');
  const anim = fly.animate(
    [{ transform: `translateX(${a.left - b.left}px) scaleX(${a.width / b.width})` }, { transform: 'none' }],
    { duration: LAB_DUR.s, easing: LAB_EASE.out },
  );
  const done = () => { fly.remove(); seg.removeAttribute('data-flying'); };
  anim.finished.then(done, done);
}

export type SegmentedOption<T extends string> = { id: T; label: string; countText?: string };
export type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value?: T;
  onChange?: (id: T) => void;
  label: string;
  controls?: string;
};

export function Segmented<T extends string>({ options, value, onChange, label, controls }: SegmentedProps<T>) {
  const km = useKitMark();
  const [local, setLocal] = useState<T | undefined>(value ?? options[0]?.id);
  const cur = onChange ? value : local;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const seg = useRef<HTMLElement>(null);
  const prev = useRef<T | undefined>(cur);
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = cur;
    if (was === undefined || was === cur || !seg.current) return;
    const from = refs.current[options.findIndex((o) => o.id === was)];
    const to = refs.current[options.findIndex((o) => o.id === cur)];
    if (from && to) flyThumb(seg.current, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);
  const pick = (id: T, focus = false) => {
    if (onChange) onChange(id);
    else setLocal(id);
    if (focus) refs.current[options.findIndex((o) => o.id === id)]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    let j = -1;
    if (e.key === 'ArrowRight') j = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = options.length - 1;
    if (j < 0) return;
    e.preventDefault();
    pick(options[j].id, true);
  };
  return (
    <Glass ref={seg} tone="base" radius="pill" priority={0} className="lab2-seg" role="tablist" aria-label={label} data-lab="Segmented" {...km('LabSegmented')}>
      {options.map((o, i) => {
        const sel = o.id === cur;
        return (
          <button
            key={o.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={sel}
            aria-controls={controls}
            tabIndex={sel ? 0 : -1}
            className="lab2-seg-opt"
            onClick={() => pick(o.id)}
            onKeyDown={(e) => onKey(e, i)}
            data-lab-ink=""
          >
            {o.countText && <span className="lab2-seg-count">{o.countText}</span>}
            {o.label}
          </button>
        );
      })}
    </Glass>
  );
}
