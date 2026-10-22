'use client';
/**
 * Test sheet (`?test=<id>` or `?test=new`), GladOS tree (01 18). The form logs a Trial Reels hook test or
 * a YouTube Test & Compare (06's kinds; the other two are made by the freeze form and the planner). The
 * detail shows 06's labels with a calm tone for Inconclusive and Performed the same. No delete.
 */
import { useState } from 'react';
import { GDialog, GField, GInput, GSegmented, GSelect, GTextarea } from '@/components/g';
import { useLabPost } from '@/components/lab/v2/shared/useLabPost';
import { LAB_COPY } from '@/lib/lab/view/copy';
import type { TestDetailView, TestFormView, TestSheetView } from '@/lib/lab/view/sheets/test';
import { Chip } from '../bits';
import { SheetShell, type SheetCtx } from './SheetShell';
import { LAB_UI, fill } from '@/lib/lab/view/ui-copy';

type Arm = { id: string; label: string; variantText: string; postId: string };
const ARM_IDS = ['A', 'B', 'C'];

export function validateTestForm(f: { kind: string; title: string; hypothesis: string; arms: Arm[] }): string | null {
  if (f.title.trim().length < 1 || f.title.trim().length > 120) return LAB_UI.titleRange;
  if (f.hypothesis.length > 500) return LAB_UI.hypothesisMax;
  if (f.arms.length < 2 || f.arms.length > 3) return LAB_UI.armsRange;
  if (f.kind === 'trial_reels' && f.arms.some((a) => !a.postId)) return LAB_UI.armsPosts;
  if (f.kind === 'yt_test_compare' && !f.arms[0]?.postId) return LAB_UI.ytVideo;
  return null;
}

