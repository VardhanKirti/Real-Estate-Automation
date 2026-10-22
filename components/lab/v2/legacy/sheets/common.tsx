'use client';
/**
 * Sheet internals shared by the seven Legacy sheet bodies: inner tabs (01 13.5) drawn as FO toggle chips,
 * and titled blocks under a mono rule.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../parts';

export type SheetCommon = { readOnly: string | null; setInner: (name: 'st' | 'ver', value: string | null) => void; st: string | null };

/** Tablist with roving tabindex; `st` mirrors the selection through replaceState. */
export function InnerTabs<T extends string>({ tabs, st, setInner, label, children }: { tabs: { id: T; label: string }[]; st: string | null; setInner: SheetCommon['setInner']; label: string; children: (id: T) => ReactNode }) {
  const initial = (tabs.find((t) => t.id === st)?.id ?? tabs[0]?.id) as T;
  const [cur, setCur] = useState<T>(initial);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (id: T) => {
    setCur(id);
    setInner('st', id === tabs[0].id ? null : id);
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -i : e.key === 'End' ? tabs.length - 1 - i : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + tabs.length) % tabs.length;
    pick(tabs[j].id);
    refs.current[j]?.focus();
  };
  if (tabs.length <= 1) return <>{tabs[0] ? children(tabs[0].id) : null}</>;
  return (
    <div data-l="LabTabs" className="l-lab-itabs-wrap">
      <div className="l-lab-itabs" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`l-lab-tab-${t.id}`}
            aria-selected={t.id === cur}
            aria-controls={`l-lab-panel-${t.id}`}
            tabIndex={t.id === cur ? 0 : -1}
            data-l="ToggleChip"
            data-lens="c"
            data-on={t.id === cur ? 'true' : 'false'}
            className={cx('l-pressable l-toggle-chip l-lab-fchip', t.id !== cur && 'is-dark')}
            onClick={() => pick(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`l-lab-panel-${cur}`} aria-labelledby={`l-lab-tab-${cur}`} className="l-lab-itab-panel">
        {children(cur)}
      </div>
    </div>
  );
}

/** A titled block inside a sheet: `TITLE`, a hairline rule, then the body. */
export function Block({ title, children, aside }: { title?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section data-l="LabBlock" className="l-lab-block">
      {(title || aside) && (
        <header className="l-lab-block-head">
          {title && <h3 className="l-lab-block-title">{title}</h3>}
          <span aria-hidden className="l-label-rule" />
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
