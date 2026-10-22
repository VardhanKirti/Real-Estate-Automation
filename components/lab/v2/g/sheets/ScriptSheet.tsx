'use client';
/**
 * Script sheet (`?script=`), GladOS tree (01 17 around 07 7.8): centred, max 1200px. Owns the unsaved
 * edits guard (and `beforeunload` while dirty), the local draft mirror and recovery, the freeze dialog
 * (06's `freeze` body, never blocked by a failing gate), the seal (03.9), the publish picker with the
 * no-freeze confirm, and read-only rules.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GDialog, GField, GInput, GSegmented, GSelect, GTextarea, useToast } from '@/components/g';
import { StrandBar } from '../Strand';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';

import { fmtAge } from '@/lib/lab/view/format';
import type { ScriptSheetUi } from '@/lib/lab/view/sheets/script';
import { openWizard, type WizardOpenDetail } from '@/lib/wizard-dock';
import { FreezeSeal, HookPicker, ScriptControls, SectionCard, SidePanel, type Body } from '../studio/ScriptEditor';
import { SheetShell, type SheetCtx } from './SheetShell';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

type SideTab = 'checks' | 'grounding' | 'versions';
const draftKey = (id: string, v: number) => `lab.script.draft.${id}.v${v}`;

function readDraft(id: string, v: number): { body: Body; at: number } | null {
  try {
    const raw = window.localStorage.getItem(draftKey(id, v));
    return raw ? (JSON.parse(raw) as { body: Body; at: number }) : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, v: number, body: Body | null) {
  try {
    if (body) window.localStorage.setItem(draftKey(id, v), JSON.stringify({ body, at: Date.now() }));
    else window.localStorage.removeItem(draftKey(id, v));
  } catch {
    /* per-viewer convenience only */
  }
}

function spokenScript(body: Body): string {
  const hook = body.hooks[body.hookChoice]?.spoken ?? '';
  return [hook, ...body.sections.map((s) => s.spoken), body.cta].filter((x) => x && x.trim()).join('\n\n');
}

