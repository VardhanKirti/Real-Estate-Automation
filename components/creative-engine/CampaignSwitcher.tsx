'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { PenLine, Plus, Trash2 } from 'lucide-react';
import { pushEscape } from '@/lib/escape-stack';
import { ago } from '@/components/creative-engine/primitives';
import { plural } from '@/lib/creative-engine/format';
import { CAMPAIGN_NAME_MAX, validateCampaignName } from '@/lib/creative-engine/campaign-name';
import type { CampaignSummary } from '@/lib/creative-engine/pick';
import { Btn, Input, useG } from '@/components/creative-engine/skin';
import { ConfirmDelete, Tag } from '@/components/creative-engine/skin-dash';
import { ClassicSwitcherOpen, ClassicSwitcherRow, switcherPanelClass } from '@/components/creative-engine/classic';

/**
 * The one campaign switcher (SPEC §5 C6): a popover anchored to the nav pill
 * with every campaign, its provenance tag, when it last changed and what it
 * holds. Open, Rename and Delete per row, New concept on top. Keyboard: Up and
 * Down move between rows, Enter opens, R renames, Delete asks to delete,
 * Escape closes and returns focus to the pill. In the sample, rename and
 * delete are off with the reason in their title.
 */

const ORIGIN_TAG: Record<CampaignSummary['origin'], string | null> = { live: null, dry: 'Dry run', filming: 'Filming' };

export function originTag(origin: CampaignSummary['origin']): string | null {
  return ORIGIN_TAG[origin];
}

type Props = {
  campaigns: CampaignSummary[];
  currentId: string | null;
  readOnly: boolean;
  /** While filming every campaign is the demo world's own, so the Filming tag would be noise. */
  filming?: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, name: string) => Promise<string | null>;
  onDelete: (c: CampaignSummary) => void;
};

export function CampaignSwitcher({ campaigns, currentId, readOnly, filming = false, anchorRef, onClose, onOpen, onNew, onRename, onDelete }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape closes the popover (top of the shared stack) and focus goes back to the pill.
  useEffect(() => pushEscape(() => { onCloseRef.current(); anchorRef.current?.focus(); }, { id: 'ae-campaign-switcher' }), [anchorRef]);

  // Click outside closes; the pill itself toggles, so it is not "outside".
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.('[role="dialog"]')) return;
      onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchorRef]);

  // Focus lands on the first campaign row (or New concept when there is none).
  useEffect(() => {
    const first = rows.current.find(Boolean);
    (first ?? ref.current?.querySelector<HTMLElement>('[data-new-concept]'))?.focus({ preventScroll: true });
  }, []);

  const move = (i: number, d: number) => {
    const list = rows.current.filter(Boolean) as HTMLButtonElement[];
    if (list.length === 0) return;
    list[(i + d + list.length) % list.length]?.focus();
  };

  const onRowKey = (e: ReactKeyboardEvent, i: number, c: CampaignSummary) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
    else if ((e.key === 'r' || e.key === 'R') && !readOnly) { e.preventDefault(); setRenaming(c.id); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) { e.preventDefault(); onDelete(c); }
  };

  const disabledWhy = readOnly ? 'Sample data: rename and delete are off' : undefined;
  const g = useG();

  // GladOS: keep the panel on screen. It hangs from the nav pill's left edge, so on a phone
  // (390px) it ran 64px past the viewport; shift it left by the overflow, never past the gutter.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!g || !el) return;
    el.style.left = '';
    const r = el.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 16);
    if (over > 0) el.style.left = `${-Math.min(over, Math.max(0, r.left - 16))}px`;
  });

  return (
    // Classic: the paper .ae-pop panel. Kit: the same panel on --g-* tokens (.ce-g-switcher); its rows,
    // buttons and field are kit controls. It stays the engine's own popover because the nav pill anchors
    // it and the rows need their keyboard (GPopover renders its own trigger).
    <div ref={ref} className={switcherPanelClass(g)} role="region" aria-labelledby={titleId} data-campaign-switcher>
      <div className="flex items-center justify-between gap-3 px-2 pb-2">
        <span id={titleId} className="ae-cap">{plural(campaigns.length, 'campaign')}</span>
        <Btn size="sm" data-new-concept onClick={onNew} disabled={readOnly} title={readOnly ? 'Sample data: leave the sample to start a concept' : 'Open the Creative generator with empty fields'}><Plus className="h-3.5 w-3.5" strokeWidth={1.8} /> New concept</Btn>
      </div>
      <ul className="max-h-[min(420px,60vh)] space-y-1 overflow-y-auto">
        {campaigns.length === 0 && <li className="ae-cap px-2 py-3">No campaigns yet. Start one with New concept.</li>}
        {campaigns.map((c, i) => {
          const tag = filming && c.origin === 'filming' ? null : originTag(c.origin);
          return (
            <ClassicSwitcherRow key={c.id} g={g} current={c.id === currentId}>
              {renaming === c.id ? (
                <RenameInput initial={c.name} onCancel={() => { setRenaming(null); rows.current[i]?.focus(); }} onSave={async (name) => { const err = await onRename(c.id, name); if (!err) { setRenaming(null); queueMicrotask(() => rows.current[i]?.focus()); } return err; }} />
              ) : (
                <>
                  <SwitcherOpen g={g} rowRef={(el) => { rows.current[i] = el; }} onClick={() => onOpen(c.id)} onKeyDown={(e) => onRowKey(e, i, c)} current={c.id === currentId} title={c.name}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[13px] text-[var(--p-ink)]">{c.name}</span>
                      {tag && <Tag className="shrink-0">{tag}</Tag>}
                    </span>
                    <span className="ae-faint mt-0.5 block truncate">{ago(c.updatedAt)} · {plural(c.angles, 'angle')} · {plural(c.scripts, 'script')} · {plural(c.briefs, 'brief')} · {plural(c.assets, 'asset')}</span>
                  </SwitcherOpen>
                  <div className="flex shrink-0 items-center gap-1">
                    <Btn icon onClick={() => setRenaming(c.id)} disabled={readOnly} title={disabledWhy ?? `Rename ${c.name}`} aria-label={`Rename ${c.name}`}><PenLine className="h-4 w-4" strokeWidth={1.6} /></Btn>
                    <Btn icon onClick={() => onDelete(c)} disabled={readOnly} title={disabledWhy ?? `Delete ${c.name}`} aria-label={`Delete ${c.name}`}><Trash2 className="h-4 w-4" strokeWidth={1.6} /></Btn>
                  </div>
                </>
              )}
            </ClassicSwitcherRow>
          );
        })}
      </ul>
      <div className="ae-faint px-2 pt-2">Up and Down move · Enter opens · R renames · Delete removes</div>
    </div>
  );
}

