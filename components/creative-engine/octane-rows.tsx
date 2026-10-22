'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { OBtn, OInput, OSelect, OTextarea } from '@/components/creative-engine/skin';

/** The 34px octane parameter rows (DESIGN.md §2), shared by the console and the workflow node settings. */

/**
 * A row can reset itself (S05a P7, FR-17): the caret is the reset button.
 * `modified` says the value differs from its default (or the applied
 * preset's); `resetTo` names that value for the tooltip.
 */
export type ResetProps = { modified?: boolean; onReset?: () => void; resetTo?: string };

const kindOf = (bound?: boolean) => (bound ? 'sent to Arcads as a field' : 'composed into the prompt');

export function Caret({ bound, label, modified, onReset, resetTo }: { bound?: boolean; label?: string } & ResetProps) {
  const kind = kindOf(bound);
  // without a reset handler (the workflow node sheet) the caret is a legend: what kind of field this row is
  if (!onReset || !label) return <span className="ae-o-caret" data-display-only="field kind" title={kind[0].toUpperCase() + kind.slice(1)}><b data-bound={!!bound} /></span>;
  return (
    <OBtn kind="row" cls="ae-o-caret" keep="ae-o-caret"
      
      data-modified={!!modified}
      aria-disabled={!modified}
      tabIndex={modified ? 0 : -1}
      aria-label={`Reset ${label}`}
      title={modified ? `Reset ${label}${resetTo ? ` to ${resetTo}` : ''} · ${kind}` : `${label} is at its default · ${kind}`}
      onClick={() => { if (modified) onReset(); }}
    >
      <b data-bound={!!bound} />
    </OBtn>
  );
}

/** Wraps a row's onReset so its value pops once when reset (reduced motion: no pop). */
function useResetPop(onReset?: () => void): [number, (() => void) | undefined] {
  const [pops, setPops] = useState(0);
  return [pops, onReset ? () => { setPops((n) => n + 1); onReset(); } : undefined];
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  readout: string;
  onChange: (v: number) => void;
  bound?: boolean;
  /**
   * How the value box edits (S05a P8, FR-18): 'number' turns it into a number
   * input on click (Enter or blur commits, clamped; Esc cancels); 'enum' lays
   * a native select of `options` (labels for min..max) over it.
   */
  edit?: 'number' | 'enum';
  options?: readonly string[];
} & ResetProps;