function Editor({ ui, ctx, guard }: { ui: ScriptSheetUi; ctx: SheetCtx; guard: (dirty: boolean, discard: () => void) => void }) {
  const d = ui.data;
  const ro = !!ui.readOnly;
  const [body, setBody] = useState<Body>(d.body);
  const [dirty, setDirty] = useState(false);
  const [side, setSide] = useState<SideTab>((typeof window !== 'undefined' ? (new URL(window.location.href).searchParams.get('st') as SideTab | null) : null) ?? 'checks');
  const [draft, setDraft] = useState<{ body: Body; at: number } | null>(null);
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [band, setBand] = useState<string>('');
  const [lo, setLo] = useState('');
  const [hi, setHi] = useState('');
  const [note, setNote] = useState('');
  const [sealPlay, setSealPlay] = useState(false);
  const [publish, setPublish] = useState<'none' | 'confirm' | 'pick'>('none');
  const [pickId, setPickId] = useState('');
  const [confirmLeave, setConfirmLeave] = useState<null | (() => void)>(null);
  const { post, busy } = useLabPost();
  const { toast } = useToast();
  const router = useRouter();

  // A new server version replaces the local body unless there are unsaved edits.
  useEffect(() => {
    if (!dirty) setBody(d.body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.version, d.body]);

  // Draft recovery: a local draft for this version whose text differs from the server body (01 17.4).
  useEffect(() => {
    const dr = readDraft(d.id, d.version);
    if (dr && JSON.stringify(dr.body.sections) !== JSON.stringify(d.body.sections)) setDraft(dr);
  }, [d.id, d.version, d.body.sections]);

  // Mirror the draft every 2 s while dirty; warn before unloading.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setInterval(() => writeDraft(d.id, d.version, body), 2000);
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [dirty, body, d.id, d.version]);

  useEffect(() => guard(dirty, () => setDirty(false)), [dirty, guard]);

  const save = useCallback(async () => {
    if (ro || !dirty) return;
    const r = await post('/api/lab/scripts', { action: 'save_edit', id: d.id, body }, { key: 'save', inline: [400] });
    if (r.status === 400) toast({ text: LAB_UI.editUnreadable, tone: 'err' });
    if (r.ok) {
      setDirty(false);
      writeDraft(d.id, d.version, null);
      const v = typeof r.data.version === 'number' ? r.data.version : d.version + 1;
      toast({ text: fill(LAB_UI.savedAs, { n: String(v) }), tone: 'ok' });
    }
  }, [ro, dirty, post, d.id, d.version, body, toast]);

  // Cmd S / Ctrl S saves (01 22.1).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, [save]);

  const ask = (fn: () => void) => (dirty ? setConfirmLeave(() => fn) : fn());
  const act = (action: string, extra: Record<string, unknown>, key = action) => post('/api/lab/scripts', { action, id: d.id, ...extra }, { key });

  const setSection = (i: number, patch: Partial<{ spoken: string; onScreen: string; visualNote: string }>) => {
    setBody((b) => ({ ...b, sections: b.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
    setDirty(true);
  };

  const freeze = async () => {
    if (!band) return;
    const r = await post(
      '/api/lab/predictions',
      { action: 'freeze', scriptId: d.id, version: d.version, band, ratioLo: lo ? Number(lo) : undefined, ratioHi: hi ? Number(hi) : undefined, note: note || undefined },
      { key: 'freeze' },
    );
    if (r.ok) {
      setFreezeOpen(false);
      setSealPlay(true);
    } else if (r.status === 409) {
      setFreezeOpen(false);
      ctx.reload();
    }
  };

  const markPosted = async () => {
    if (!pickId) return;
    const r = await act('mark_published', { postId: pickId }, 'publish');
    if (r.ok) {
      setPublish('none');
      toast({ text: LAB_UI.postedToast, tone: 'ok' });
    }
  };

  const fz = ui.freeze;
  const canFreeze = fz.state === 'open' && !ro;
  const sections = d.sections;

  return (
    <>
      {ui.readOnly && <p className="lab2g-banner-line" data-lab-ink="">{ui.readOnly}</p>}
      {d.dry && <p className="lab2g-banner-line" data-lab-ink="">{LAB_UI.dryModel}</p>}
      {draft && !ro && (
        <div className="lab2g-banner-line lab2g-draft">
          <span data-lab-ink="">{fill(LAB_UI.draftFound, { age: fmtAge((Date.now() - draft.at) / 3_600_000) })}</span>
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => { setBody(draft.body); setDirty(true); setDraft(null); }}>
            <span data-lab-ink="">{LAB_UI.restore}</span>
          </button>
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => { writeDraft(d.id, d.version, null); setDraft(null); }}>
            <span data-lab-ink="">{LAB_UI.discard}</span>
          </button>
        </div>
      )}
      {fz.editedAfterFreeze && <p className="lab2g-banner-line" data-lab-ink="">{fz.editedAfterFreeze}</p>}
      <ScriptControls data={d} readOnly={ro} onDuration={(s) => ask(() => act('set_duration', { durationS: s }))} onPlatform={(p) => ask(() => act('set_platform', { platform: p }))} />
      <div className="lab2g-script">
        <div className="lab2g-rail">
          <div className="lab2g-rail-strand">
            <StrandBar
              strand={{ beats: d.strand.map((s) => ({ type: s.type as never, label: s.label, startPct: s.startPct, endPct: s.endPct, summary: '', token: `--lab-beat-${s.type}` })), hook: null, rehookTicks: [], durationS: d.plan.durationS, template: d.strand.map((s) => s.type).join(', ') }}
            />
          </div>
          <HookPicker data={d} choice={d.hookChoice} readOnly={ro} judging={busy === 'judge_hooks'} onPick={(i) => ask(() => act('set_hook', { hookChoice: i }))} onJudge={() => act('judge_hooks', {})} />
          {sections.map((s, i) => (
            <SectionCard
              key={s.index}
              section={s}
              text={{ spoken: body.sections[i]?.spoken ?? '', onScreen: body.sections[i]?.onScreen ?? '', visualNote: body.sections[i]?.visualNote ?? '' }}
              readOnly={ro}
              onChange={(patch) => setSection(i, patch)}
              onBlur={() => void save()}
              regenerating={busy === `regen-${s.index}`}
              onRegenerate={() => {
                const run = () => act('regenerate_section', { section: s.index }, `regen-${s.index}`);
                if (dirty) setConfirmLeave(() => run);
                else void run();
              }}
            />
          ))}
        </div>
        <SidePanel
          data={d}
          tab={side}
          onTab={(t) => {
            setSide(t);
            ctx.setInner('st', t === 'checks' ? null : t);
          }}
          viewing={ui.viewingVersion}
          readOnly={ro}
          onVersion={(v) =>
            ask(() => {
              ctx.setInner('ver', v === null ? null : String(v));
              ctx.reload();
            })
          }
          onRestore={(v) => ask(() => act('restore_version', { version: v }))}
        />
      </div>

      <div className="lab2g-sheetfoot lab2g-scriptfoot">
        <button data-g="LabButton" type="button" className="lab2g-solid" aria-disabled={ro || !dirty ? true : undefined} onClick={() => void save()}>
          {busy === 'save' ? LAB_UI.loading : LAB_UI.save}
        </button>
        {fz.state !== 'not_built' &&
          (fz.state === 'frozen' || sealPlay ? (
            <FreezeSeal text={fz.chipText ?? LAB_UI.frozenWord} play={sealPlay} />
          ) : (
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={!canFreeze ? true : undefined} title={fz.disabledReason ?? undefined} onClick={() => canFreeze && setFreezeOpen(true)}>
              <span data-lab-ink="">{LAB_UI.freeze}</span>
            </button>
          ))}
        <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={ro ? true : undefined} onClick={() => !ro && setPublish(ui.publish.noFreezeConfirm && fz.state !== 'not_built' && !sealPlay ? 'confirm' : 'pick')}>
          <span data-lab-ink="">{LAB_UI.markPosted}</span>
        </button>
        <span className="lab2g-grow" />
        <button data-g="LabButton"
          type="button"
          className="lab2-pill lab2-seeall"
          aria-disabled={ro ? true : undefined}
          onClick={async () => {
            if (ro) return;
            const r = await act('send_engine', {}, 'engine');
            if (r.ok) toast({ text: LAB_UI.sentEngine, tone: 'ok', action: { label: LAB_UI.openWord, onClick: () => router.push('/creative-engine') } });
          }}
        >
          <span data-lab-ink="">{LAB_UI.sendEngine}</span>
        </button>
        <button data-g="LabButton"
          type="button"
          className="lab2-pill lab2-seeall"
          aria-disabled={ro ? true : undefined}
          onClick={async () => {
            if (ro) return;
            const r = await post('/api/lab/scripts', { action: 'ask_wizard', id: d.id }, { key: 'wizard', refresh: false });
            const pre = (r.data.prefill ?? r.data.wizard) as WizardOpenDetail | undefined;
            if (r.ok && pre && typeof pre === 'object') openWizard(pre);
          }}
        >
          <span data-lab-ink="">{LAB_UI.askWizard}</span>
        </button>
        <button data-g="LabButton"
          type="button"
          className="lab2-pill lab2-seeall"
          onClick={() => void navigator.clipboard?.writeText(spokenScript(body)).then(() => toast({ text: LAB_UI.scriptCopied, tone: 'ok' }))}
        >
          <span data-lab-ink="">{LAB_UI.copyScript}</span>
        </button>
      </div>

      <GDialog open={freezeOpen} onClose={() => setFreezeOpen(false)} title={LAB_UI.freeze} confirmLabel={LAB_UI.freezeConfirm} cancelLabel={LAB_UI.cancel} busy={busy === 'freeze'} confirmDisabledReason={band ? undefined : LAB_UI.pickBand} onConfirm={freeze}>
        <div className="lab2g-form">
          {fz.systemChip && (
            <p className="lab2g-muted">{fz.systemChip.hiddenReason ?? [fz.systemChip.text, fz.systemChip.record].filter(Boolean).join(' · ')}</p>
          )}
          <GField label={LAB_UI.band}>
            <GSegmented label={LAB_UI.band} options={fz.bands.map((b) => ({ value: b.id, label: b.label }))} value={band} onChange={(v) => setBand(v)} />
          </GField>
          <span className="lab2g-form-pair">
            <GField label={LAB_UI.rangeLo} htmlFor="lab2g-lo">
              <GInput id="lab2g-lo" inputMode="decimal" value={lo} onChange={(e) => setLo(e.target.value)} />
            </GField>
            <GField label={LAB_UI.rangeHi} htmlFor="lab2g-hi">
              <GInput id="lab2g-hi" inputMode="decimal" value={hi} onChange={(e) => setHi(e.target.value)} />
            </GField>
          </span>
          <GField label={LAB_UI.note} htmlFor="lab2g-note">
            <GTextarea id="lab2g-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </GField>
        </div>
      </GDialog>

      <GDialog
        open={publish === 'confirm'}
        onClose={() => {
          setPublish('none');
          if (canFreeze) setFreezeOpen(true);
        }}
        title={LAB_UI.noFreezeTitle}
        confirmLabel={LAB_UI.postAnyway}
        cancelLabel={LAB_UI.freezeFirst}
        onConfirm={() => setPublish('pick')}
      >
        <p>{LAB_UI.noFreezeBody}</p>
      </GDialog>
      <GDialog open={publish === 'pick'} onClose={() => setPublish('none')} title={LAB_UI.markPosted} confirmLabel={LAB_UI.markPosted} cancelLabel={LAB_UI.cancel} busy={busy === 'publish'} confirmDisabledReason={pickId ? undefined : LAB_UI.pickPost} onConfirm={markPosted}>
        <GField label={LAB_UI.pickPost} htmlFor="lab2g-pub">
          <GSelect
            id="lab2g-pub"
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            options={[{ value: '', label: LAB_UI.pick }, ...ui.publish.candidates.map((c) => ({ value: c.postId, label: c.label.slice(0, 70) }))]}
          />
        </GField>
      </GDialog>
      <GDialog
        open={!!confirmLeave}
        onClose={() => setConfirmLeave(null)}
        title={LAB_UI.discardTitle}
        confirmLabel={LAB_UI.discard}
        cancelLabel={LAB_UI.keepEditing}
        tone="danger"
        onConfirm={() => {
          const fn = confirmLeave;
          setConfirmLeave(null);
          setDirty(false);
          setBody(d.body);
          fn?.();
        }}
      >
        {null}
      </GDialog>
    </>
  );
}

export function ScriptSheet({ ctx, view }: { ctx: SheetCtx; view: ScriptSheetUi | null | undefined }) {
  const v = view ?? null;
  const dirtyRef = useRef<{ dirty: boolean; discard: () => void }>({ dirty: false, discard: () => {} });
  const [leave, setLeave] = useState(false);
  const guard = useCallback((dirty: boolean, discard: () => void) => {
    dirtyRef.current = { dirty, discard };
  }, []);
  const guarded = useMemo<SheetCtx>(
    () => ({
      ...ctx,
      onClose: () => {
        if (dirtyRef.current.dirty) setLeave(true);
        else ctx.onClose();
      },
    }),
    [ctx],
  );
  return (
    <SheetShell
      kind="script"
      ctx={guarded}
      notFound={view === null}
      title={v ? v.data.title : LAB_UI.kindScript}
      caption={v ? [`v${v.viewingVersion}`, v.data.status === 'published' ? LAB_UI.published : LAB_UI.draft, v.headerText].join(' · ') : undefined}
    >
      {v && <Editor ui={v} ctx={ctx} guard={guard} />}
      <GDialog
        open={leave}
        onClose={() => setLeave(false)}
        title={LAB_UI.discardTitle}
        confirmLabel={LAB_UI.discard}
        cancelLabel={LAB_UI.keepEditing}
        tone="danger"
        onConfirm={() => {
          setLeave(false);
          dirtyRef.current.discard();
          dirtyRef.current = { dirty: false, discard: () => {} };
          ctx.onClose();
        }}
      >
        {null}
      </GDialog>
    </SheetShell>
  );
}