/** The row's open button: the paper .ae-pop-open under Classic, a kit GButton spanning the row under the kit. */
function SwitcherOpen({ g, rowRef, onClick, onKeyDown, current, title, children }: { g: boolean; rowRef: (el: HTMLButtonElement | null) => void; onClick: () => void; onKeyDown: (e: ReactKeyboardEvent) => void; current: boolean; title: string; children: React.ReactNode }) {
  if (!g) return <ClassicSwitcherOpen ref={rowRef} onClick={onClick} onKeyDown={onKeyDown} current={current} title={title}>{children}</ClassicSwitcherOpen>;
  return <Btn ref={rowRef} onClick={onClick} onKeyDown={onKeyDown} aria-current={current ? 'true' : undefined} title={title} className="ce-g-switcher-open">{children}</Btn>;
}

/** Inline rename: Enter or blur saves, Escape cancels, empty refused, 60 characters (C7). */
export function RenameInput({ initial, onSave, onCancel, className, label = 'Campaign name' }: { initial: string; onSave: (name: string) => Promise<string | null>; onCancel: () => void; className?: string; label?: string }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const save = async () => {
    if (done.current || saving) return;
    const v = validateCampaignName(value, initial);
    if (v.kind === 'error') { setError(v.message); return; }
    if (v.kind === 'unchanged') { done.current = true; onCancel(); return; }
    setSaving(true);
    const err = await onSave(v.name);
    setSaving(false);
    if (err) setError(err);
    else done.current = true;
  };

  return (
    <div className="min-w-0 flex-1">
      <Input
        ref={input}
        value={value}
        maxLength={CAMPAIGN_NAME_MAX}
        disabled={saving}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void save(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done.current = true; onCancel(); }
        }}
        onBlur={() => void save()}
        className={[className, saving ? 'opacity-60' : ''].filter(Boolean).join(' ')}
      />
      {error && <p role="alert" className="mt-1 text-[12px] text-[var(--p-red)]">{error}</p>}
    </div>
  );
}

export type DeleteTarget = { id: string; name: string; files: number; workflows: number | null; rendering: number };

/** Hard-delete confirm (S03 FR-6, Q-ENG-4) on the X1 dialog: Cancel has focus, Escape closes. */
export function DeleteCampaignDialog({ target, busy, error, onCancel, onConfirm }: { target: DeleteTarget; busy: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const wf = target.workflows === null ? 'its workflows' : plural(target.workflows, 'workflow');
  return (
    <ConfirmDelete
      title={<>Delete &ldquo;{target.name}&rdquo;?</>}
      body={<>
        Its {plural(target.files, 'delivered file')} and {wf} are removed from this machine. Credit history stays. Arcads keeps its own copies.
        {target.rendering > 0 && <> {target.rendering === 1 ? '1 run is still rendering and will be abandoned.' : `${target.rendering} runs are still rendering and will be abandoned.`}</>}
      </>}
      error={error}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
