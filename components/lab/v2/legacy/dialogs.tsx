'use client';
/**
 * Content Lab, Bennett Legacy dialogs: the spend gate (CapDialog, 01 4.4: pass the cap once), Confirm and
 * Log an outside score (01 12.4), all on the kit's LDialog (FO v1 dialog: slab corners, hairline, mono,
 * focus trapped and returned). `LegacyCapHost` registers the cap dialog with the shared LabCapProvider,
 * so a 402 from any useLabPost call under a Legacy page opens it, as ClassicCapHost does for Classic.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { LDialog } from '@/components/legacy';
import { CLASSIC_COPY as C } from '@/lib/lab/view/classic-copy';
import { LabCapProvider, useLabPost, type CapRequest } from '@/components/lab/v2/shared/useLabPost';
import { Btn } from './parts';

export function Dialog({ open, onClose, title, sub, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <LDialog open onClose={onClose} title={title} sub={sub} footer={footer} width={wide ? 640 : 480}>
      <div data-l="LabDialogBody" className="l-lab-dialog-body">{children}</div>
    </LDialog>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel, onConfirm, onClose, cancelLabel }: { open: boolean; title: ReactNode; body?: ReactNode; confirmLabel: string; cancelLabel?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Btn onClick={onClose}>{cancelLabel ?? C.dialog.cancel}</Btn>
          <Btn primary onClick={onConfirm}>{confirmLabel}</Btn>
        </>
      }
    >
      {body && <p className="l-body-text">{body}</p>}
    </Dialog>
  );
}

/** The spend gate: the server's capAsk, then Pass the cap once (a cap of 0, an off line, has no pass). */
export function CapDialog({ ask, onClose, onPass }: { ask: Record<string, unknown> | null; onClose: () => void; onPass: () => void }) {
  const msg = typeof ask?.capAsk === 'string' ? ask.capAsk : null;
  const off = ask?.reason === 'off' || ask?.cap === 0;
  return (
    <Dialog
      open={!!ask}
      onClose={onClose}
      title={C.dialog.capTitle}
      footer={
        <>
          <Btn onClick={onClose}>{C.dialog.cancel}</Btn>
          {!off && <Btn primary onClick={onPass}>{C.dialog.capPass}</Btn>}
        </>
      }
    >
      {msg && <p className="l-body-text">{msg}</p>}
    </Dialog>
  );
}

/** Wraps a Legacy page so every 402 under it opens the Legacy CapDialog (01 4.4). Adds no DOM of its own. */
export function LegacyCapHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<CapRequest | null>(null);
  const openCap = useCallback((r: CapRequest) => setReq(r), []);
  return (
    <LabCapProvider openCap={openCap}>
      {children}
      <CapDialog ask={req ? { capAsk: req.capAsk } : null} onClose={() => setReq(null)} onPass={() => { const r = req; setReq(null); void r?.retry(); }} />
    </LabCapProvider>
  );
}

/** A labelled field: the FO mono label over a Legacy input. */
export function Field({ label, children, wide }: { label: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label data-l="Field" className="l-lab-field" data-wide={wide ? '' : undefined}>
      <span className="l-field-label">{label}</span>
      {children}
    </label>
  );
}

const TOOLS = [
  { id: 'higgsfield', label: 'Higgsfield' },
  { id: 'opusclip', label: 'OpusClip' },
];

/** 01 12.4: log an outside tool's score against a draft script; the server stores no band. */
export function OutsideScoreDialog({ open, onClose, scripts, readOnly }: { open: boolean; onClose: () => void; scripts: { id: string; label: string }[]; readOnly: string | null }) {
  const { post, busy } = useLabPost();
  const [scriptId, setScript] = useState(scripts[0]?.id ?? '');
  const [tool, setTool] = useState('higgsfield');
  const [other, setOther] = useState('');
  const [score, setScore] = useState('');
  const [outOf, setOutOf] = useState('100');
  const slug = tool === 'other' ? other.toLowerCase().replace(/[^a-z0-9_]/g, '') : tool;
  const ok = !readOnly && scriptId && slug.length >= 2 && slug.length <= 24 && score !== '' && Number(outOf) > 0;
  const submit = async () => {
    if (!ok) return;
    const r = await post('/api/lab/predictions', {
      action: 'log_external', scriptId, tool: slug, toolLabel: tool === 'other' ? other : TOOLS.find((t) => t.id === tool)?.label, score: Number(score), scaleMax: Number(outOf),
    }, { key: 'outside', quiet: false });
    if (r.ok) onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={C.dialog.outsideTitle}
      footer={
        <>
          <Btn onClick={onClose}>{C.dialog.cancel}</Btn>
          <Btn primary disabled={!ok} title={readOnly ?? undefined} busy={busy === 'outside'} onClick={() => void submit()}>{C.dialog.outsideSubmit}</Btn>
        </>
      }
    >
      <form className="l-lab-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label={C.dialog.script}>
          <select className="l-select" value={scriptId} onChange={(e) => setScript(e.target.value)} disabled={!!readOnly}>
            {scripts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        <Field label={C.dialog.tool}>
          <select className="l-select" value={tool} onChange={(e) => setTool(e.target.value)} disabled={!!readOnly}>
            {TOOLS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value="other">{C.dialog.other}</option>
          </select>
        </Field>
        {tool === 'other' && (
          <Field label={C.dialog.other}>
            <input className="l-input" value={other} maxLength={24} onChange={(e) => setOther(e.target.value)} />
          </Field>
        )}
        <div className="l-lab-field-row">
          <Field label={C.dialog.score}>
            <input className="l-input" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9.]/g, ''))} disabled={!!readOnly} />
          </Field>
          <Field label={C.dialog.outOf}>
            <input className="l-input" inputMode="decimal" value={outOf} onChange={(e) => setOutOf(e.target.value.replace(/[^0-9.]/g, ''))} disabled={!!readOnly} />
          </Field>
        </div>
        {readOnly && <p className="l-body-text">{readOnly}</p>}
      </form>
    </Dialog>
  );
}
