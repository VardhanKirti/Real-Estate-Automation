'use client';
/**
 * GladOS dialogs every page shares: the CapDialog host (01 4.4: a 402 anywhere opens it; "Pass the cap
 * once" re-sends with override) and the Log an outside score dialog (01 12.4, 06 2.7 `log_external`).
 * Kit controls only (components/g).
 */
import { useCallback, useState, type ReactNode } from 'react';
import { GDialog, GField, GInput, GSelect, useToast } from '@/components/g';
import { LabCapProvider, useLabPost, type CapRequest } from '@/components/lab/v2/shared/useLabPost';
import { LAB_UI } from '@/lib/lab/view/ui-copy';

export function LabCapHost({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<CapRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const openCap = useCallback((r: CapRequest) => setReq(r), []);
  return (
    <LabCapProvider openCap={openCap}>
      {children}
      <GDialog
        open={!!req}
        onClose={() => setReq(null)}
        title={LAB_UI.capTitle}
        confirmLabel={LAB_UI.runPassCap}
        cancelLabel={LAB_UI.capKeep}
        busy={busy}
        onConfirm={async () => {
          if (!req) return;
          setBusy(true);
          await req.retry();
          setBusy(false);
          setReq(null);
        }}
      >
        {req && <p>{req.capAsk}</p>}
      </GDialog>
    </LabCapProvider>
  );
}

export type OutsideScoreScript = { id: string; label: string };
const TOOLS = [
  { value: 'higgsfield', label: 'Higgsfield' },
  { value: 'opusclip', label: 'OpusClip' },
  { value: 'other', label: LAB_UI.osToolOther },
];

/** Log an outside score: script, tool, score, out of. Posts 06's `log_external` (no band). */
export function OutsideScoreDialog({ open, onClose, scripts, readOnly }: { open: boolean; onClose: () => void; scripts: OutsideScoreScript[]; readOnly: string | null }) {
  const [scriptId, setScriptId] = useState('');
  const [tool, setTool] = useState('higgsfield');
  const [other, setOther] = useState('');
  const [score, setScore] = useState('');
  const [outOf, setOutOf] = useState('100');
  const [err, setErr] = useState<string | null>(null);
  const { post, busy } = useLabPost();
  const { toast } = useToast();
  const slug = tool === 'other' ? other.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_') : tool;
  const toolLabel = tool === 'other' ? other.trim() : TOOLS.find((t) => t.value === tool)?.label ?? tool;
  const sid = scriptId || scripts[0]?.id || '';
  const invalid =
    readOnly ??
    (!sid ? LAB_UI.osNoScripts : tool === 'other' && (slug.length < 2 || slug.length > 24) ? LAB_UI.osToolName : score === '' || !Number.isFinite(Number(score)) ? LAB_UI.osScore : null);
  return (
    <GDialog
      open={open}
      onClose={onClose}
      title={LAB_UI.osTitle}
      confirmLabel={LAB_UI.osSubmit}
      cancelLabel={LAB_UI.cancel}
      busy={busy === 'outside'}
      confirmDisabledReason={invalid ?? undefined}
      onConfirm={async () => {
        setErr(null);
        const r = await post(
          '/api/lab/predictions',
          { action: 'log_external', scriptId: sid, tool: slug, toolLabel, score: Number(score), scaleMax: Number(outOf) || 100 },
          { key: 'outside', inline: [400] },
        );
        if (r.status === 400) setErr(typeof r.data.error === 'string' ? r.data.error : null);
        if (r.ok) {
          toast({ text: r.data.late ? LAB_UI.osLate : LAB_UI.osLogged, tone: 'ok' });
          onClose();
        }
      }}
    >
      <div className="lab2g-form">
        {scripts.length === 0 ? (
          <p className="lab2g-dialog-muted">{LAB_UI.osNoScripts}</p>
        ) : (
          <GField label={LAB_UI.osScript} htmlFor="lab-os-script">
            <GSelect id="lab-os-script" value={sid} onChange={(e) => setScriptId(e.target.value)} options={scripts.map((s) => ({ value: s.id, label: s.label }))} />
          </GField>
        )}
        <GField label={LAB_UI.osTool} htmlFor="lab-os-tool">
          <GSelect id="lab-os-tool" value={tool} onChange={(e) => setTool(e.target.value)} options={TOOLS} />
        </GField>
        {tool === 'other' && (
          <GField label={LAB_UI.osToolName} htmlFor="lab-os-name">
            <GInput id="lab-os-name" value={other} maxLength={24} onChange={(e) => setOther(e.target.value)} />
          </GField>
        )}
        <span className="lab2g-form-pair">
          <GField label={LAB_UI.osScore} htmlFor="lab-os-score">
            <GInput id="lab-os-score" inputMode="decimal" value={score} onChange={(e) => setScore(e.target.value)} />
          </GField>
          <GField label={LAB_UI.osOutOf} htmlFor="lab-os-of">
            <GInput id="lab-os-of" inputMode="decimal" value={outOf} onChange={(e) => setOutOf(e.target.value)} />
          </GField>
        </span>
        {err && <p className="lab2g-dialog-warn" role="alert">{err}</p>}
      </div>
    </GDialog>
  );
}