function TestForm({ form, ctx, prefill }: { form: TestFormView; ctx: SheetCtx; prefill: string | null }) {
  const [kind, setKind] = useState<'trial_reels' | 'yt_test_compare'>('trial_reels');
  const [title, setTitle] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [variable, setVariable] = useState<string>('hook');
  const [lift, setLift] = useState('');
  const [arms, setArms] = useState<Arm[]>([
    { id: 'A', label: 'A', variantText: '', postId: prefill ?? form.prefillPostId ?? '' },
    { id: 'B', label: 'B', variantText: '', postId: '' },
  ]);
  const [err, setErr] = useState<string | null>(null);
  const { post, busy } = useLabPost();
  const k = form.kinds.find((x) => x.id === kind) ?? form.kinds[0];
  const posts = kind === 'trial_reels' ? form.instagramPosts : form.youtubeVideos;
  const ro = ctx.frame.readOnly ?? (ctx.frame.layers.ledger === 'not_built' ? LAB_COPY.layer.ledger : null);
  const setArm = (i: number, patch: Partial<Arm>) => setArms((xs) => xs.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const submit = async () => {
    const msg = validateTestForm({ kind, title, hypothesis, arms });
    setErr(msg);
    if (msg || ro) return;
    const l = form.lifts.find((x) => x.featureKey === lift);
    const body = {
      kind,
      title: title.trim(),
      hypothesis,
      variable,
      featureKey: l?.featureKey ?? undefined,
      expectedSign: l?.expectedSign ?? undefined,
      platform: kind === 'trial_reels' ? 'instagram' : 'youtube',
      arms: arms.map((a) => ({ id: a.id, label: a.label, variantText: a.variantText, postId: kind === 'yt_test_compare' ? arms[0].postId : a.postId })),
    };
    const r = await post('/api/lab/tests', body, { key: 'test', inline: [400], refresh: false, okText: LAB_UI.testLogged });
    if (r.status === 400) setErr(typeof r.data.error === 'string' ? r.data.error : LAB_UI.titleRange);
    const t = r.data.test as { id?: string } | undefined;
    if (r.ok && t?.id) {
      const u = new URL(window.location.href);
      u.searchParams.set('test', t.id);
      u.searchParams.delete('post');
      window.history.replaceState(null, '', u.pathname + u.search);
      ctx.reload();
    }
  };
  return (
    <div className="lab2g-sheetbody lab2g-form">
      {ro && <p className="lab2g-muted" data-lab-ink="">{ro}</p>}
      <GSegmented label={LAB_UI.testKind} value={kind} onChange={(v) => setKind(v as typeof kind)} options={form.kinds.map((x) => ({ value: x.id, label: x.label }))} />
      <p className="lab2g-text" data-lab-ink="">{k.help}</p>
      {k.hygiene.length > 0 && (
        <ul className="lab2g-bullets">
          {k.hygiene.map((h) => <li key={h} className="lab2g-muted" data-lab-ink="">{h}</li>)}
        </ul>
      )}
      <GField label={LAB_UI.testTitle} htmlFor="lab2g-t-title">
        <GInput id="lab2g-t-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </GField>
      <GField label={LAB_UI.testHypothesis} htmlFor="lab2g-t-hyp">
        <GTextarea id="lab2g-t-hyp" value={hypothesis} maxLength={500} onChange={(e) => setHypothesis(e.target.value)} />
      </GField>
      <span className="lab2g-form-pair">
        <GField label={LAB_UI.testVariable} htmlFor="lab2g-t-var">
          <GSelect id="lab2g-t-var" value={variable} onChange={(e) => setVariable(e.target.value)} options={form.variables[kind].map((x) => ({ value: x, label: x.replace('_', ' and ') }))} />
        </GField>
        {form.lifts.length > 0 && (
          <GField label={LAB_UI.testLift} htmlFor="lab2g-t-lift">
            <GSelect id="lab2g-t-lift" value={lift} onChange={(e) => setLift(e.target.value)} options={[{ value: '', label: LAB_UI.none }, ...form.lifts.map((x) => ({ value: x.featureKey, label: x.label }))]} />
          </GField>
        )}
      </span>
      {kind === 'yt_test_compare' && (
        <GField label={LAB_UI.testVideo} htmlFor="lab2g-t-video">
          <GSelect id="lab2g-t-video" value={arms[0].postId} onChange={(e) => setArm(0, { postId: e.target.value })} options={[{ value: '', label: LAB_UI.pick }, ...posts.map((x) => ({ value: x.id, label: x.label }))]} />
        </GField>
      )}
      {arms.map((a, i) => (
        <fieldset key={a.id} className="lab2g-arm">
          <legend className="lab2-stat-label" data-lab-ink="">{fill(LAB_UI.testArm, { id: a.id })}</legend>
          <GField label={kind === 'trial_reels' ? LAB_UI.hook : LAB_UI.variantLabel} htmlFor={`lab2g-arm-${a.id}`}>
            <GInput id={`lab2g-arm-${a.id}`} value={a.variantText} maxLength={500} onChange={(e) => setArm(i, { variantText: e.target.value })} />
          </GField>
          {kind === 'trial_reels' && (
            <GField label={LAB_UI.testPost} htmlFor={`lab2g-armpost-${a.id}`}>
              <GSelect id={`lab2g-armpost-${a.id}`} value={a.postId} onChange={(e) => setArm(i, { postId: e.target.value })} options={[{ value: '', label: LAB_UI.pick }, ...posts.map((x) => ({ value: x.id, label: x.label }))]} />
            </GField>
          )}
        </fieldset>
      ))}
      {arms.length < 3 && (
        <span>
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" onClick={() => setArms((xs) => [...xs, { id: ARM_IDS[xs.length], label: ARM_IDS[xs.length], variantText: '', postId: '' }])}>
            <span data-lab-ink="">{LAB_UI.addArm}</span>
          </button>
        </span>
      )}
      {err && <p className="lab2g-dialog-warn" role="alert">{err}</p>}
      <div className="lab2g-sheetfoot">
        <span className="lab2g-grow" />
        <button data-g="LabButton" type="button" className="lab2g-solid" aria-disabled={ro ? true : undefined} title={ro ?? undefined} onClick={submit}>
          {busy === 'test' ? LAB_UI.loading : LAB_UI.createTest}
        </button>
      </div>
    </div>
  );
}

function TestDetail({ t, ctx }: { t: TestDetailView; ctx: SheetCtx }) {
  const { post, busy } = useLabPost();
  const [stop, setStop] = useState(false);
  const [result, setResult] = useState<'winner' | 'performed_same' | 'inconclusive'>('inconclusive');
  const [winner, setWinner] = useState(t.arms[0]?.id ?? '');
  const ro = ctx.frame.readOnly;
  return (
    <div className="lab2g-sheetbody">
      <div className="lab2g-idea-meta">
        <Chip>{t.kindLabel}</Chip>
        <Chip tone={t.tone === 'ok' ? 'strong' : 'neutral'}>{t.statusLabel}</Chip>
      </div>
      {t.test.hypothesis && <p className="lab2-card-text" data-lab-ink="">{t.test.hypothesis}</p>}
      {t.resultSubline && <p className="lab2g-muted" data-lab-ink="">{t.resultSubline}</p>}
      {t.confirmsText && <p className="lab2-card-text" data-lab-ink="">{t.confirmsText}</p>}
      <ul className="lab2g-rows">
        {t.arms.map((a) => (
          <li key={a.id}>
            {a.postHref ? (
              <a data-g="LabLink" href={a.postHref} className="lab2g-row" data-winner={a.isWinner ? '' : undefined} data-lab-shared={`arm-${a.id}`}>
                <span className="lab2g-row-main" data-lab-ink="">{`${a.label}: ${a.variantText}`}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{a.isWinner ? `${LAB_UI.winner} · ${a.metricsText}` : a.metricsText}</span>
              </a>
            ) : (
              <span className="lab2g-row lab2g-row-static">
                <span className="lab2g-row-main" data-lab-ink="">{`${a.label}: ${a.variantText}`}</span>
                <span className="lab2g-row-meta" data-lab-ink="">{a.metricsText}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {t.hygiene.length > 0 && (
        <div className="lab2g-block">
          <span className="lab2-stat-label" data-lab-ink="">{LAB_UI.hygiene}</span>
          <ul className="lab2g-bullets">
            {t.hygiene.map((h) => <li key={h} className="lab2g-muted" data-lab-ink="">{h}</li>)}
          </ul>
        </div>
      )}
      {t.actions.recordResult && (
        <div className="lab2g-block lab2g-form">
          <GSegmented
            label={LAB_UI.recordResult}
            value={result}
            onChange={(v) => setResult(v as typeof result)}
            options={[
              { value: 'winner', label: LAB_UI.winner },
              { value: 'performed_same', label: LAB_UI.performedSame },
              { value: 'inconclusive', label: LAB_COPY.inconclusive },
            ]}
          />
          {result === 'winner' && <GSelect aria-label={LAB_UI.winner} value={winner} onChange={(e) => setWinner(e.target.value)} options={t.arms.map((a) => ({ value: a.id, label: a.label }))} />}
          <span>
            <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={ro ? true : undefined} onClick={() => !ro && post(`/api/lab/tests/${t.test.id}`, { result, winnerArm: result === 'winner' ? winner : undefined }, { method: 'PATCH', key: 'result' })}>
              <span data-lab-ink="">{LAB_UI.recordResult}</span>
            </button>
          </span>
        </div>
      )}
      <div className="lab2g-sheetfoot">
        {t.actions.stop && (
          <button data-g="LabButton" type="button" className="lab2-pill lab2-seeall" aria-disabled={ro ? true : undefined} onClick={() => !ro && setStop(true)}>
            <span data-lab-ink="">{LAB_UI.stopTest}</span>
          </button>
        )}
        <span className="lab2g-grow" />
        {t.actions.judgeNow && (
          <button data-g="LabButton" type="button" className="lab2g-solid" aria-disabled={ro ? true : undefined} onClick={() => !ro && post(`/api/lab/tests/${t.test.id}/judge`, null, { key: 'judge' })}>
            {busy === 'judge' ? LAB_UI.loading : LAB_UI.judgeNow}
          </button>
        )}
      </div>
      <GDialog
        open={stop}
        onClose={() => setStop(false)}
        title={LAB_UI.stopTest}
        confirmLabel={LAB_UI.stopTest}
        cancelLabel={LAB_UI.cancel}
        tone="danger"
        onConfirm={async () => {
          await post(`/api/lab/tests/${t.test.id}`, { status: 'abandoned' }, { method: 'PATCH', key: 'stop' });
          setStop(false);
        }}
      >
        <p>{LAB_UI.stopTestConfirm}</p>
      </GDialog>
    </div>
  );
}

export function TestSheet({ ctx, view }: { ctx: SheetCtx; view: TestSheetView | null | undefined }) {
  const v = view ?? null;
  const prefill = typeof window !== 'undefined' ? new URL(window.location.href).searchParams.get('post') : null;
  return (
    <SheetShell
      kind="test"
      ctx={ctx}
      notFound={view === null}
      title={v ? (v.mode === 'new' ? LAB_UI.logTest : v.test.test.title) : LAB_UI.kindTest}
      caption={v && v.mode === 'view' ? v.test.kindLabel : undefined}
    >
      {v && v.mode === 'new' && <TestForm form={v.form} ctx={ctx} prefill={prefill} />}
      {v && v.mode === 'view' && <TestDetail t={v.test} ctx={ctx} />}
    </SheetShell>
  );
}