export function SliderRow({ label, value, min, max, readout, onChange, bound, edit, options, modified, onReset, resetTo }: SliderProps) {
  const p = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const [pops, reset] = useResetPop(onReset);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(n)) return;
    onChange(Math.min(max, Math.max(min, Math.round(n))));
  };
  const popCls = pops ? 'ae-o-popnum' : '';
  let box: React.ReactNode;
  if (edit === 'number' && draft !== null) {
    box = (
      <OInput cls="ae-o-value ae-o-value-input"
        type="number"
        
        autoFocus
        min={min}
        max={max}
        step={1}
        value={draft}
        aria-label={`${label}, ${min} to ${max}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); }
        }}
      />
    );
  } else if (edit === 'number') {
    box = <OBtn kind="row" cls={`ae-o-value ${popCls}`} keep={`ae-o-value ${popCls}`} key={pops}  title={`Type a value from ${min} to ${max}`} aria-label={`${label}: ${readout}. Edit`} onClick={() => setDraft(String(value))}>{readout}</OBtn>;
  } else if (edit === 'enum' && options) {
    box = (
      <span key={pops} className={`ae-o-value ae-o-value-sel ${popCls}`}>
        {readout}
        <OSelect value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} title={`Pick ${label.toLowerCase()}`}>
          {options.map((o, i) => (<option key={o} value={min + i}>{o}</option>))}
        </OSelect>
      </span>
    );
  } else {
    box = <span key={pops} className={`ae-o-value ${popCls}`}>{readout}</span>;
  }
  return (
    <div className="ae-o-row" data-track="true">
      <Caret bound={bound} label={label} modified={modified} onReset={reset} resetTo={resetTo} /><span className="ae-o-label">{label}</span>{box}
      <OInput cls="ae-o-track" keep="ae-o-track ce-g-orow" type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))}  style={{ ['--p' as string]: `${p}%` }} aria-label={label} />
    </div>
  );
}

export function SelectRow<T extends string>({ label, value, options, onChange, bound, labels, suffix, disabled, disabledReason, modified, onReset, resetTo }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void; bound?: boolean; labels?: Record<string, string>; suffix?: string; disabled?: boolean; disabledReason?: string } & ResetProps) {
  const text = (labels?.[value] ?? value) + (suffix ?? '');
  const [pops, reset] = useResetPop(onReset);
  return (
    <div className="ae-o-row">
      <Caret bound={bound} label={label} modified={modified} onReset={reset} resetTo={resetTo} /><span className="ae-o-label">{label}</span>
      <span className="ae-o-selwrap" data-disabled={disabled} title={disabled ? disabledReason : undefined}>
        <span key={pops} className={pops ? 'ae-o-popnum' : ''}>{text}</span>
        <OSelect value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)} aria-label={label} title={disabled ? disabledReason : undefined}>
          {options.map((o) => (<option key={o} value={o}>{(labels?.[o] ?? o) + (suffix ?? '')}</option>))}
        </OSelect>
      </span>
    </div>
  );
}

export function SwatchRow<T extends string>({ label, value, options, attr, onChange, modified, onReset, resetTo }: { label: string; value: T; options: readonly T[]; attr: 'data-light' | 'data-style'; onChange: (v: T) => void } & ResetProps) {
  const i = options.indexOf(value);
  const next = options[(i + 1) % options.length];
  const prev = options[(i - 1 + options.length) % options.length];
  const [pops, reset] = useResetPop(onReset);
  return (
    <div className="ae-o-row">
      <Caret label={label} modified={modified} onReset={reset} resetTo={resetTo} /><span className="ae-o-label">{label}<em key={pops} className={pops ? 'ae-o-popnum' : ''}>{value}</em></span>
      <OBtn kind="row" cls="ae-o-swatch" keep="ae-o-swatch"
        
        {...{ [attr]: value }}
        title={`${value}. Click for ${next}; Shift+click or Left arrow for ${prev}`}
        onClick={(e) => onChange(e.shiftKey ? prev : next)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); onChange(next); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(prev); }
        }}
        aria-label={`${label}: ${value}`}
      />
    </div>
  );
}

export function LinkRow({ label, value, onClick, bound, disabled, title }: { label: string; value: string; onClick: () => void; bound?: boolean; disabled?: boolean; title?: string }) {
  return (
    <OBtn kind="row" cls="ae-o-row w-full text-left" keep="ae-o-row w-full text-left"  onClick={onClick} disabled={disabled} title={title ?? (disabled ? 'Not available on this model' : 'Open the Refs tab')}>
      <Caret bound={bound} /><span className="ae-o-label">{label}</span>
      <span className="ae-o-selwrap" data-disabled={disabled}><span>{value}</span></span>
    </OBtn>
  );
}

export function CheckRow({ label, on, onChange, bound, muted, disabled, disabledReason, hint, modified, onReset, resetTo }: { label: string; on: boolean; onChange: (v: boolean) => void; bound?: boolean; muted?: boolean; disabled?: boolean; disabledReason?: string; hint?: string } & ResetProps) {
  const [toggles, setToggles] = useState(0); // the pop answers a click, never the first paint
  const [, reset] = useResetPop(onReset);
  return (
    <div className="ae-o-row">
      <Caret bound={bound} label={label} modified={modified} onReset={reset} resetTo={resetTo} /><span className="ae-o-label">{label}{hint && <em>{hint}</em>}</span>
      <OBtn kind="row" cls={`ae-o-check ${muted ? 'muted' : ''} ${toggles && on ? 'pop' : ''}`} keep={`ae-o-check ${muted ? 'muted' : ''} ${toggles && on ? 'pop' : ''}`} key={toggles} role="checkbox" aria-checked={on} aria-label={label} disabled={disabled} title={disabled ? disabledReason : undefined}  data-on={on} onClick={() => { setToggles((n) => n + 1); onChange(!on); }}>{on && <Check className="h-3 w-3" strokeWidth={3.5} />}</OBtn>
    </div>
  );
}

export function TextRow({ label, value, placeholder, onChange, maxLength = 300, modified, onReset, resetTo }: { label: string; value: string; placeholder: string; onChange: (v: string) => void; maxLength?: number } & ResetProps) {
  const [, reset] = useResetPop(onReset);
  return (
    <div className="ae-o-row">
      <Caret label={label} modified={modified} onReset={reset} resetTo={resetTo} /><span className="ae-o-label">{label}</span>
      <OInput cls="ae-o-text !w-[104px]" keep="!w-[104px]" value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)}  aria-label={label} title={`${value.length} / ${maxLength} characters`} />
    </div>
  );
}


export function TextAreaRow({ label, value, placeholder, rows = 3, onChange, maxLength }: { label: string; value: string; placeholder: string; rows?: number; onChange: (v: string) => void; maxLength?: number }) {
  return (
    <div className="ae-o-row" style={{ gridTemplateColumns: '10px minmax(0, 1fr)', gridTemplateRows: 'auto auto', paddingBottom: 8 }}>
      <Caret /><span className="ae-o-label">{label}</span>
      <OTextarea cls="ae-o-text w-full resize-none" keep="w-full resize-none" value={value} placeholder={placeholder} rows={rows} maxLength={maxLength} onChange={(e) => onChange(e.target.value)}  style={{ gridColumn: '1 / -1' }} aria-label={label} />
    </div>
  );
}
