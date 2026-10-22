'use client';
/** Sheet internals shared by the seven Classic sheet bodies: inner tabs (01 13.5) and titled blocks. */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

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
    <div className="lab2c-itabs-wrap">
      <div className="lab2c-itabs" role="tablist" aria-label={label}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`lab2c-tab-${t.id}`}
            aria-selected={t.id === cur}
            aria-controls={`lab2c-panel-${t.id}`}
            tabIndex={t.id === cur ? 0 : -1}
            className="lab2c-itab"
            onClick={() => pick(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            data-lab-ink=""
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`lab2c-panel-${cur}`} aria-labelledby={`lab2c-tab-${cur}`} className="lab2c-itab-panel">
        {children(cur)}
      </div>
    </div>
  );
}

export function Block({ title, children, aside }: { title?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="lab2c-block">
      {(title || aside) && (
        <header className="lab2c-block-head">
          {title && <h3 className="lab2c-block-title" data-lab-ink="">{title}</h3>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}
