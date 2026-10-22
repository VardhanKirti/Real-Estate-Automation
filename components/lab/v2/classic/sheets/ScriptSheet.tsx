'use client';
/**
 * Script sheet (01 17), Classic tree: the shell around 07's editor. Owns the platform and duration
 * controls, Save (button, Cmd/Ctrl S), the unsaved-edits guard, draft recovery, the freeze dialog
 * (06's body, never blocked by a failing gate), Mark as posted, and the read-only rules.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { openWizard, type WizardOpenDetail } from '@/lib/wizard-dock';
import type { ScriptSheetUi } from '@/lib/lab/view/sheets/script';
import type { LabScriptBody } from '@/lib/schemas';
import { fmtAge } from '@/lib/lab/view/format';
import { useToast } from '@/components/ui/Toast';
import { CLASSIC_COPY as C, fill } from '@/lib/lab/view/classic-copy';
import { Btn, ConfirmDialog, Dialog } from '../dialogs';
import { sheetGuard, store } from '../hooks';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { Tag } from '../parts';
import { ScriptEditor } from '../studio/ScriptEditor';
import type { SheetCommon } from './common';

const PLATFORMS = C.script.platforms;
const DURATIONS = [30, 45, 60, 90];

export function ScriptSheet({ view, readOnly: frameRO, setInner, st }: { view: ScriptSheetUi } & SheetCommon) {
  const d = view.data;
  const { toast } = useToast();
  const { post: rawPost, busy } = useLabPost();
  const readOnly = view.readOnly ?? frameRO;
  const draftKey = `lab.script.draft.${d.id}.v${d.version}`;
  const [body, setBodyState] = useState<LabScriptBody>(d.body);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState<null | (() => void)>(null);
  const [freeze, setFreeze] = useState(false);
  const [band, setBand] = useState<string>('');
  const [note, setNote] = useState('');
  const [publish, setPublish] = useState<'none' | 'confirm' | 'pick'>('none');
  const [postId, setPostId] = useState('');
  const [recover, setRecover] = useState<{ body: LabScriptBody; at: number } | null>(null);
  const [sealed, setSealed] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setBodyState(d.body); setDirty(false); }, [d.body, d.version]);

  // Draft recovery (01 17.4).
  useEffect(() => {
    try {
      const raw = store.get(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as { body: LabScriptBody; at: number };
      if (JSON.stringify(draft.body.sections) !== JSON.stringify(d.body.sections)) setRecover(draft);
      else store.set(draftKey, null);
    } catch { /* unreadable draft: ignore */ }
  }, [draftKey, d.body.sections]);

  const setBody = (b: LabScriptBody) => {
    if (readOnly) return;
    setBodyState(b);
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => store.set(draftKey, JSON.stringify({ body: b, at: Date.now() })), 2000);
  };

  const post = useCallback((b: Record<string, unknown>, key: string) => rawPost('/api/lab/scripts', { id: d.id, ...b }, { key }), [rawPost, d.id]);

  const save = useCallback(async () => {
    if (!dirty || readOnly) return;
    const r = await rawPost('/api/lab/scripts', { action: 'save_edit', id: d.id, body }, { key: 'save' });
    if (r.ok) { setDirty(false); store.set(draftKey, null); }
  }, [dirty, readOnly, rawPost, d.id, body, draftKey]);

  // Cmd/Ctrl S saves (01 22.1); beforeunload while dirty (17.5).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); } };
    const unload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('beforeunload', unload); };
  }, [save, dirty]);

  // The sheet asks before closing with unsaved edits.
  useEffect(() => {
    sheetGuard.fn = dirty ? (proceed) => { setDiscard(() => proceed); return false; } : null;
    return () => { sheetGuard.fn = null; };
  }, [dirty]);

  const guarded = (fn: () => void) => (dirty ? setDiscard(() => fn) : fn());
  const viewVersion = (v: number | null) => guarded(() => { setInner('ver', v === null ? null : String(v)); window.dispatchEvent(new CustomEvent('lab:sheet-reload')); });

  const doFreeze = async () => {
    const r = await rawPost('/api/lab/predictions', { action: 'freeze', scriptId: d.id, version: d.version, band, note: note || undefined }, { key: 'freeze' });
    if (r.ok) { setFreeze(false); setSealed(true); }
  };
  const markPosted = async () => {
    if (!postId) return;
    const r = await post({ action: 'mark_published', postId }, 'publish');
    if (r && (r as { ok: boolean }).ok) { setPublish('none'); toast({ text: C.script.posted, tone: 'ok' }); }
  };
  const copyScript = async () => {
    const hook = body.hooks[body.hookChoice]?.spoken ?? '';
    const text = [hook, ...body.sections.map((s) => s.spoken)].filter(Boolean).join('\n\n');
    try { await navigator.clipboard.writeText(text); toast({ text: C.script.copied, tone: 'ok' }); } catch { /* clipboard blocked */ }
  };

  const fz = view.freeze;
  const ro = readOnly ?? undefined;
  const durationNow = d.plan.durationS;
  const platformNow = (body.platform ?? 'multi') as string;
  const frozenChip = fz.state === 'frozen' || sealed;

  return (
    <div className="lab2c-script">
      {readOnly && <p className="lab2c-banner" data-tone="info" data-lab-ink="">{readOnly}</p>}
      {d.dry && <p className="lab2c-banner" data-lab-ink="">{C.script.dry}</p>}
      {recover && (
        <div className="lab2c-banner">
          <span data-lab-ink="">{fill(C.script.recover, { age: fmtAge((Date.now() - recover.at) / 3_600_000) })}</span>
          <Btn onClick={() => { setBodyState(recover.body); setDirty(true); setRecover(null); }}>{C.script.restore}</Btn>
          <Btn onClick={() => { store.set(draftKey, null); setRecover(null); }}>{C.script.discard}</Btn>
        </div>
      )}

      <div className="lab2c-script-controls">
        <div className="lab2c-bar-group" role="radiogroup" aria-label={C.script.platform}>
          <span className="lab2c-bar-label" data-lab-ink="">{C.script.platform}</span>
          {PLATFORMS.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={platformNow === p.id} className="lab2c-fchip" aria-current={platformNow === p.id ? 'true' : undefined} aria-disabled={readOnly ? 'true' : undefined} title={ro}
              onClick={() => !readOnly && guarded(() => void post({ action: 'set_platform', platform: p.id }, 'platform'))}>{p.label}</button>
          ))}
        </div>
        <div className="lab2c-bar-group" role="radiogroup" aria-label={C.script.duration}>
          <span className="lab2c-bar-label" data-lab-ink="">{C.script.duration}</span>
          {DURATIONS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={durationNow === s} className="lab2c-fchip" aria-current={durationNow === s ? 'true' : undefined} aria-disabled={readOnly ? 'true' : undefined} title={ro}
              onClick={() => !readOnly && guarded(() => void post({ action: 'set_duration', durationS: s }, 'duration'))}>{`${s}s`}</button>
          ))}
        </div>
        {fz.editedAfterFreeze && <span className="lab2c-muted" data-lab-ink="">{fz.editedAfterFreeze}</span>}
      </div>

      <ScriptEditor data={d} body={body} setBody={setBody} readOnly={readOnly} post={post} busy={busy} setInner={setInner} st={st} onViewVersion={viewVersion} />

      <div className="lab2c-script-actions">
        <Btn primary disabled={!dirty || !!readOnly} title={ro} busy={busy === 'save'} onClick={() => void save()}>{C.script.save}</Btn>
        {fz.state !== 'not_built' && (
          frozenChip ? (
            <span className="lab2c-seal" data-sealed={sealed ? '' : undefined}><Tag tone="strong">{fz.chipText ?? C.script.frozen}</Tag></span>
          ) : (
            <Btn disabled={!!readOnly} title={ro} onClick={() => setFreeze(true)}>{C.script.freeze}</Btn>
          )
        )}
        {d.status === 'draft' && <Btn disabled={!!readOnly} title={ro} onClick={() => setPublish(view.publish.noFreezeConfirm && !frozenChip ? 'confirm' : 'pick')}>{C.script.markPosted}</Btn>}
        <Btn disabled={!!readOnly} title={ro} onClick={() => void post({ action: 'send_engine' }, 'engine')}>{C.studio.sendEngine}</Btn>
        <Btn disabled={!!readOnly} title={ro} onClick={async () => { const r = (await post({ action: 'ask_wizard' }, 'wizard')) as { ok: boolean; data: Record<string, unknown> } | undefined; if (r?.ok && r.data.prefill) openWizard(r.data.prefill as WizardOpenDetail); }}>{C.studio.askWizard}</Btn>
        <Btn onClick={() => void copyScript()}>{C.script.copy}</Btn>
      </div>

      <Dialog
        open={freeze}
        onClose={() => setFreeze(false)}
        title={C.script.freeze}
        footer={<><Btn onClick={() => setFreeze(false)}>{C.dialog.cancel}</Btn><Btn primary disabled={!band} busy={busy === 'freeze'} onClick={() => void doFreeze()}>{C.script.freezeConfirm}</Btn></>}
      >
        {fz.systemChip && (
          <p className="lab2c-dialog-text" data-lab-ink="">{fz.systemChip.hiddenReason ?? [fz.systemChip.text, fz.systemChip.record].filter(Boolean).join(' · ')}</p>
        )}
        <fieldset className="lab2c-bands">
          <legend className="lab2c-field-label">{C.script.band}</legend>
          {fz.bands.map((b) => (
            <label key={b.id} className="lab2c-band">
              <input type="radio" name="band" value={b.id} checked={band === b.id} onChange={() => setBand(b.id)} />
              <span data-lab-ink="">{b.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="lab2c-field">
          <span className="lab2c-field-label" data-lab-ink="">{C.script.note}</span>
          <input className="lab2c-input" value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
        </label>
      </Dialog>

      <ConfirmDialog
        open={publish === 'confirm'}
        title={C.script.noFreezeTitle}
        body={C.script.noFreezeBody}
        cancelLabel={C.script.freezeFirst}
        confirmLabel={C.script.postAnyway}
        onClose={() => { setPublish('none'); setFreeze(true); }}
        onConfirm={() => setPublish('pick')}
      />
      <Dialog
        open={publish === 'pick'}
        onClose={() => setPublish('none')}
        title={C.script.markPosted}
        footer={<><Btn onClick={() => setPublish('none')}>{C.dialog.cancel}</Btn><Btn primary disabled={!postId} busy={busy === 'publish'} onClick={() => void markPosted()}>{C.script.markPosted}</Btn></>}
      >
        <ul className="lab2c-pick">
          {view.publish.candidates.map((c) => (
            <li key={c.postId}>
              <label className="lab2c-band">
                <input type="radio" name="post" value={c.postId} checked={postId === c.postId} onChange={() => setPostId(c.postId)} />
                <span data-lab-ink="">{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </Dialog>
      <ConfirmDialog
        open={!!discard}
        title={C.script.discardTitle}
        cancelLabel={C.script.keepEditing}
        confirmLabel={C.script.discard}
        onClose={() => setDiscard(null)}
        onConfirm={() => { const fn = discard; setDiscard(null); setDirty(false); store.set(draftKey, null); sheetGuard.fn = null; fn?.(); }}
      />
    </div>
  );
}
